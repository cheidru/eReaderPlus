import { ALL_FORMATS, type BookFormat, type LibraryEntry, type LibraryFilter, type SortKey } from './types';

/** Shelves that list books directly. */
export type BookShelf = 'reading' | 'all' | 'favorites' | 'toRead' | 'finished';
/** Shelves that list groups (authors, series, collections, formats), each opening a list of books. */
export type GroupShelf = 'authors' | 'series' | 'collections' | 'formats';
/** 'folders' browses the device's folders for book files to open; its group is the folder shown. */
export type Shelf = BookShelf | GroupShelf | 'folders';

/** Where the library is: a shelf, and inside a group shelf optionally one group. */
export interface LibraryLocation {
  shelf: Shelf;
  group?: string;
}

export interface Group {
  /** Key passed back as LibraryLocation.group: author, series or collection name, or format. */
  key: string;
  label: string;
  count: number;
}

/** Group key of books without an author. */
export const NO_AUTHOR = '';

export function isGroupShelf(shelf: Shelf): shelf is GroupShelf {
  return shelf === 'authors' || shelf === 'series' || shelf === 'collections' || shelf === 'formats';
}

export function onShelf(entry: LibraryEntry, shelf: BookShelf): boolean {
  switch (shelf) {
    case 'reading':
      // Books found by a folder scan wait under Books until they are first opened.
      return !entry.finished && entry.lastOpenedAt > 0;
    case 'all':
      return true;
    case 'favorites':
      return !!entry.favorite;
    case 'toRead':
      return !!entry.toRead;
    case 'finished':
      return !!entry.finished;
  }
}

export function inGroup(entry: LibraryEntry, shelf: GroupShelf, group: string): boolean {
  switch (shelf) {
    case 'authors':
      return group === NO_AUTHOR ? entry.authors.length === 0 : entry.authors.includes(group);
    case 'series':
      return entry.series?.name === group;
    case 'collections':
      return !!entry.collections?.includes(group);
    case 'formats':
      return entry.format === group;
  }
}

/** The books at a location. For a group shelf without a group this is empty: it lists groups instead. */
export function booksAt(entries: LibraryEntry[], location: LibraryLocation): LibraryEntry[] {
  const { shelf, group } = location;
  if (shelf === 'folders') return [];
  if (!isGroupShelf(shelf)) return entries.filter((e) => onShelf(e, shelf));
  return group === undefined ? [] : entries.filter((e) => inGroup(e, shelf, group));
}

export function formatLabel(format: BookFormat): string {
  return format.toUpperCase();
}

/**
 * The groups of a group shelf with their book counts, sorted by label.
 * `collectionNames` lists collections that exist even while empty.
 */
export function groupsOf(entries: LibraryEntry[], shelf: GroupShelf, collectionNames: string[] = []): Group[] {
  const counts = new Map<string, number>();
  const add = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  if (shelf === 'collections') for (const name of collectionNames) counts.set(name, 0);
  for (const entry of entries) {
    if (shelf === 'authors') {
      if (entry.authors.length === 0) add(NO_AUTHOR);
      else for (const author of new Set(entry.authors)) add(author);
    } else if (shelf === 'series') {
      // Books outside any series are simply not listed: there is no useful "no series" group.
      if (entry.series) add(entry.series.name);
    } else if (shelf === 'collections') {
      for (const name of new Set(entry.collections ?? [])) add(name);
    } else {
      add(entry.format);
    }
  }
  const label = (key: string) => {
    if (shelf === 'formats') return formatLabel(key as BookFormat);
    if (shelf === 'authors' && key === NO_AUTHOR) return 'Unknown author';
    return key;
  };
  return [...counts]
    .map(([key, count]) => ({ key, label: label(key), count }))
    .sort((a, b) => compareText(a.label, b.label));
}

export function applyFilter(entries: LibraryEntry[], filter: LibraryFilter, search = ''): LibraryEntry[] {
  const query = search.trim().toLocaleLowerCase();
  return entries.filter(
    (e) =>
      isFormatShown(filter, e.format) &&
      !(filter.hideFinished && e.finished) &&
      (!query || [e.title, ...e.authors, e.series?.name ?? '', e.fileName ?? ''].some((text) => text.toLocaleLowerCase().includes(query))),
  );
}

