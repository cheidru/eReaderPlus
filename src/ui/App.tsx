import { App as CapacitorApp } from '@capacitor/app';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  addBook,
  backfillSeries,
  deleteCollection,
  loadCollections,
  loadLibrary,
  loadLibraryPrefs,
  loadSettings,
  removeBook,
  saveCollections,
  saveLibraryPrefs,
  saveSettings,
  updateEntryFlags,
} from '../core/library';
import { loadWatchedFolders, saveWatchedFolders, scanWatchedFolders, withFolder, type ScanResult } from '../core/folders';
import type { LibraryLocation } from '../core/shelves';
import { DEFAULT_LIBRARY_PREFS, DEFAULT_SETTINGS, type EntryFlags, type LibraryEntry, type LibraryPrefs, type ReaderSettings } from '../core/types';
import { detectPlatform, type EngineInfo, type FileRef } from '../platform';
import { AboutDialog } from './AboutDialog';
import { CollectionsDialog, ConfirmDialog, PromptDialog } from './Dialogs';
import { LibraryView } from './library/LibraryView';
import type { BookHandlers, ToggleFlag } from './library/shelfInfo';
import { BookDetails } from './pages/BookDetails';
import { FolderPicker } from './pages/FolderPicker';
import { SettingsPage } from './pages/SettingsPage';
import { ReaderView } from './reader/ReaderView';
import { themeStyle } from './themes';

/** How long a notice snackbar stays. */
const NOTICE_MS = 5000;

/** One line for Settings about what the last scan found. */
function describeScan({ found, added, failed }: ScanResult): string {
  const parts = [`${found === 1 ? '1 book file' : `${found} book files`} in your folders`, `${added} new`];
  if (failed > 0) parts.push(`${failed} could not be opened`);
  return `Last scan: ${parts.join(', ')}`;
}

type View =
  | { kind: 'library' }
  | { kind: 'details'; bookId: string }
  | { kind: 'settings' }
  | { kind: 'folderPicker' }
  /** `from` is where the back button returns to. */
  | { kind: 'reader'; bookId: string; from: 'library' | 'details' };

type Modal =
  | { kind: 'collections'; bookId: string }
  | { kind: 'newCollection' }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; onConfirm: () => void }
  | { kind: 'about' };

