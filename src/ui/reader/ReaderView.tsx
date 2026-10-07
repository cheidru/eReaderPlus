import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadManifest } from '../../core/import';
import { loadProgress, markOpened, overallProgress, saveProgress } from '../../core/library';
import { MESSAGE_TAG, parseFrameMessage, type FrameSettings, type GotoTarget, type HostMessage } from '../../core/messages';
import { splitFragment } from '../../core/paths';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, type BookManifest, type Progress, type ReaderSettings, type TocItem } from '../../core/types';
import { bookUrl, type Platform } from '../../platform';
import { SettingsPanel } from './SettingsPanel';
import { TocPanel } from './TocPanel';
import './ReaderView.css';

interface Props {
  platform: Platform;
  bookId: string;
  settings: ReaderSettings;
  onSettingsChange: (settings: ReaderSettings) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

interface Location {
  page: number;
  pageCount: number;
  fraction: number;
}

type Panel = 'toc' | 'settings' | null;

const WHEEL_THROTTLE_MS = 250;

export function ReaderView({ platform, bookId, settings, onSettingsChange, onClose, onError }: Props) {
  const [manifest, setManifest] = useState<BookManifest | null>(null);
  const [spineIndex, setSpineIndex] = useState(0);
  const [location, setLocation] = useState<Location>({ page: 0, pageCount: 1, fraction: 0 });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** Where to go once the next spine document reports `ready`. */
  const pendingTarget = useRef<GotoTarget>({ kind: 'fraction', value: 0 });
  /** True once the current spine document's paginator has announced itself. */
  const frameReady = useRef(false);
  const lastWheel = useRef(0);
  /** Fixed layout: the zoom the reader chose, carried over to the pages that follow. */
  const fixedZoom = useRef({ zoom: 1, panX: 0.5 });
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Progress | null>(null);
  const origin = platform.bookOrigin(bookId);
  // Callbacks from the parent change identity on every render; the book must load exactly once.
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
  onCloseRef.current = onClose;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, progress] = await Promise.all([loadManifest(platform, bookId), loadProgress(platform, bookId)]);
        if (cancelled) return;
        const index = progress ? Math.min(progress.spineIndex, m.spine.length - 1) : 0;
        pendingTarget.current = { kind: 'fraction', value: progress?.fraction ?? 0 };
        setSpineIndex(index);
        setManifest(m);
        void markOpened(platform, bookId);
      } catch (e) {
        onErrorRef.current(`Could not open the book: ${e instanceof Error ? e.message : String(e)}`);
        onCloseRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, bookId]);

  const flushSave = useCallback(() => {
    const progress = pendingSave.current;
    pendingSave.current = null;
    if (progress) saveProgress(platform, bookId, progress).catch((e: unknown) => console.error('Saving reading position failed:', e));
  }, [platform, bookId]);

  const frameSettings = useMemo<FrameSettings | null>(
    () => (manifest ? { ...settings, layout: manifest.layout } : null),
    [settings, manifest],
  );

  const post = useCallback(
    (message: HostMessage) => {
      if (frameReady.current) iframeRef.current?.contentWindow?.postMessage(message, origin);
    },
    [origin],
  );

  const navigate = useCallback(
    (index: number, target: GotoTarget) => {
      if (!manifest || index < 0 || index >= manifest.spine.length) return;
      if (index === spineIndex) {
        post({ tag: MESSAGE_TAG, type: 'goto', target });
      } else {
        pendingTarget.current = target;
        frameReady.current = false;
        setSpineIndex(index);
      }
    },
    [manifest, spineIndex, post],
  );

  const navigateHref = useCallback(
    (href: string) => {
      if (!manifest || !href) return;
      const [rawPath, fragment] = splitFragment(href);
      const path = manifest.aliases?.[rawPath] ?? rawPath;
      const index = manifest.spine.findIndex((item) => item.href === path);
      if (index < 0) return;
      navigate(index, fragment ? { kind: 'fragment', value: fragment } : { kind: 'fraction', value: 0 });
    },
    [manifest, navigate],
  );

  const turn = useCallback(
    (dir: 1 | -1) => post({ tag: MESSAGE_TAG, type: 'turn', dir }),
    [post],
  );

  /** Maps a visual direction (1 = right/forward on screen) to reading direction. */
  const visualTurn = useCallback(
    (visual: 1 | -1) => turn(manifest?.direction === 'rtl' ? ((-visual) as 1 | -1) : visual),
    [turn, manifest],
  );

  const handleKey = useCallback(
    (key: string) => {
      if (key === 'Escape') {
        if (panel) setPanel(null);
        else setChromeVisible((v) => !v);
      } else if (key === 'ArrowRight') visualTurn(1);
      else if (key === 'ArrowLeft') visualTurn(-1);
      else if (key === 'PageDown' || key === 'ArrowDown' || key === ' ') turn(1);
      else if (key === 'PageUp' || key === 'ArrowUp') turn(-1);
      else if (key === 'Home') navigate(0, { kind: 'fraction', value: 0 });
      else if (key === 'End' && manifest) navigate(manifest.spine.length - 1, { kind: 'end' });
    },
    [panel, visualTurn, turn, navigate, manifest],
  );

  // Messages from the book frame. Only accepted from our iframe and the book's own origin.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== origin) return;
      const message = parseFrameMessage(event.data);
      if (!message || !manifest) return;
      switch (message.type) {
        case 'ready':
          frameReady.current = true;
          if (frameSettings) post({ tag: MESSAGE_TAG, type: 'settings', settings: frameSettings });
          post({ tag: MESSAGE_TAG, type: 'goto', target: pendingTarget.current });
          if (manifest.layout === 'pre-paginated') post({ tag: MESSAGE_TAG, type: 'zoom', ...fixedZoom.current });
          break;
        case 'relocate':
          setLocation(message);
          pendingSave.current = {
            spineIndex,
            fraction: message.fraction,
            overall: overallProgress(manifest, spineIndex, message.fraction),
            updatedAt: Date.now(),
          };
          window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(flushSave, 400);
          break;
        case 'edge':
          navigate(spineIndex + message.dir, message.dir === 1 ? { kind: 'fraction', value: 0 } : { kind: 'end' });
          break;
        case 'tap':
          if (panel) setPanel(null);
          else if (message.x < 0.3) visualTurn(-1);
          else if (message.x > 0.7) visualTurn(1);
          else setChromeVisible((v) => !v);
          break;
        case 'swipe':
          visualTurn(message.dir);
          break;
        case 'key':
          handleKey(message.key);
          break;
        case 'wheel': {
          const now = Date.now();
          if (now - lastWheel.current < WHEEL_THROTTLE_MS || Math.abs(message.delta) < 4) break;
          lastWheel.current = now;
          turn(message.delta > 0 ? 1 : -1);
          break;
        }
        case 'zoom':
          fixedZoom.current = { zoom: message.zoom, panX: message.panX };
          break;
        case 'textzoom': {
          // Like the font size buttons, which publisher layout turns off.
          if (manifest.layout !== 'reflowable' || !settings.overrideStyles) break;
          const fontScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, settings.fontScale + message.dir * FONT_SCALE_STEP));
          if (fontScale !== settings.fontScale) onSettingsChange({ ...settings, fontScale });
          break;
        }
        case 'link':
          navigateHref(message.href);
          break;
        case 'external':
          void platform.openExternal(message.href);
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, manifest, settings, onSettingsChange, frameSettings, post, platform, spineIndex, navigate, navigateHref, panel, visualTurn, turn, handleKey, flushSave]);

  // Push settings changes to the current document.
  useEffect(() => {
    if (frameSettings) post({ tag: MESSAGE_TAG, type: 'settings', settings: frameSettings });
  }, [frameSettings, post]);

  // Keyboard when focus is in the app rather than inside the book frame.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Home', 'End', 'Escape'].includes(event.key)) {
        event.preventDefault();
        handleKey(event.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleKey]);

  // Closing the book must not lose a position change that is still waiting for the debounce.
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      flushSave();
    },
    [flushSave],
  );

  if (!manifest) return <div className="reader reader-loading">Opening…</div>;

  const overall = overallProgress(manifest, spineIndex, location.fraction);
  const chapterTitle = findTocLabel(manifest.toc, manifest.spine[spineIndex].href) ?? manifest.title;
  const showPageNumbers = settings.flow === 'paginated' && manifest.layout === 'reflowable';

  return (
    <div className={chromeVisible ? 'reader' : 'reader reader-immersive'} data-theme={settings.theme}>
      <iframe
        ref={iframeRef}
        className="reader-frame"
        title={manifest.title}
        src={bookUrl(platform, bookId, manifest.spine[spineIndex].href)}
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen; autoplay"
      />

      {chromeVisible && (
        <>
          <header className="reader-bar reader-top">
            <button type="button" className="icon-button" onClick={onClose} aria-label="Back to library">
              ←
            </button>
            <span className="reader-title">{manifest.title}</span>
            <button type="button" className="icon-button" onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="Contents">
              ☰
            </button>
            <button type="button" className="icon-button" onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="Display settings">
              Aa
            </button>
          </header>

          <footer className="reader-bar reader-bottom">
            <button type="button" className="icon-button" onClick={() => visualTurn(-1)} aria-label="Previous page">
              ‹
            </button>
            <div className="reader-position">
              <span className="reader-chapter">{chapterTitle}</span>
              <input
                type="range"
                className="reader-slider"
                min={0}
                max={1000}
                value={Math.round(overall * 1000)}
                onChange={(e) => {
                  const position = (Number(e.target.value) / 1000) * manifest.spine.length;
                  const index = Math.min(manifest.spine.length - 1, Math.floor(position));
                  navigate(index, { kind: 'fraction', value: position - index });
                }}
                aria-label="Position in book"
              />
              <span className="reader-numbers">
                {showPageNumbers ? `Page ${location.page + 1} of ${location.pageCount} · ` : ''}
                {Math.round(overall * 100)}%
              </span>
            </div>
            <button type="button" className="icon-button" onClick={() => visualTurn(1)} aria-label="Next page">
              ›
            </button>
          </footer>
        </>
      )}

      {panel === 'toc' && (
        <TocPanel
          toc={manifest.toc}
          currentHref={manifest.spine[spineIndex].href}
          onSelect={(href) => {
            setPanel(null);
            navigateHref(href);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'settings' && (
        <SettingsPanel settings={settings} fixedLayout={manifest.layout === 'pre-paginated'} onChange={onSettingsChange} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

function findTocLabel(items: TocItem[], spineHref: string): string | null {
  for (const item of items) {
    if (splitFragment(item.href)[0] === spineHref) return item.label;
    const nested = findTocLabel(item.children, spineHref);
    if (nested) return nested;
  }
  return null;
}
