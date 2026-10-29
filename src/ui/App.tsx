import { App as CapacitorApp } from '@capacitor/app';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  addBook,
  backfillCovers,
  backfillSeries,
  bookFromFile,
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
import { checkForAppUpdate, UPDATE_DISMISSED_KEY, type AppUpdate } from '../core/app-updates';
import { loadWatchedFolders, saveWatchedFolders, scanWatchedFolders, withFolder, type ScanResult } from '../core/folders';
import type { ImportPreview } from '../core/import';
import { isReading, type LibraryLocation, type Shelf } from '../core/shelves';
import { DEFAULT_LIBRARY_PREFS, DEFAULT_SETTINGS, type EntryFlags, type LibraryEntry, type LibraryPrefs, type ReaderSettings } from '../core/types';
import { detectPlatform, type EngineInfo, type FileRef } from '../platform';
import { AboutDialog } from './AboutDialog';
import { BookWaitDialog, CollectionsDialog, ConfirmDialog, FolderAccessDialog, PromptDialog } from './Dialogs';
import { FormatsButton } from './FormatsButton';
import { importingTitle, type ImportingBook } from './library/BookItems';
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
  | { kind: 'about' }
  | { kind: 'folderAccess' };

/** Set once the first-run request for folder access has been shown, so it is never shown again. */
const FOLDER_ACCESS_ASKED_KEY = 'folder-access-asked';