export function App() {
  const platform = useMemo(detectPlatform, []);
  const [view, setView] = useState<View>({ kind: 'library' });
  const [location, setLocation] = useState<LibraryLocation>({ shelf: 'reading' });
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [collectionNames, setCollectionNames] = useState<string[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [prefs, setPrefs] = useState<LibraryPrefs>(DEFAULT_LIBRARY_PREFS);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A snackbar that hides by itself. */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const [watchedFolders, setWatchedFolders] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const back = useRef<() => boolean>(() => false);

  const refreshLibrary = useCallback(async () => {
    if (!platform) return;
    const [library, names] = await Promise.all([loadLibrary(platform), loadCollections(platform)]);
    setEntries(library);
    setCollectionNames(names);
  }, [platform]);

  const openFile = useCallback(
    async (file: FileRef) => {
      if (!platform) return;
      setError(null);
      setBusy(`Importing ${file.name}…`);
      try {
        const { entry } = await addBook(platform, file);
        await refreshLibrary();
        setView({ kind: 'reader', bookId: entry.id, from: 'library' });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [platform, refreshLibrary],
  );

  const showNotice = useCallback((text: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  /** Imports new books from the watched folders, with progress in a snackbar, like ReadEra's file scan. */
  const runScan = useCallback(async () => {
    if (!platform) return;
    setScanning(true);
    setBusy('Scanning folders…');
    try {
      const result = await scanWatchedFolders(platform, (done, total) => setBusy(`Adding books from folders… ${done} of ${total}`));
      setLastScan(describeScan(result));
      if (result.added > 0) {
        await refreshLibrary();
        showNotice(`Added ${result.added === 1 ? '1 book' : `${result.added} books`} from your folders`);
      }
    } catch (e) {
      setError(`Scanning folders failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
      setBusy(null);
    }
  }, [platform, refreshLibrary, showNotice]);

  useEffect(() => {
    if (!platform) return;
    void refreshLibrary().then(async () => {
      if (await backfillSeries(platform)) await refreshLibrary();
      const folders = await loadWatchedFolders(platform);
      setWatchedFolders(folders);
      if (folders.length > 0 && (await platform.hasFolderAccess())) await runScan();
    });
    void loadSettings(platform).then(setSettings);
    void loadLibraryPrefs(platform).then(setPrefs);
    void platform.engineInfo().then(setEngine);
    return platform.onOpenFile((file) => void openFile(file));
  }, [platform, refreshLibrary, openFile, runScan]);

  // Android's back button steps back through dialogs, pages and library groups before leaving the app.
  back.current = () => {
    if (modal) setModal(null);
    else if (view.kind === 'reader') closeReader();
    else if (view.kind === 'folderPicker') setView({ kind: 'settings' });
    else if (view.kind !== 'library') setView({ kind: 'library' });
    else if (location.group !== undefined) setLocation({ shelf: location.shelf });
    else return false;
    return true;
  };
  useEffect(() => {
    if (platform?.kind !== 'android') return;
    const handle = CapacitorApp.addListener('backButton', () => {
      if (!back.current()) void CapacitorApp.exitApp();
    });
    return () => void handle.then((h) => h.remove());
  }, [platform]);

  useEffect(() => {
    void platform?.setColorScheme(settings.theme === 'dark' ? 'dark' : 'light');
  }, [platform, settings.theme]);

  const updateSettings = useCallback(
    (next: ReaderSettings) => {
      setSettings(next);
      if (platform) void saveSettings(platform, next);
    },
    [platform],
  );

  const allCollections = useMemo(() => {
    const names = new Set(collectionNames);
    for (const entry of entries) for (const name of entry.collections ?? []) names.add(name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [collectionNames, entries]);

  if (!platform) {
    return (
      <div className="app-unsupported">
        eReaderPlus runs inside its desktop (Electron) or Android shell. Start it with <code>npm run dev:desktop</code>.
      </div>
    );
  }

  function closeReader() {
    setView(view.kind === 'reader' && view.from === 'details' ? { kind: 'details', bookId: view.bookId } : { kind: 'library' });
    void refreshLibrary();
  }

  const updatePrefs = (next: LibraryPrefs) => {
    setPrefs(next);
    void saveLibraryPrefs(platform, next);
  };

  /** Shows the change at once; storage serializes its own read-modify-write. */
  const setFlags = (bookId: string, flags: EntryFlags) => {
    setEntries((list) => list.map((e) => (e.id === bookId ? { ...e, ...flags } : e)));
    void updateEntryFlags(platform, bookId, flags);
  };

  const createCollection = (name: string) => {
    if (allCollections.includes(name)) return;
    const names = [...collectionNames, name];
    setCollectionNames(names);
    void saveCollections(platform, names);
  };

  const pickFile = async () => {
    const file = await platform.pickBookFile();
    if (file) await openFile(file);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    const file = dropped && platform.fileFromDrop(dropped);
    if (file) void openFile(file);
  };

  const books: BookHandlers = {
    onOpen: (bookId) => setView({ kind: 'reader', bookId, from: view.kind === 'details' ? 'details' : 'library' }),
    onDetails: (bookId) => setView({ kind: 'details', bookId }),
    onToggle: (bookId, flag: ToggleFlag) => {
      const entry = entries.find((e) => e.id === bookId);
      if (!entry) return;
      const on = !entry[flag];
      // A finished book is no longer waiting to be read, and the other way round.
      if (flag === 'finished') setFlags(bookId, on ? { finished: true, toRead: false } : { finished: false });
      else if (flag === 'toRead') setFlags(bookId, on ? { toRead: true, finished: false } : { toRead: false });
      else setFlags(bookId, { favorite: on });
    },
    onCollections: (bookId) => setModal({ kind: 'collections', bookId }),
    onRemove: (bookId) => {
      const entry = entries.find((e) => e.id === bookId);
      setModal({
        kind: 'confirm',
        title: 'Remove book?',
        message: `"${entry?.title ?? 'This book'}" and its reading position will be removed from the library. The original file is not touched.`,
        confirmLabel: 'Remove',
        onConfirm: () => {
          if (view.kind === 'details') setView({ kind: 'library' });
          setEntries((list) => list.filter((e) => e.id !== bookId));
          void removeBook(platform, bookId).then(refreshLibrary);
        },
      });
    },
  };

  const detailsEntry = view.kind === 'details' ? entries.find((e) => e.id === view.bookId) : undefined;
  const collectionsEntry = modal?.kind === 'collections' ? entries.find((e) => e.id === modal.bookId) : undefined;

  return (
    <div
      className="app"
      data-ui={prefs.appTheme}
      style={themeStyle(prefs.colorTheme, prefs.appTheme)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {engine && !engine.upToDate && (
        <div className="app-banner">
          Your {engine.engine} ({engine.version}) is outdated, so some books may not display correctly.
          {engine.updateUrl && (
            <button type="button" className="link-button" onClick={() => void platform.openExternal(engine.updateUrl!)}>
              Update it
            </button>
          )}
        </div>
      )}

      {view.kind === 'reader' ? (
        <ReaderView
          key={view.bookId}
          platform={platform}
          bookId={view.bookId}
          settings={settings}
          onSettingsChange={updateSettings}
          onClose={closeReader}
          onError={setError}
        />
      ) : view.kind === 'settings' ? (
        <SettingsPage
          prefs={prefs}
          folders={{
            folders: watchedFolders,
            scanning,
            lastScan,
            onAdd: () => setView({ kind: 'folderPicker' }),
            onRemove: (folder) => {
              const next = watchedFolders.filter((f) => f !== folder);
              setWatchedFolders(next);
              void saveWatchedFolders(platform, next);
            },
            onScan: () => void runScan(),
          }}
          engine={engine}
          onChange={updatePrefs}
          onBack={() => setView({ kind: 'library' })}
          onAbout={() => setModal({ kind: 'about' })}
        />
      ) : view.kind === 'folderPicker' ? (
        <FolderPicker
          platform={platform}
          onPick={(folder) => {
            const next = withFolder(watchedFolders, folder);
            setWatchedFolders(next);
            setView({ kind: 'settings' });
            void saveWatchedFolders(platform, next).then(runScan);
          }}
          onCancel={() => setView({ kind: 'settings' })}
        />
      ) : detailsEntry ? (
        <BookDetails
          platform={platform}
          entry={detailsEntry}
          books={books}
          onBack={() => setView({ kind: 'library' })}
          onAuthor={(author) => {
            setLocation({ shelf: 'authors', group: author });
            setView({ kind: 'library' });
          }}
          onSeries={(name) => {
            setLocation({ shelf: 'series', group: name });
            setView({ kind: 'library' });
          }}
          onCollection={(name) => {
            setLocation({ shelf: 'collections', group: name });
            setView({ kind: 'library' });
          }}
        />
      ) : (
        <LibraryView
          platform={platform}
          entries={entries}
          collections={allCollections}
          prefs={prefs}
          location={location}
          onLocationChange={setLocation}
          onPrefsChange={updatePrefs}
          books={books}
          onOpenFile={(file) => {
            const existing = entries.find((e) => e.source === file.ref);
            if (existing) books.onOpen(existing.id);
            else void openFile(file);
          }}
          onAdd={() => void pickFile()}
          onCreateCollection={() => setModal({ kind: 'newCollection' })}
          onDeleteCollection={(name) =>
            setModal({
              kind: 'confirm',
              title: 'Delete collection?',
              message: `The collection "${name}" will be deleted. Its books stay in the library.`,
              confirmLabel: 'Delete',
              onConfirm: () => {
                setLocation({ shelf: 'collections' });
                void deleteCollection(platform, name).then(refreshLibrary);
              },
            })
          }
          onSettings={() => setView({ kind: 'settings' })}
          onAbout={() => setModal({ kind: 'about' })}
        />
      )}

      {modal?.kind === 'about' && engine && <AboutDialog engine={engine} onClose={() => setModal(null)} />}
      {modal?.kind === 'confirm' && <ConfirmDialog title={modal.title} message={modal.message} confirmLabel={modal.confirmLabel} onConfirm={modal.onConfirm} onClose={() => setModal(null)} />}
      {modal?.kind === 'newCollection' && <PromptDialog title="New collection" label="Collection name" confirmLabel="Create" onSubmit={createCollection} onClose={() => setModal(null)} />}
      {collectionsEntry && (
        <CollectionsDialog
          bookTitle={collectionsEntry.title}
          names={allCollections}
          selected={collectionsEntry.collections ?? []}
          onChange={(selected) => setFlags(collectionsEntry.id, { collections: selected })}
          onCreate={createCollection}
          onClose={() => setModal(null)}
        />
      )}
      {dragging && <div className="drop-overlay">Drop a book to open it</div>}
      {busy && <div className="toast">{busy}</div>}
      {notice && !busy && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="toast toast-error" role="alert">
          {error}
          <button type="button" className="link-button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
