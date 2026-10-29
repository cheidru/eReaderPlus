import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { bookTexts, findInTexts, isSearchable } from '../../core/booksearch';
import { DJVU_SOURCE, loadDjvuLibrary } from '../../core/djvu';
import { DjvuPageStore, openDjvuWorkers, pageMemoryBudget } from '../../core/djvu-pages';
import { assignSlots, FRAME_SLOTS, wantedDocuments } from '../../core/frames';
import { openManifest } from '../../core/import';
import { loadBookView, loadProgress, markOpened, overallProgress, saveBookView, saveProgress, type BookView } from '../../core/library';
import { MESSAGE_TAG, parseFrameMessage, type DjvuPageData, type FixedSpread, type FrameSettings, type GotoTarget, type HostMessage } from '../../core/messages';
import type { PdfPageData } from '../../core/pdf-common';
import { splitFragment } from '../../core/paths';
import { loadPdfLibrary, PDF_SOURCE } from '../../core/pdf';
import { openPdfRenderer } from '../../core/pdf-common';
import { PdfPageStore } from '../../core/pdf-pages';
import type { Shelf } from '../../core/shelves';
import { hasPageSpreads, spreadEnd, spreadFits, spreadStart } from '../../core/spread';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, type BookManifest, type Progress, type ReaderSettings, type TocItem } from '../../core/types';
import { bookUrl, type Platform } from '../../platform';
import { GalaxySpinner } from '../GalaxySpinner';
import { Icon } from '../icons';
import { ShelfTabs } from '../library/ShelfTabs';
import { ImageViewer } from './ImageViewer';
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
  /** A shelf tab in the top bar: closes the book and shows that shelf. */
  onShelf: (shelf: Shelf) => void;
  onError: (message: string) => void;
}

interface Location {
  page: number;
  pageCount: number;
  fraction: number;
}

type Panel = 'toc' | 'settings' | 'search' | null;

/** A frame holding a spine document (see frames.ts). */
interface FrameState {
  index: number | null;
  /** Where to go once the document's paginator announces itself. */
  target: GotoTarget;
  /** The paginator has announced itself and been sent the settings. */
  ready: boolean;
  /**
   * Whether the document shows its content: once its paginator announces itself, or for PDF and DjVu once the app has
   * sent it its page (drawing or decoding a page can take a while). The galaxy spinner shows while the current
   * document doesn't.
   */
  shown: boolean;
}

const NO_FRAME: FrameState = { index: null, target: { kind: 'fraction', value: 0 }, ready: false, shown: false };

const WHEEL_THROTTLE_MS = 250;
/** A wheel spin goes on to the frame it began over until the wheel rests this long (a little longer than Chromium waits). */
const WHEEL_SPIN_MS = 1000;
/** Search waits until typing pauses this long. */
const SEARCH_DELAY_MS = 300;
/** A page that takes longer than this to show gets the galaxy spinner; quicker ones don't flash it. */
const WAIT_SPINNER_DELAY_MS = 300;
/**
 * A document that has loaded is taken to have no paginator once it hasn't announced itself for this long: the
 * paginator's announcement can arrive after the frame's load event.
 */
const READY_GRACE_MS = 500;
/** Above this many documents, chapter marks on the position slider would merge into a solid bar. */
const MAX_SLIDER_MARKS = 120;

