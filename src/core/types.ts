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
  /** 'pre-paginated' books (fixed layout EPUB, comics) are scaled per page instead of reflowed. */
  layout: 'reflowable' | 'pre-paginated';
  direction: 'ltr' | 'rtl';
  spine: SpineItem[];
  toc: TocItem[];
  /** Original path → path actually served, for documents rewritten at import (scripted XHTML → HTML). */
  aliases?: Record<string, string>;
}

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
}

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
  overrideStyles: true,
};

/** Font size range and step, in percent (settings panel, Ctrl+wheel and pinch). */
export const FONT_SCALE_MIN = 50;
export const FONT_SCALE_MAX = 250;
export const FONT_SCALE_STEP = 10;

export const MANIFEST_PATH = '.ereader/manifest.json';