/** Sorts a copy. Text keys sort A to Z; dates sort newest first. */
export function sortEntries(entries: LibraryEntry[], key: SortKey): LibraryEntry[] {
  const byTitle = (a: LibraryEntry, b: LibraryEntry) => compareText(a.title, b.title);
  const compare: Record<SortKey, (a: LibraryEntry, b: LibraryEntry) => number> = {
    title: byTitle,
    author: (a, b) => compareText(a.authors[0] ?? LAST, b.authors[0] ?? LAST) || byTitle(a, b),
    series: (a, b) => compareText(a.series?.name ?? LAST, b.series?.name ?? LAST) || bySeriesIndex(a, b) || byTitle(a, b),
    format: (a, b) => compareText(a.format, b.format) || byTitle(a, b),
    added: (a, b) => b.addedAt - a.addedAt,
    read: (a, b) => b.lastOpenedAt - a.lastOpenedAt,
  };
  return [...entries].sort(compare[key]);
}

/**
 * Sorts the books at a location. Inside one series they go in series order, whatever the chosen sort:
 * that is the order they are meant to be read in.
 */
export function sortAt(entries: LibraryEntry[], location: LibraryLocation, key: SortKey): LibraryEntry[] {
  return location.shelf === 'series' && location.group !== undefined ? sortEntries(entries, 'series') : sortEntries(entries, key);
}

/** Series position, books without one after the numbered ones. */
function bySeriesIndex(a: LibraryEntry, b: LibraryEntry): number {
  return (a.series?.index ?? Infinity) - (b.series?.index ?? Infinity) || 0;
}

/** Whether books in a format are shown; the format selection applies everywhere in the library. */
export function isFormatShown(filter: LibraryFilter, format: BookFormat): boolean {
  return !filter.noFormats && (filter.formats.length === 0 || filter.formats.includes(format));
}

export function allFormatsShown(filter: LibraryFilter): boolean {
  return !filter.noFormats && filter.formats.length === 0;
}

/** The filter showing these formats: all of them is stored as no selection, none of them as noFormats. */
function withShownFormats(filter: LibraryFilter, shown: BookFormat[]): LibraryFilter {
  const formats = shown.length === ALL_FORMATS.length ? [] : ALL_FORMATS.filter((f) => shown.includes(f));
  return shown.length === 0 ? { formats, hideFinished: filter.hideFinished, noFormats: true } : { formats, hideFinished: filter.hideFinished };
}

/** Turns one format on or off. */
export function toggleFormat(filter: LibraryFilter, format: BookFormat): LibraryFilter {
  const shown = ALL_FORMATS.filter((f) => isFormatShown(filter, f));
  return withShownFormats(filter, shown.includes(format) ? shown.filter((f) => f !== format) : [...shown, format]);
}

/** "All formats": turns every format off when all are on, and on otherwise. */
export function toggleAllFormats(filter: LibraryFilter): LibraryFilter {
  return withShownFormats(filter, allFormatsShown(filter) ? [] : ALL_FORMATS);
}

/** The formats a file with this extension can turn out to be (a .mobi file may hold an AZW3 book). */
const EXTENSION_FORMATS: Record<string, BookFormat[]> = {
  epub: ['epub'],
  kepub: ['epub'],
  fb2: ['fb2'],
  fbz: ['fb2'],
  cbz: ['cbz'],
  mobi: ['mobi', 'azw3'],
  azw: ['mobi', 'azw3'],
  azw3: ['azw3'],
  djvu: ['djvu'],
  djv: ['djvu'],
  pdf: ['pdf'],
  chm: ['chm'],
  lit: ['lit'],
  md: ['md'],
  markdown: ['md'],
};

/** Of these file extensions, the ones whose books the format selection shows. */
export function shownExtensions(filter: LibraryFilter, extensions: string[]): string[] {
  return extensions.filter((ext) => (EXTENSION_FORMATS[ext] ?? []).some((f) => isFormatShown(filter, f)));
}

export function isFilterActive(filter: LibraryFilter): boolean {
  return !allFormatsShown(filter) || filter.hideFinished;
}

/** Sorts after any real text, so books missing the sort key go last. */
const LAST = '\uffff';

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}