export function ReaderView({ platform, bookId, settings: appSettings, onSettingsChange, onClose, onShelf, onError }: Props) {
  const [manifest, setManifest] = useState<BookManifest | null>(null);
  /** This book's own one or two page view (and cover alone), saved with the book. */
  const [bookView, setBookView] = useState<BookView | null>(null);
  /** The reader's settings, with this book's own view. */
  const settings = useMemo<ReaderSettings>(() => (bookView ? { ...appSettings, ...bookView } : appSettings), [appSettings, bookView]);
  const [spineIndex, setSpineIndex] = useState(0);
  const [location, setLocation] = useState<Location>({ page: 0, pageCount: 1, fraction: 0 });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [search, setSearch] = useState<SearchState>(NO_SEARCH);
  /** The picture double-clicked in the book, shown over it to zoom and pan. */
  const [picture, setPicture] = useState<string | null>(null);
  /** Whether the book frame is landscape and wide enough for two pages (the paginator decides the same for text). */
  const [frameFitsSpread, setFrameFitsSpread] = useState(false);
  /** Stops reading the book's text for search when the book is closed. */
  const searchAbort = useRef(new AbortController());

  /** The spine document loaded in each frame (see frames.ts): the one shown, and the next and previous ones, ready to show. */
  const [slots, setSlots] = useState<readonly (number | null)[]>(() => Array<null>(FRAME_SLOTS).fill(null));
  const slotsRef = useRef(slots);
  /** The frame on screen: the current document's once it is ready, until then the one shown before (null: none yet). */
  const [visibleSlot, setVisibleSlot] = useState<number | null>(null);
  const visibleSlotRef = useRef(visibleSlot);
  const frames = useRef<FrameState[]>(Array.from({ length: FRAME_SLOTS }, () => ({ ...NO_FRAME })));
  const frameElements = useRef<(HTMLIFrameElement | null)[]>([]);
  /** Re-renders after a change to `frames`, which messages from the frames make. */
  const [, setFramesChanged] = useState(0);
  const spineIndexRef = useRef(0);
  const framesBox = useRef<HTMLDivElement>(null);
  const lastWheel = useRef(0);
  /** The frame the last wheel turn went to, and when: it keeps its document while the spin goes on (frames.ts). */
  const wheelFrame = useRef({ slot: -1, time: 0 });
  /** The frame out of sight that a wheel spin still goes to, drawn so its wheel events aren't held up (ReaderView.css). */
  const [spinSlot, setSpinSlot] = useState<number | null>(null);
  const spinTimer = useRef<number | undefined>(undefined);
  /** Fixed layout: the zoom the reader chose, carried over to the pages that follow. */
  const fixedZoom = useRef({ zoom: 1, panX: 0.5 });
  /** Whether Space, pressed while the app had the focus, holds the hand tool on a zoomed page. */
  const handHeld = useRef(false);
  /** DjVu: the open book, kept in memory and decoded ahead of the reader for the page documents. */
  const djvuPages = useRef<DjvuPageStore | null>(null);
  /** PDF: the open book, kept in the app and drawn ahead of the reader for the page documents. */
  const pdfPages = useRef<PdfPageStore | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Progress | null>(null);
  const origin = platform.bookOrigin(bookId);
  // Callbacks from the parent change identity on every render; the book must load exactly once.
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
  onCloseRef.current = onClose;
  onErrorRef.current = onError;
  const appSettingsRef = useRef(appSettings);
  appSettingsRef.current = appSettings;

  /**
   * Applies settings changed in the reader: the page view to this book (saved with it, and the view books opened for
   * the first time start with), everything else to every book.
   */
  const changeSettings = useCallback(
    (next: ReaderSettings) => {
      const { spread, spreadCover, ...rest } = next;
      if (bookView && (spread !== bookView.spread || spreadCover !== bookView.spreadCover)) {
        const view = { spread, spreadCover };
        setBookView(view);
        void saveBookView(platform, bookId, view);
      }
      onSettingsChange({ ...appSettings, ...rest, spread, spreadCover });
    },
    [platform, bookId, bookView, appSettings, onSettingsChange],
  );

  /**
   * Loads documents into frames (frames.ts), each to show at its target once ready, keeping the frame on screen.
   * Returns the slots, with each of the documents in one unless the frames were all taken.
   */
  const loadDocuments = useCallback((documents: { index: number; target: GotoTarget }[]) => {
    const before = slotsRef.current;
    const kept = [visibleSlotRef.current ?? -1];
    if (Date.now() - wheelFrame.current.time < WHEEL_SPIN_MS) kept.push(wheelFrame.current.slot);
    const after = assignSlots(before, documents.map((d) => d.index), kept);
    if (after === before) return before;
    after.forEach((index, slot) => {
      if (index === before[slot] || index === null) return;
      frames.current[slot] = { ...NO_FRAME, index, target: documents.find((d) => d.index === index)!.target };
    });
    slotsRef.current = after;
    setSlots(after);
    return after;
  }, []);

  /** Posts to the document in frame `slot`, once its paginator listens. */
  const postTo = useCallback(
    (slot: number, message: HostMessage) => {
      if (frames.current[slot]?.ready) frameElements.current[slot]?.contentWindow?.postMessage(message, origin);
    },
    [origin],
  );

  /** Keeps frame `slot` drawn while the wheel spin going to it goes on. */
  const holdSpin = useCallback((slot: number) => {
    setSpinSlot(slot);
    window.clearTimeout(spinTimer.current);
    spinTimer.current = window.setTimeout(() => setSpinSlot(null), WHEEL_SPIN_MS);
  }, []);

  /** Puts frame `slot` on screen, and the one there before out of sight. */
  const showSlot = useCallback(
    (slot: number) => {
      const before = visibleSlotRef.current;
      if (before !== null && before !== slot) {
        postTo(before, { tag: MESSAGE_TAG, type: 'shown', shown: false });
        if (wheelFrame.current.slot === before && Date.now() - wheelFrame.current.time < WHEEL_SPIN_MS) holdSpin(before);
      }
      postTo(slot, { tag: MESSAGE_TAG, type: 'shown', shown: true });
      visibleSlotRef.current = slot;
      setVisibleSlot(slot);
    },
    [postTo, holdSpin],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, progress, savedView] = await Promise.all([openManifest(platform, bookId), loadProgress(platform, bookId), loadBookView(platform, bookId)]);
        if (cancelled) return;
        // A book opened for the first time takes the view last chosen for another book, and keeps it from then on.
        const view = savedView ?? { spread: appSettingsRef.current.spread, spreadCover: appSettingsRef.current.spreadCover };
        if (!savedView) void saveBookView(platform, bookId, view);
        setBookView(view);
        const index = progress ? Math.min(progress.spineIndex, m.spine.length - 1) : 0;
        loadDocuments([{ index, target: { kind: 'fraction', value: progress?.fraction ?? 0 } }]);
        spineIndexRef.current = index;
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
  }, [platform, bookId, loadDocuments]);

  // DjVu: read the book into memory in the background while its first page document loads.
  const format = manifest?.format;
  useEffect(() => {
    if (format !== 'djvu') return;
    const store = new DjvuPageStore(
      async () => openDjvuWorkers(await loadDjvuLibrary(), () => platform.readBinary(bookId, DJVU_SOURCE)),
      pageMemoryBudget(),
    );
    djvuPages.current = store;
    return () => {
      store.close();
      if (djvuPages.current === store) djvuPages.current = null;
    };
  }, [platform, bookId, format]);

  // PDF: open the book in the app once, to draw its pages ahead of the reader.
  useEffect(() => {
    if (format !== 'pdf') return;
    const store = new PdfPageStore(
      async () => openPdfRenderer(await loadPdfLibrary(), { data: await platform.readBinary(bookId, PDF_SOURCE) }),
      pageMemoryBudget(),
    );
    pdfPages.current = store;
    return () => {
      store.close();
      if (pdfPages.current === store) pdfPages.current = null;
    };
  }, [platform, bookId, format]);

  /** Sends a PDF page document (in frame `slot`) the page it asked for; a count of 0 tells it to draw its pages itself. */
  const answerPdfPage = useCallback(
    (slot: number, page: number, scale: number) => {
      const frame = frames.current[slot];
      const reply = (count: number, rtl: boolean, data: PdfPageData | null) => {
        const message: HostMessage = { tag: MESSAGE_TAG, type: 'pdfPage', page, scale, count, rtl, data };
        frameElements.current[slot]?.contentWindow?.postMessage(message, origin);
        // PDF page documents are the spine documents, one per page.
        if (!frame.shown && (count === 0 || (frame.index !== null && page === frame.index + 1))) {
          frame.shown = true;
          setFramesChanged((n) => n + 1);
        }
      };
      const store = pdfPages.current;
      if (!store) return reply(0, false, null);
      Promise.all([store.book(), store.page(page, scale)]).then(
        ([{ count, rtl }, data]) => reply(count, rtl, data),
        (error: unknown) => {
          console.warn(`PDF page ${page} could not be drawn in the app:`, error);
          reply(0, false, null);
        },
      );
    },
    [origin],
  );

  /** Sends a DjVu page document (in frame `slot`) the page it asked for; a count of 0 tells it to decode the page itself. */
  const answerDjvuPage = useCallback(
    (slot: number, page: number, full: boolean) => {
      // The frame may hold another page document by the time the page is decoded: page documents ignore pages they did not ask for.
      const frame = frames.current[slot];
      const reply = (count: number, data: DjvuPageData | null) => {
        const message: HostMessage = { tag: MESSAGE_TAG, type: 'djvuPage', page, full, count, data };
        frameElements.current[slot]?.contentWindow?.postMessage(message, origin);
      };
      const shown = () => {
        frame.shown = true;
        setFramesChanged((n) => n + 1);
      };
      const store = djvuPages.current;
      if (!store) return reply(0, null);
      store.page(page, full).then(
        (data) => {
          reply(store.count, data);
          // DjVu page documents are the spine documents, one per page.
          if (!full && frame.index !== null && page === frame.index + 1) shown();
        },
        (error: unknown) => {
          console.warn(`DjVu page ${page} could not be decoded in the app:`, error);
          reply(0, null);
          shown();
        },
      );
    },
    [origin],
  );

  const currentSlot = slots.indexOf(spineIndex);
  /** Whether the current document is on screen and shows its content. */
  const frameShown = currentSlot >= 0 && visibleSlot === currentSlot && frames.current[currentSlot].shown;
  const showWait = useDelayed(!frameShown, WAIT_SPINNER_DELAY_MS);

  const flushSave = useCallback(() => {
    const progress = pendingSave.current;
    pendingSave.current = null;
    if (progress) saveProgress(platform, bookId, progress).catch((e: unknown) => console.error('Saving reading position failed:', e));
  }, [platform, bookId]);

  /** A PDF, DjVu or comic spread shows two pages (paired as spread.ts says): the page document of the first shows the second beside it. */
  const pageSpread = hasPageSpreads(manifest) && settings.spread && frameFitsSpread;
  const coverAlone = settings.spreadCover;
  /** The page whose document shows page `index`: the first of its spread. */
  const shownBy = useCallback((index: number) => (pageSpread ? spreadStart(index, coverAlone) : index), [pageSpread, coverAlone]);
  /** The last page shown, which counts as read. */
  const lastShown = useCallback(
    (index: number) => (pageSpread && manifest ? spreadEnd(index, manifest.spine.length, coverAlone) : index),
    [pageSpread, manifest, coverAlone],
  );
  /** The settings for the document of page `index`: in a spread, the first page shows alone as the cover. */
  const frameSettings = useCallback(
    (index: number): FrameSettings | null => {
      if (!manifest) return null;
      const fixedSpread: FixedSpread | null = pageSpread ? (coverAlone && index === 0 ? 'single' : 'pair') : null;
      return { ...settings, layout: manifest.layout, fixedSpread };
    },
    [settings, manifest, pageSpread, coverAlone],
  );

  useEffect(() => {
    const box = framesBox.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setFrameFitsSpread(spreadFits(box.clientWidth, box.clientHeight)));
    observer.observe(box);
    return () => observer.disconnect();
  }, [manifest]);

  /** Posts to the current document. */
  const post = useCallback((message: HostMessage) => postTo(slotsRef.current.indexOf(spineIndexRef.current), message), [postTo]);

  const navigate = useCallback(
    (index: number, target: GotoTarget) => {
      if (!manifest || index < 0 || index >= manifest.spine.length) return;
      const start = shownBy(index);
      if (start !== index) {
        if (target.kind === 'search') target = { ...target, part: index - start };
        index = start;
      }
      const slot = loadDocuments([{ index, target }]).indexOf(index);
      if (slot < 0) return;
      const frame = frames.current[slot];
      if (frame.ready) {
        // Loaded ahead (or the current document): shown at once.
        postTo(slot, { tag: MESSAGE_TAG, type: 'goto', target });
        if (manifest.layout === 'pre-paginated' && index !== spineIndexRef.current) postTo(slot, { tag: MESSAGE_TAG, type: 'zoom', ...fixedZoom.current });
        showSlot(slot);
      } else {
        frame.target = target;
      }
      if (index !== spineIndexRef.current) {
        spineIndexRef.current = index;
        setSpineIndex(index);
      }
    },
    [manifest, shownBy, loadDocuments, postTo, showSlot],
  );

  // Once the current document is on screen, the next and previous ones load into the other frames.
  useEffect(() => {
    if (!manifest || visibleSlot === null || slots[visibleSlot] !== spineIndex) return;
    const next = lastShown(spineIndex) + 1;
    const previous = spineIndex > 0 ? shownBy(spineIndex - 1) : -1;
    const wanted = wantedDocuments(spineIndex, next, previous, manifest.spine.length);
    loadDocuments(wanted.map((index) => ({ index, target: index === previous ? { kind: 'end' } : { kind: 'fraction', value: 0 } })));
  }, [manifest, slots, visibleSlot, spineIndex, lastShown, shownBy, loadDocuments]);

  /** A document without the paginator, which never announces itself, is shown once it has loaded. */
  const frameLoaded = useCallback(
    (slot: number) => {
      const frame = frames.current[slot];
      if (frame.ready || frame.index === null) return;
      window.setTimeout(() => {
        // Not if it has announced itself meanwhile, or the frame has been given another document.
        if (frame.ready || frames.current[slot] !== frame) return;
        frame.shown = true;
        if (frame.index === spineIndexRef.current) showSlot(slot);
        setFramesChanged((n) => n + 1);
      }, READY_GRACE_MS);
    },
    [showSlot],
  );

  // Turning a spread on (or the window to landscape, or the cover alone) shows the current page in its spread.
  useEffect(() => {
    if (shownBy(spineIndex) !== spineIndex) navigate(spineIndex, { kind: 'fraction', value: 0 });
  }, [spineIndex, shownBy, navigate]);

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
      else if (key === 'PageDown' || key === 'ArrowDown') turn(1);
      else if (key === 'PageUp' || key === 'ArrowUp') turn(-1);
      else if (key === 'Home') navigate(0, { kind: 'fraction', value: 0 });
      else if (key === 'End' && manifest) navigate(manifest.spine.length - 1, { kind: 'end' });
    },
    [panel, visualTurn, turn, navigate, manifest],
  );

  // Messages from the book frames. Only accepted from our iframes and the book's own origin.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const slot = frameElements.current.findIndex((element) => element !== null && element.contentWindow === event.source);
      if (slot < 0 || event.origin !== origin) return;
      const message = parseFrameMessage(event.data);
      const frame = frames.current[slot];
      if (!message || !manifest || frame.index === null) return;
      /** Whether the message comes from the current document; the others are loaded ahead, out of sight. */
      const current = frame.index === spineIndexRef.current;
      switch (message.type) {
        case 'ready': {
          frame.ready = true;
          if (manifest.format !== 'djvu' && manifest.format !== 'pdf') frame.shown = true;
          const docSettings = frameSettings(frame.index);
          if (docSettings) postTo(slot, { tag: MESSAGE_TAG, type: 'settings', settings: docSettings });
          postTo(slot, { tag: MESSAGE_TAG, type: 'goto', target: frame.target });
          if (manifest.layout === 'pre-paginated') postTo(slot, { tag: MESSAGE_TAG, type: 'zoom', ...fixedZoom.current });
          if (current) showSlot(slot);
          else postTo(slot, { tag: MESSAGE_TAG, type: 'shown', shown: false });
          setFramesChanged((n) => n + 1);
          break;
        }
        case 'relocate':
          if (!current) break;
          setLocation(message);
          pendingSave.current = {
            spineIndex: frame.index,
            fraction: message.fraction,
            overall: overallProgress(manifest, lastShown(frame.index), message.fraction),
            updatedAt: Date.now(),
          };
          window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(flushSave, 400);
          break;
        case 'edge':
          if (!current) break;
          // Past the last page shown, or before the first (whose spread `navigate` finds).
          if (message.dir === 1) navigate(lastShown(frame.index) + 1, { kind: 'fraction', value: 0 });
          else navigate(frame.index - 1, { kind: 'end' });
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
          // Keys reach the book only while the picture viewer opens (it takes the focus).
          if (picture) {
            if (message.key === 'Escape') setPicture(null);
          } else {
            handleKey(message.key);
          }
          break;
        case 'image':
          // Only the book's own pictures, or ones inlined in it.
          if (current && (message.src.startsWith(`${origin}/`) || message.src.startsWith('data:image/'))) setPicture(message.src);
          break;
        case 'wheel': {
          const now = Date.now();
          if (!message.passed) wheelFrame.current = { slot, time: now };
          if (now - lastWheel.current < WHEEL_THROTTLE_MS || Math.abs(message.delta) < 4) break;
          lastWheel.current = now;
          turn(message.delta > 0 ? 1 : -1);
          break;
        }
        case 'passWheel': {
          wheelFrame.current = { slot, time: Date.now() };
          holdSpin(slot);
          const { type: _, ...wheel } = message;
          if (!current) post({ tag: MESSAGE_TAG, type: 'wheel', wheel });
          break;
        }
        case 'zoom':
          fixedZoom.current = { zoom: message.zoom, panX: message.panX };
          break;
        case 'textzoom': {
          // Like the font size buttons, which publisher layout turns off.
          if (manifest.layout !== 'reflowable' || !settings.overrideStyles) break;
          const fontScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, settings.fontScale + message.dir * FONT_SCALE_STEP));
          if (fontScale !== settings.fontScale) changeSettings({ ...settings, fontScale });
          break;
        }
        case 'link':
          navigateHref(message.href);
          break;
        case 'external':
          void platform.openExternal(message.href);
          break;
        case 'djvuPage':
          answerDjvuPage(slot, message.page, message.full);
          break;
        case 'pdfPage':
          answerPdfPage(slot, message.page, message.scale);
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, manifest, settings, changeSettings, frameSettings, postTo, showSlot, holdSpin, platform, lastShown, navigate, navigateHref, panel, picture, visualTurn, turn, handleKey, flushSave, answerDjvuPage, answerPdfPage]);

  // Push settings changes to every loaded document.
  useEffect(() => {
    frames.current.forEach((frame, slot) => {
      const next = frame.index === null ? null : frameSettings(frame.index);
      if (next) postTo(slot, { tag: MESSAGE_TAG, type: 'settings', settings: next });
    });
  }, [frameSettings, postTo]);

  // Keyboard when focus is in the app rather than inside the book frame.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The picture viewer has keys of its own.
      if (picture || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      // Space never turns pages: on a zoomed fixed page it holds the hand tool (paginator.ts).
      if (event.key === ' ') {
        event.preventDefault();
        if (manifest?.layout === 'pre-paginated' && fixedZoom.current.zoom > 1 && !handHeld.current) {
          post({ tag: MESSAGE_TAG, type: 'hand', on: true });
          handHeld.current = true;
        }
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape'].includes(event.key)) {
        event.preventDefault();
        handleKey(event.key);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !handHeld.current) return;
      event.preventDefault();
      handHeld.current = false;
      post({ tag: MESSAGE_TAG, type: 'hand', on: false });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [handleKey, manifest, post, picture]);

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
    // A match may also be highlighted in a document turned away from, still loaded in its frame.
    frames.current.forEach((_, slot) => postTo(slot, { tag: MESSAGE_TAG, type: 'clearSearch' }));
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

  const overall = overallProgress(manifest, lastShown(spineIndex), location.fraction);
  const chapterTitle = findTocLabel(manifest.toc, manifest.spine[spineIndex].href);
  /** Text, PDF, DjVu and comics can show two pages side by side; text only when it is paginated. */
  const canSpread = manifest.layout === 'reflowable' || hasPageSpreads(manifest);
  const spreadApplies = manifest.layout !== 'reflowable' || settings.flow === 'paginated';
  const spineCount = manifest.spine.length;
  const marks = spineCount > 1 && spineCount <= MAX_SLIDER_MARKS ? Array.from({ length: spineCount - 1 }, (_, i) => (i + 1) / spineCount) : [];

  return (
    <div className={chromeVisible ? 'reader' : 'reader reader-immersive'} data-theme={settings.theme}>
      <div ref={framesBox} className="reader-frames">
        {slots.map((index, slot) =>
          index === null ? null : (
            <iframe
              key={slot}
              ref={(element) => {
                frameElements.current[slot] = element;
              }}
              className={slot === visibleSlot ? 'reader-frame' : slot === spinSlot ? 'reader-frame reader-frame-hidden reader-frame-spun' : 'reader-frame reader-frame-hidden'}
              // Out of sight, out of reach: no focus, input or screen reader goes into a frame loaded ahead.
              inert={slot !== visibleSlot}
              title={manifest.title}
              src={bookUrl(platform, bookId, manifest.spine[index].href)}
              sandbox="allow-scripts allow-same-origin"
              allow="fullscreen; autoplay"
              onLoad={() => frameLoaded(slot)}
            />
          ),
        )}
      </div>
      {showWait && (
        <div className="reader-wait" role="status" aria-label="Getting the page ready">
          <div className="reader-wait-sky">
            <GalaxySpinner />
          </div>
        </div>
      )}

      {chromeVisible ? (
        <>
          <header className="reader-bar reader-top">
            <div className="reader-toolbar">
              <button type="button" className="icon-button" onClick={onClose} aria-label="Back to library">
                <Icon name="back" />
              </button>
              <div className="reader-tabs">
                <ShelfTabs onSelect={onShelf} />
              </div>
              <div className="reader-actions">
                {isSearchable(manifest) && (
                  <button type="button" className="icon-button" onClick={() => setPanel(panel === 'search' ? null : 'search')} aria-label="Search in book" aria-expanded={panel === 'search'}>
                    <Icon name="search" />
                  </button>
                )}
                {canSpread && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => changeSettings({ ...settings, spread: !settings.spread })}
                    disabled={!spreadApplies}
                    aria-label="Two-page view"
                    aria-pressed={settings.spread}
                    title={settings.spread ? 'Two pages side by side in landscape. Show one page' : 'One page. Show two pages side by side in landscape'}
                  >
                    <Icon name={settings.spread ? 'twoPages' : 'onePage'} />
                  </button>
                )}
                <button type="button" className="icon-button" onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="Contents" aria-expanded={panel === 'toc'}>
                  <Icon name="toc" />
                </button>
                <button type="button" className="icon-button" onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="Display settings" aria-expanded={panel === 'settings'}>
                  <Icon name="settings" />
                </button>
              </div>
            </div>
            <div className="reader-heading">
              <span className="reader-title">{manifest.title}</span>
              {manifest.authors.length > 0 && <span className="reader-subtitle">{manifest.authors.join(', ')}</span>}
              {chapterTitle && <span className="reader-subtitle">{chapterTitle}</span>}
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
            <button type="button" className="icon-button" onClick={() => visualTurn(-1)} aria-label="Previous page">
              <Icon name="chevronLeft" />
            </button>
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
            <button type="button" className="icon-button" onClick={() => visualTurn(1)} aria-label="Next page">
              <Icon name="chevronRight" />
            </button>
          </footer>
        </>
      ) : null}

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
        <SettingsPanel
          settings={settings}
          fixedLayout={manifest.layout === 'pre-paginated'}
          canSpread={canSpread}
          onChange={changeSettings}
          onClose={() => setPanel(null)}
        />
      )}
      {picture && <ImageViewer src={picture} onClose={() => setPicture(null)} />}
    </div>
  );
}

/** `on`, once it has stayed on for `delay` ms; off at once. */
function useDelayed(on: boolean, delay: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) return setLate(false);
    const timer = window.setTimeout(() => setLate(true), delay);
    return () => window.clearTimeout(timer);
  }, [on, delay]);
  return on && late;
}

function findTocLabel(items: TocItem[], spineHref: string): string | null {
  for (const item of items) {
    if (splitFragment(item.href)[0] === spineHref) return item.label;
    const nested = findTocLabel(item.children, spineHref);
    if (nested) return nested;
  }
  return null;
}
