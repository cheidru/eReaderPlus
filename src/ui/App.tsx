import { App as CapacitorApp } from '@capacitor/app';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { addBook, loadLibrary, loadSettings, removeBook, saveSettings } from '../core/library';
import { DEFAULT_SETTINGS, type LibraryEntry, type ReaderSettings } from '../core/types';
import { detectPlatform, type EngineInfo, type FileRef } from '../platform';
import { AboutDialog } from './AboutDialog';
import { LibraryView } from './library/LibraryView';
import { ReaderView } from './reader/ReaderView';

type View = { kind: 'library' } | { kind: 'reader'; bookId: string };

export function App() {
  const platform = useMemo(detectPlatform, []);
  const [view, setView] = useState<View>({ kind: 'library' });
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const refreshLibrary = useCallback(async () => {
    if (platform) setEntries(await loadLibrary(platform));
  }, [platform]);

  const openFile = useCallback(
    async (file: FileRef) => {
      if (!platform) return;
      setError(null);
      setBusy(`Importing ${file.name}…`);
      try {
        const entry = await addBook(platform, file);
        await refreshLibrary();
        setView({ kind: 'reader', bookId: entry.id });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [platform, refreshLibrary],
  );

  useEffect(() => {
    if (!platform) return;
    void refreshLibrary();
    void loadSettings(platform).then(setSettings);
    void platform.engineInfo().then(setEngine);
    return platform.onOpenFile((file) => void openFile(file));
  }, [platform, refreshLibrary, openFile]);

  useEffect(() => {
    if (platform?.kind !== 'android') return;
    const handle = CapacitorApp.addListener('backButton', () => {
      if (viewRef.current.kind === 'reader') setView({ kind: 'library' });
      else void CapacitorApp.exitApp();
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

  if (!platform) {
    return (
      <div className="app-unsupported">
        eReaderPlus runs inside its desktop (Electron) or Android shell. Start it with <code>npm run dev:desktop</code>.
      </div>
    );
  }

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

  const onRemove = async (bookId: string) => {
    await removeBook(platform, bookId);
    await refreshLibrary();
  };

  return (
    <div
      className="app"
      data-theme={settings.theme}
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

      {view.kind === 'library' ? (
        <LibraryView
          platform={platform}
          entries={entries}
          onOpen={(bookId) => setView({ kind: 'reader', bookId })}
          onAdd={() => void pickFile()}
          onRemove={(bookId) => void onRemove(bookId)}
          onAbout={() => setAboutOpen(true)}
        />
      ) : (
        <ReaderView
          key={view.bookId}
          platform={platform}
          bookId={view.bookId}
          settings={settings}
          onSettingsChange={updateSettings}
          onClose={() => {
            setView({ kind: 'library' });
            void refreshLibrary();
          }}
          onError={setError}
        />
      )}

      {aboutOpen && engine && <AboutDialog engine={engine} onClose={() => setAboutOpen(false)} />}
      {dragging && <div className="drop-overlay">Drop a book to open it</div>}
      {busy && <div className="toast">{busy}</div>}
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
