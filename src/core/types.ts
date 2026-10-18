/** 'mobi' is MOBI 6 (also old AZW), 'azw3' is KF8 (also the KF8 half of combined MOBI files). */
export type BookFormat = 'epub' | 'fb2' | 'cbz' | 'mobi' | 'azw3' | 'djvu' | 'pdf' | 'chm' | 'lit';

export interface TocItem {
  label: string;
  /** Book-root-relative path, optionally with #fragment. Empty when the entry has no target. */
  href: string;
  children: TocItem[];
}

export interface SpineItem {
  /** Book-root-relative path of the document. */
  href: string;
  linear: boolean;
}

/** A book's place in a series, from its own metadata. */
export interface Series {
  name: string;
  /** Position in the series (may be fractional, e.g. 2.5 for a novella). */
  index?: number;
}

export interface BookManifest {
  version: 1;
  id: string;
  format: BookFormat;
  /** Stable identifier from the book itself (dc:identifier, FB2 id) used to detect duplicates. */
  identifier: string;
  title: string;
  authors: string[];
  language: string;
  /** Book-root-relative path of the cover image, if any. */
  cover: string | null;
  series?: Series;
  /** 'pre-paginated' books (fixed layout EPUB, comics) are scaled per page instead of reflowed. */
  layout: 'reflowable' | 'pre-paginated';
  direction: 'ltr' | 'rtl';
  spine: SpineItem[];
  toc: TocItem[];
  /** Original path → path actually served, for documents rewritten at import (scripted XHTML → HTML). */
  aliases?: Record<string, string>;
  /** Comics: version of the page documents written at import (COMIC_PAGES_VERSION); missing is 1. */
  pagesVersion?: number;
}

/**
 * Version of the page documents written for a comic (cbz.ts). 2: each page also holds the next image, shown beside it
 * in a two-page spread. Comics imported with older page documents get them written again when opened.
 */
export const COMIC_PAGES_VERSION = 2;

/**
 * What the library shows of a book being imported as soon as the importer knows it (title, authors, cover image),
 * well before the rest of the book is converted. `cover` is a book-root-relative path, already written.
 */
export interface BookPreview {
  title: string;
  authors: string[];
  cover: string | null;
}

/** Called by importers once a book's preview is known (at most a few times, the latest one counting). */
export type OnPreview = (preview: BookPreview) => void;

export interface Progress {
  spineIndex: number;
  /** Position inside the spine document, 0..1. */
  fraction: number;
  /** Overall position in the book, 0..1. */
  overall: number;
  updatedAt: number;
}

export interface LibraryEntry {
  id: string;
  identifier: string;
  format: BookFormat;
  title: string;
  authors: string[];
  cover: string | null;
  addedAt: number;
  lastOpenedAt: number;
  progress: number;
  series?: Series;
  /** The file the book was imported from (FileRef.ref), so opening that file again opens this book. */
  source?: string;
  /** Name of the file the book was imported from (missing for books imported before it was recorded). */
  fileName?: string;
  favorite?: boolean;
  /** On the "To read" shelf. */
  toRead?: boolean;
  /** On the "Finished" shelf; finished books leave "Reading now". */
  finished?: boolean;
  /** Names of the collections the book belongs to. */
  collections?: string[];
}

/** The flags a reader toggles on a book from the library. */
export type EntryFlags = Pick<LibraryEntry, 'favorite' | 'toRead' | 'finished' | 'collections'>;

export type LibraryLayout = 'cards' | 'shelf';
export type AppTheme = 'dark' | 'light';
/** Color themes of the app around the book (src/ui/themes.ts); 'readera' is the look the app started with. */
export type ColorTheme = 'ink' | 'paper' | 'forest' | 'dusk' | 'readera';
/** In the order Settings offers them: the default first. */
export const ALL_COLOR_THEMES: ColorTheme[] = ['dusk', 'ink', 'paper', 'forest', 'readera'];
export type SortKey = 'title' | 'author' | 'series' | 'format' | 'added' | 'read';

export interface LibraryFilter {
  /** Formats to show; empty shows every format, unless noFormats is set. */
  formats: BookFormat[];
  /** Every format is turned off: no books are shown until one is turned on again. */
  noFormats?: boolean;
  hideFinished: boolean;
}

export interface LibraryPrefs {
  /** 'cards' is the ReadEra-style list, 'shelf' the plain cover grid of iPad Books. */
  layout: LibraryLayout;
  /** Colors of the app around the book (the book's own colors are ReaderSettings.theme). */
  appTheme: AppTheme;
  /** Colors of the bars, highlights and accents, in either app theme. */
  colorTheme: ColorTheme;
  sort: SortKey;
  filter: LibraryFilter;
}

export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = {
  layout: 'cards',
  appTheme: 'dark',
  colorTheme: 'dusk',
  sort: 'read',
  filter: { formats: [], hideFinished: false },
};

export const ALL_FORMATS: BookFormat[] = ['epub', 'pdf', 'fb2', 'mobi', 'azw3', 'djvu', 'cbz', 'chm', 'lit'];

export type Theme = 'light' | 'sepia' | 'dark';
export type Flow = 'paginated' | 'scrolled';

export interface ReaderSettings {
  theme: Theme;
  flow: Flow;
  /** Percent of the book's own base font size. */
  fontScale: number;
  /** Empty string keeps the publisher font. */
  fontFamily: string;
  /** 0 keeps the publisher line height. */
  lineHeight: number;
  /** Page margin in CSS px. */
  margin: number;
  /** Extra thickness of the letters, 0 (as published) to FONT_WEIGHT_MAX. */
  fontWeight: number;
  /** Paginated text and PDF show two pages side by side when the window is in landscape. */
  spread: boolean;
  /** PDF, DjVu and comic spreads show the first page alone, then pages 2–3, 4–5, … as in a printed book. */
  spreadCover: boolean;
  /** When false, the reader injects no typography overrides at all (publisher layout). */
  overrideStyles: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  flow: 'paginated',
  fontScale: 100,
  fontFamily: '',
  lineHeight: 0,
  margin: 32,
  fontWeight: 0,
  spread: false,
  spreadCover: false,
  overrideStyles: true,
};

export const FONT_WEIGHT_MAX = 4;

/** Font size range and step, in percent (settings panel, Ctrl+wheel and pinch). */
export const FONT_SCALE_MIN = 50;
export const FONT_SCALE_MAX = 250;
export const FONT_SCALE_STEP = 10;

export const MANIFEST_PATH = '.ereader/manifest.json';
