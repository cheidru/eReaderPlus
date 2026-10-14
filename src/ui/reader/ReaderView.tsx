import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { bookTexts, findInTexts, isSearchable } from '../../core/booksearch';
import { loadManifest } from '../../core/import';
import { loadProgress, markOpened, overallProgress, saveProgress } from '../../core/library';
import { MESSAGE_TAG, parseFrameMessage, type FrameSettings, type GotoTarget, type HostMessage } from '../../core/messages';
import { splitFragment } from '../../core/paths';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, type BookManifest, type Progress, type ReaderSettings, type TocItem } from '../../core/types';
import { bookUrl, type Platform } from '../../platform';
import { Icon } from '../icons';
import { MIN_QUERY_LENGTH, NO_SEARCH, SearchPanel, type SearchState } from './SearchPanel';
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

type Panel = 'toc' | 'settings' | 'search' | null;

const WHEEL_THROTTLE_MS = 250;
/** Search waits until typing pauses this long. */
const SEARCH_DELAY_MS = 300;
/** Above this many documents, chapter marks on the position slider would merge into a solid bar. */
const MAX_SLIDER_MARKS = 120;

export function ReaderView({ platform, bookId, settings, onSettingsChange, onClose, onError }: Props) {
  const [manifest, setManifest] = useState<BookManifest | null>(null);
  const [spineIndex, setSpineIndex] = useState(0);
  const [location, setLocation] = useState<Location>({ page: 0, pageCount: 1, fraction: 0 });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [search, setSearch] = useState<SearchState>(NO_SEARCH);
  /** Stops reading the book's text for search when the book is closed. */
  const searchAbort = useRef(new AbortController());

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

  useEffect(() => {
    // Created here, not at first render: React's StrictMode unmounts and remounts once in development.
    const controller = new AbortController();
    searchAbort.current = controller;
    return () => controller.abort();
  }, []);

  // Search inside the book: once typing pauses, reads the book's text (only for the first search) and finds matches.
  const query = search.query;
  useEffect(() => {
    if (!manifest || !isSearchable(manifest)) return;
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setSearch((s) => ({ ...s, hits: [], hitsQuery: '', error: null, current: null }));
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      bookTexts(platform, manifest, (progress) => setSearch((s) => ({ ...s, progress })), searchAbort.current.signal)
        .then((texts) => {
          if (!stale) setSearch((s) => ({ ...s, hits: findInTexts(texts, query), hitsQuery: query, progress: null, error: null, current: null }));
        })
        .catch((e: unknown) => {
          if (!stale && !searchAbort.current.signal.aborted) {
            setSearch((s) => ({ ...s, progress: null, error: `The book could not be searched: ${e instanceof Error ? e.message : String(e)}` }));
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [platform, manifest, query]);

  /** Each spine document's chapter (its own or the last one before it), or its page for PDF. */
  const sectionLabels = useMemo(() => {
    if (!manifest) return [];
    if (manifest.format === 'pdf') return manifest.spine.map((_, i) => `Page ${i + 1}`);
    let last = manifest.title;
    return manifest.spine.map((item) => (last = findTocLabel(manifest.toc, item.href) ?? last));
  }, [manifest]);

  const goToHit = (index: number) => {
    const hit = search.hits[index];
    if (!hit) return;
    setSearch((s) => ({ ...s, current: index }));
    setPanel(null);
    navigate(hit.spineIndex, { kind: 'search', query: search.hitsQuery, occurrence: hit.occurrence });
  };

  const closeSearch = () => {
    post({ tag: MESSAGE_TAG, type: 'clearSearch' });
    setSearch(NO_SEARCH);
    if (panel === 'search') setPanel(null);
  };

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
  const chapterTitle = findTocLabel(manifest.toc, manifest.spine[spineIndex].href);
  const showPageNumbers = settings.flow === 'paginated' && manifest.layout === 'reflowable';
  const percent = Math.round(overall * 100);
  const spineCount = manifest.spine.length;
  const marks = spineCount > 1 && spineCount <= MAX_SLIDER_MARKS ? Array.from({ length: spineCount - 1 }, (_, i) => (i + 1) / spineCount) : [];

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

      {chromeVisible ? (
        <>
          <header className="reader-bar reader-top">
            <div className="reader-toolbar">
              <button type="button" className="icon-button" onClick={onClose} aria-label="Back to library">
                <Icon name="back" />
              </button>
              <span className="reader-toolbar-space" />
              {isSearchable(manifest) && (
                <button type="button" className="icon-button" onClick={() => setPanel(panel === 'search' ? null : 'search')} aria-label="Search in book" aria-expanded={panel === 'search'}>
                  <Icon name="search" />
                </button>
              )}
              <button type="button" className="icon-button" onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="Contents" aria-expanded={panel === 'toc'}>
                <Icon name="toc" />
              </button>
              <button type="button" className="icon-button" onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="Display settings" aria-expanded={panel === 'settings'}>
                <Icon name="settings" />
              </button>
            </div>
            <div className="reader-heading">
              <span className="reader-title">{manifest.title}</span>
              {manifest.authors.length > 0 && <span className="reader-subtitle">{manifest.authors.join(', ')}</span>}
              {(chapterTitle || showPageNumbers) && (
                <span className="reader-subtitle">
                  {chapterTitle}
                  {chapterTitle && showPageNumbers ? ' · ' : ''}
                  {showPageNumbers ? `p. ${location.page + 1}/${location.pageCount}` : ''}
                </span>
              )}
            </div>
          </header>

          {search.current !== null && panel !== 'search' && (
            <div className="reader-searchbar" role="group" aria-label="Search results">
              <button type="button" className="icon-button" disabled={search.current === 0} onClick={() => goToHit(search.current! - 1)} aria-label="Previous result">
                <Icon name="chevronLeft" />
              </button>
              <button type="button" className="reader-searchbar-label" onClick={() => setPanel('search')} title="Show all results">
                <span className="reader-searchbar-query">“{search.hitsQuery.trim()}”</span>
                <span>
                  {search.current + 1} of {search.hits.length}
                </span>
              </button>
              <button type="button" className="icon-button" disabled={search.current === search.hits.length - 1} onClick={() => goToHit(search.current! + 1)} aria-label="Next result">
                <Icon name="chevronRight" />
              </button>
              <button type="button" className="icon-button" onClick={closeSearch} aria-label="Close search">
                <Icon name="close" />
              </button>
            </div>
          )}

          <footer className="reader-bar reader-bottom">
            <div className="reader-numbers-row">
              <button type="button" className="icon-button" onClick={() => visualTurn(-1)} aria-label="Previous page">
                <Icon name="chevronLeft" />
              </button>
              <span className="reader-numbers">
                {showPageNumbers ? `Page ${location.page + 1} of ${location.pageCount} · ` : ''}
                {percent}%
              </span>
              <button type="button" className="icon-button" onClick={() => visualTurn(1)} aria-label="Next page">
                <Icon name="chevronRight" />
              </button>
            </div>
            <div className="reader-slider-wrap">
              <div className="reader-marks" aria-hidden="true">
                {marks.map((at) => (
                  <span key={at} className="reader-mark" style={{ left: `${at * 100}%` }} />
                ))}
              </div>
              <input
                type="range"
                className="reader-slider"
                style={{ '--fill': `${overall * 100}%` } as CSSProperties}
                min={0}
                max={1000}
                value={Math.round(overall * 1000)}
                onChange={(e) => {
                  const position = (Number(e.target.value) / 1000) * spineCount;
                  const index = Math.min(spineCount - 1, Math.floor(position));
                  navigate(index, { kind: 'fraction', value: position - index });
                }}
                aria-label="Position in book"
              />
            </div>
          </footer>
        </>
      ) : (
        <div className="reader-folio" aria-hidden="true">
          {showPageNumbers ? `${location.page + 1} / ${location.pageCount}` : `${percent}%`}
        </div>
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
      {panel === 'search' && (
        <SearchPanel
          search={search}
          sectionLabel={(i) => sectionLabels[i] ?? ''}
          onQueryChange={(text) => setSearch((s) => ({ ...s, query: text }))}
          onSelect={goToHit}
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