export function App() {
  const platform = useMemo(detectPlatform, []);
  const [view, setView] = useState<View>({ kind: 'library' });
  const [location, setLocation] = useState<LibraryLocation>({ shelf: 'reading' });
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [collectionNames, setCollectionNames] = useState<string[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [prefs, setPrefs] = useState<LibraryPrefs>(DEFAULT_LIBRARY_PREFS);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  /** A newer Android release, which the user installs from its APK (the desktop app updates itself). */
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  /** Desktop: a newer version downloaded in the background, offered as a restart until the reader says later. */
  const [updateReady, setUpdateReady] = useState<string | null>(null);
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
  /** Book files being imported, shown as cards until their books are in the library. */
  const [importing, setImporting] = useState<ImportingBook[]>([]);
  /** The import (key) whose book the reader is waiting to open: it opens once imported. */
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const waitingRef = useRef(waitingFor);
  waitingRef.current = waitingFor;
  /**
   * Until the files the app was started to open are known, and the first of them is found in the library or being
   * imported, the library is not drawn: a book opened from the OS shows without the library showing first.
   */
  const [launching, setLaunching] = useState(true);
  const back = useRef<() => boolean>(() => false);

  const refreshLibrary = useCallback(async () => {
    if (!platform) return;
    const [library, names] = await Promise.all([loadLibrary(platform), loadCollections(platform)]);
    setEntries(library);
    setCollectionNames(names);
  }, [platform]);

  const showNotice = useCallback((text: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  /**
   * Shows a book file being imported on the shelves, as a card that gets the book's cover and title as soon as the
   * importer knows them and can be clicked meanwhile. `done` takes the card away once the book is in the library
   * (or failed: null), and opens the book if the reader is waiting for it; it returns whether it did.
   */
  const showImporting = useCallback((file: FileRef) => {
    const key = crypto.randomUUID();
    setImporting((list) => [...list, { key, fileName: file.name, preview: null }]);
    return {
      key,
      preview: (preview: ImportPreview) => setImporting((list) => list.map((b) => (b.key === key ? { ...b, preview } : b))),
      done: (bookId: string | null) => {
        setImporting((list) => list.filter((b) => b.key !== key));
        if (waitingRef.current !== key) return false;
        setWaitingFor(null);
        if (!bookId) return false;
        setView({ kind: 'reader', bookId, from: 'library' });
        return true;
      },
    };
  }, []);

  /**
   * Imports a book file. It shows on the shelves at once, with its cover as soon as that is read, while the rest of
   * it is imported in the background. `open`: the reader asked to read it (rather than add it), so it opens once
   * imported, with a wait shown until then.
   */
  const openFile = useCallback(
    async (file: FileRef, { open }: { open: boolean }) => {
      if (!platform) return;
      setError(null);
      const shown = showImporting(file);
      if (open) setWaitingFor(shown.key);
      try {
        const { entry, isNew } = await addBook(platform, file, { onPreview: shown.preview });
        await refreshLibrary();
        if (!shown.done(entry.id)) showNotice(isNew ? `Added "${entry.title}"` : `"${entry.title}" is already in the library`);
      } catch (e) {
        shown.done(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [platform, refreshLibrary, showImporting, showNotice],
  );

  /**
   * Reads a book file: the book imported from it, without importing it again, while the file is unchanged since
   * (`unchecked`: see bookFromFile); else imports it and opens it once imported.
   */
  const readFile = useCallback(
    async (file: FileRef, { unchecked }: { unchecked: boolean }) => {
      if (!platform) return;
      const imported = await bookFromFile(platform, file, { unchecked }).catch(() => null);
      if (imported) setView({ kind: 'reader', bookId: imported.id, from: 'library' });
      else void openFile(file, { open: true });
    },
    [platform, openFile],
  );

  /** Imports new books from the watched folders, with progress in a snackbar, like ReadEra's file scan. */
  const runScan = useCallback(async () => {
    if (!platform) return;
    setScanning(true);
    setBusy('Scanning folders…');
    try {
      let shown: ReturnType<typeof showImporting> | null = null;
      const result = await scanWatchedFolders(platform, {
        onProgress: (done, total) => setBusy(`Adding books from folders… ${done} of ${total}`),
        onImporting: (file) => {
          shown = showImporting(file);
        },
        onPreview: (preview) => shown?.preview(preview),
        // Each book shows up as soon as it is added, not when the whole scan is done.
        onImported: (entry) => {
          const imported = shown;
          shown = null;
          if (!entry && imported && waitingRef.current === imported.key) setError('The book could not be imported.');
          void refreshLibrary().then(() => imported?.done(entry?.id ?? null));
        },
      }).finally(() => shown?.done(null));
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
  }, [platform, refreshLibrary, showNotice, showImporting]);

  useEffect(() => {
    if (!platform) return;
    void refreshLibrary().then(async () => {
      const [series, covers] = [await backfillSeries(platform), await backfillCovers(platform)];
      if (series || covers) await refreshLibrary();
      const folders = await loadWatchedFolders(platform);
      setWatchedFolders(folders);
      if (folders.length > 0 && (await platform.hasFolderAccess())) await runScan();
    });
    void loadSettings(platform).then(setSettings);
    void loadLibraryPrefs(platform).then(setPrefs);
    void platform.engineInfo().then(setEngine);
    return platform.onOpenFile(
      (file) => void readFile(file, { unchecked: false }).finally(() => setLaunching(false)),
      (count) => count === 0 && setLaunching(false),
    );
  }, [platform, refreshLibrary, readFile, runScan]);

  // Android's back button steps back through dialogs, pages and library groups before leaving the app.
  back.current = () => {
    if (waitingFor) setWaitingFor(null);
    else if (modal) setModal(null);
    else if (view.kind === 'reader') closeReader();
    else if (view.kind === 'folderPicker') setView({ kind: 'settings' });
    else if (view.kind !== 'library') setView({ kind: 'library' });
    else if (location.group !== undefined) setLocation({ shelf: location.shelf });
    else return false;
    return true;
  };
  // The first run on Android starts by asking for access to the device's files.
  useEffect(() => {
    if (platform?.kind !== 'android') return;
    void (async () => {
      if (await platform.kvGet<boolean>(FOLDER_ACCESS_ASKED_KEY)) return;
      await platform.kvSet(FOLDER_ACCESS_ASKED_KEY, true);
      if (!(await platform.hasFolderAccess())) setModal({ kind: 'folderAccess' });
    })();
  }, [platform]);

  useEffect(() => platform?.onUpdateReady?.(setUpdateReady), [platform]);

  useEffect(() => {
    if (platform?.kind !== 'android') return;
    void checkForAppUpdate(__APP_VERSION__).then(async (found) => {
      if (found && (await platform.kvGet<string>(UPDATE_DISMISSED_KEY)) !== found.version) setUpdate(found);
    });
  }, [platform]);

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

  /** A shelf tab in the reader's top bar: closes the book onto that shelf. */
  function readerToShelf(shelf: Shelf) {
    setLocation({ shelf });
    setView({ kind: 'library' });
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

  /** Adds a book file to the library: a file imported before, unchanged since, isn't imported again. */
  const addFile = async (file: FileRef) => {
    const imported = await bookFromFile(platform, file, { unchecked: false }).catch(() => null);
    if (imported) showNotice(`"${imported.title}" is already in the library`);
    else await openFile(file, { open: false });
  };

  const pickFile = async () => {
    const file = await platform.pickBookFile();
    if (file) await addFile(file);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    const file = dropped && platform.fileFromDrop(dropped);
    if (file) void addFile(file);
  };

  const books: BookHandlers = {
    onOpen: (bookId) => setView({ kind: 'reader', bookId, from: view.kind === 'details' ? 'details' : 'library' }),
    onDetails: (bookId) => setView({ kind: 'details', bookId }),
    onToggle: (bookId, flag: ToggleFlag) => {
      const entry = entries.find((e) => e.id === bookId);
      if (!entry) return;
      const on = flag === 'reading' ? !isReading(entry) : !entry[flag];
      // A book is being read, waiting to be read or finished: one of them at a time.
      if (flag === 'finished') setFlags(bookId, on ? { finished: true, toRead: false } : { finished: false });
      else if (flag === 'toRead') setFlags(bookId, on ? { toRead: true, reading: false, finished: false } : { toRead: false });
      else if (flag === 'reading') setFlags(bookId, on ? { reading: true, toRead: false, finished: false } : { reading: false });
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

  const waitingBook = importing.find((b) => b.key === waitingFor);
  const detailsEntry = view.kind === 'details' ? entries.find((e) => e.id === view.bookId) : undefined;
  const collectionsEntry = modal?.kind === 'collections' ? entries.find((e) => e.id === modal.bookId) : undefined;
  const formatsButton = <FormatsButton filter={prefs.filter} onChange={(filter) => updatePrefs({ ...prefs, filter })} />;

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
      {update && (
        <div className="app-banner" role="status">
          eReaderPlus {update.version} is available.
          <button type="button" className="link-button" onClick={() => void platform.openExternal(update.url)}>
            Download
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setUpdate(null);
              void platform.kvSet(UPDATE_DISMISSED_KEY, update.version);
            }}
          >
            Not now
          </button>
        </div>
      )}

      {updateReady && (
        <div className="app-banner" role="status">
          eReaderPlus {updateReady} is ready. It installs when you close the app.
          <button type="button" className="link-button" onClick={() => void platform.installUpdate?.()}>
            Restart now
          </button>
          <button type="button" className="link-button" onClick={() => setUpdateReady(null)}>
            Later
          </button>
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
          onShelf={readerToShelf}
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
          formatsButton={formatsButton}
          onChange={updatePrefs}
          onBack={() => setView({ kind: 'library' })}
          onAbout={() => setModal({ kind: 'about' })}
        />
      ) : view.kind === 'folderPicker' ? (
        <FolderPicker
          platform={platform}
          formatsButton={formatsButton}
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
          formatsButton={formatsButton}
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
      ) : launching ? null : (
        <LibraryView
          platform={platform}
          entries={entries}
          importing={importing}
          onOpenImporting={setWaitingFor}
          collections={allCollections}
          prefs={prefs}
          location={location}
          onLocationChange={setLocation}
          onPrefsChange={updatePrefs}
          books={books}
          onOpenFile={(file) => void readFile(file, { unchecked: true })}
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

      {modal?.kind === 'folderAccess' && platform && <FolderAccessDialog onAllow={() => void platform.requestFolderAccess()} onClose={() => setModal(null)} />}
      {modal?.kind === 'about' && engine &&<AboutDialog engine={engine} onClose={() => setModal(null)} />}
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
      {waitingBook && <BookWaitDialog title={importingTitle(waitingBook)} onClose={() => setWaitingFor(null)} />}
      {dragging && <div className="drop-overlay">Drop a book to add it</div>}
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
