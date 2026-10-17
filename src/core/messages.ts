/**
 * postMessage protocol between the app (host) and the paginator injected into book documents.
 * Book documents are untrusted: the host must validate every incoming message with
 * `parseFrameMessage` and treat its contents as data only.
 */
import type { Flow, Theme } from './types';

export const MESSAGE_TAG = 'ereader';

/** Largest magnification of a fixed-layout page, on top of fitting it to the screen. */
export const MAX_ZOOM = 6;

export type FixedSpread = 'pair' | 'single';

/** A word or line of a DjVu page's OCR text, in the page's own pixels. */
export interface DjvuTextZone {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

/**
 * A decoded DjVu page: its size and OCR text in the page's own pixels, and its image, which the app keeps scaled down
 * to what the screen can show unless the full resolution was asked for (zooming in).
 */
export interface DjvuPageData {
  width: number;
  height: number;
  image: ImageData;
  zones: DjvuTextZone[] | null;
}

export interface FrameSettings {
  theme: Theme;
  flow: Flow;
  fontScale: number;
  fontFamily: string;
  lineHeight: number;
  margin: number;
  fontWeight: number;
  spread: boolean;
  overrideStyles: boolean;
  layout: 'reflowable' | 'pre-paginated';
  /**
   * Fixed layout (PDF, DjVu) in a two-page spread: 'pair' shows the next page beside the document's own, 'single'
   * shows its page alone (a book's cover), centered and as large as the pages of a pair.
   */
  fixedSpread: FixedSpread | null;
}

/** Where to go after a document loads or on request. */
export type GotoTarget =
  | { kind: 'fraction'; value: number }
  | { kind: 'page'; value: number }
  | { kind: 'end' }
  | { kind: 'fragment'; value: string }
  /**
   * The `occurrence`-th match of a search inside the book (see textsearch.ts), which is also highlighted.
   * In a fixed-layout spread, `part` says which of the pages shown holds it (the element marked data-ereader-part).
   */
  | { kind: 'search'; query: string; occurrence: number; part?: number };

export type HostMessage =
  | { tag: typeof MESSAGE_TAG; type: 'settings'; settings: FrameSettings }
  | { tag: typeof MESSAGE_TAG; type: 'goto'; target: GotoTarget }
  | { tag: typeof MESSAGE_TAG; type: 'turn'; dir: 1 | -1 }
  /** Removes the highlight of a search match. */
  | { tag: typeof MESSAGE_TAG; type: 'clearSearch' }
  /** Fixed layout: magnification (1 = fit to screen) and horizontal position (0..1) to keep across pages. */
  | { tag: typeof MESSAGE_TAG; type: 'zoom'; zoom: number; panX: number }
  /** Fixed layout: Space is held (or released) while the app has the focus, so mouse drags pan a zoomed page. */
  | { tag: typeof MESSAGE_TAG; type: 'hand'; on: boolean }
  /**
   * DjVu: the answer to a page document's `djvuPage` request. `count` is the book's page count, or 0 when the app
   * can't decode the book (the page document then decodes the page itself); `data` is null past the last page.
   */
  | { tag: typeof MESSAGE_TAG; type: 'djvuPage'; page: number; full: boolean; count: number; data: DjvuPageData | null };

export type FrameMessage =
  | { type: 'ready' }
  | { type: 'relocate'; page: number; pageCount: number; fraction: number }
  | { type: 'edge'; dir: 1 | -1 }
  | { type: 'tap'; x: number; y: number }
  | { type: 'swipe'; dir: 1 | -1 }
  | { type: 'key'; key: string }
  | { type: 'wheel'; delta: number }
  /** Fixed layout: the reader zoomed or panned the page. */
  | { type: 'zoom'; zoom: number; panX: number }
  /** Reflowable: Ctrl+wheel or pinch asks for a larger (1) or smaller (-1) font. */
  | { type: 'textzoom'; dir: 1 | -1 }
  | { type: 'link'; href: string }
  | { type: 'external'; href: string }
  /** DjVu: asks the app for a page (1-based), which it keeps decoded in memory while the book is open; `full`: at full resolution. */
  | { type: 'djvuPage'; page: number; full: boolean };

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape']);

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isDir(v: unknown): v is 1 | -1 {
  return v === 1 || v === -1;
}

function isShortString(v: unknown, max = 4096): v is string {
  return typeof v === 'string' && v.length <= max;
}

/** Returns a sanitized copy of a message posted by a book frame, or null if it is not valid. */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.tag !== MESSAGE_TAG) return null;
  switch (m.type) {
    case 'ready':
      return { type: 'ready' };
    case 'relocate':
      if (!isNum(m.page) || !isNum(m.pageCount) || !isNum(m.fraction)) return null;
      return {
        type: 'relocate',
        page: Math.max(0, Math.floor(m.page)),
        pageCount: Math.max(1, Math.floor(m.pageCount)),
        fraction: Math.min(1, Math.max(0, m.fraction)),
      };
    case 'edge':
      return isDir(m.dir) ? { type: 'edge', dir: m.dir } : null;
    case 'swipe':
      return isDir(m.dir) ? { type: 'swipe', dir: m.dir } : null;
    case 'tap':
      if (!isNum(m.x) || !isNum(m.y)) return null;
      return { type: 'tap', x: Math.min(1, Math.max(0, m.x)), y: Math.min(1, Math.max(0, m.y)) };
    case 'key':
      return typeof m.key === 'string' && KEYS.has(m.key) ? { type: 'key', key: m.key } : null;
    case 'wheel':
      return isNum(m.delta) ? { type: 'wheel', delta: m.delta } : null;
    case 'zoom':
      if (!isNum(m.zoom) || !isNum(m.panX)) return null;
      return { type: 'zoom', zoom: Math.min(MAX_ZOOM, Math.max(1, m.zoom)), panX: Math.min(1, Math.max(0, m.panX)) };
    case 'textzoom':
      return isDir(m.dir) ? { type: 'textzoom', dir: m.dir } : null;
    case 'link':
      return isShortString(m.href) ? { type: 'link', href: m.href } : null;
    case 'external':
      return isShortString(m.href) && /^(https?:|mailto:)/i.test(m.href) ? { type: 'external', href: m.href } : null;
    case 'djvuPage':
      return Number.isInteger(m.page) && (m.page as number) >= 1 ? { type: 'djvuPage', page: m.page as number, full: m.full === true } : null;
    default:
      return null;
  }
}
