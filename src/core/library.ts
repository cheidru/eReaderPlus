import type { FileRef, FileStat, Platform } from '../platform/platform';
import { platformBookFs } from './bookfs';
import { findPackagePath } from './epub';
import { decodeFb2 } from './fb2';
import { importBook, type ImportPreview } from './import';
import { comicSeries, epubSeries, fb2Series } from './series';
import {
  ALL_COLOR_THEMES,
  DEFAULT_LIBRARY_PREFS,
  DEFAULT_SETTINGS,
  type BookManifest,
  type EntryFlags,
  type LibraryEntry,
  type LibraryPrefs,
  type Progress,
  type ReaderSettings,
  type Series,
} from './types';
import { first, parseXml } from './xml';

const LIBRARY_KEY = 'library';
const SETTINGS_KEY = 'settings';
const PREFS_KEY = 'library-prefs';
/** Collection names, kept separately so a collection survives while it is empty. */
const COLLECTIONS_KEY = 'collections';
/** Set once books imported before series were read have been checked for one. */
const SERIES_BACKFILL_KEY = 'series-backfill-done';
const progressKey = (bookId: string) => `progress:${bookId}`;
const viewKey = (bookId: string) => `view:${bookId}`;

/** How a book is laid out, chosen for each book: one page or two side by side, and the cover alone in two-page view. */
export type BookView = Pick<ReaderSettings, 'spread' | 'spreadCover'>;

export async function loadLibrary(platform: Platform): Promise<LibraryEntry[]> {
  return (await platform.kvGet<LibraryEntry[]>(LIBRARY_KEY)) ?? [];
}

let libraryQueue: Promise<unknown> = Promise.resolve();

/** Read-modify-write of the library list, serialized so concurrent updates don't drop each other. */
function updateLibrary<T>(platform: Platform, update: (entries: LibraryEntry[]) => Promise<[LibraryEntry[], T]> | [LibraryEntry[], T]): Promise<T> {
  const run = libraryQueue.catch(() => {}).then(async () => {
    const [entries, result] = await update(await loadLibrary(platform));
    await platform.kvSet(LIBRARY_KEY, entries);
    return result;
  });
  libraryQueue = run;
  return run;
}

function entryFor(manifest: BookManifest, file: FileRef, stat: FileStat | null, opened: boolean): LibraryEntry {
  const now = Date.now();
  return {
    id: manifest.id,
    identifier: manifest.identifier,
    format: manifest.format,
    title: manifest.title,
    authors: manifest.authors,
    cover: manifest.cover,
    series: manifest.series,
    addedAt: now,
    lastOpenedAt: opened ? now : 0,
    progress: 0,
    source: file.ref,
    sourceStat: stat ?? undefined,
    fileName: file.name,
  };
}

export interface AddedBook {
  entry: LibraryEntry;
  isNew: boolean;
}

/**
 * Imports a file and adds it to the library. If the same book is already in the library, the new copy is
 * discarded and the existing entry is returned with `isNew` false. A book opened right away counts as
 * read now; one found by a folder scan (`opened: false`) waits on the shelf until it is first opened.
 * The book is added once it is readable; `onPreview` tells its title and cover long before (see importBook).
 */
export async function addBook(
  platform: Platform,
  file: FileRef,
  { opened = true, onPreview }: { opened?: boolean; onPreview?: (preview: ImportPreview) => void } = {},
): Promise<AddedBook> {
  // Read before the file is: a change made while it is imported shows the next time it is opened.
  const stat = (await platform.fileStat?.(file)) ?? null;
  const manifest = await importBook(platform, file, onPreview);
  const entry = entryFor(manifest, file, stat, opened);
  const existing = await updateLibrary(platform, (entries) => {
    const found = entries.find((e) => e.format === manifest.format && e.identifier === manifest.identifier);
    if (!found) return [[entry, ...entries], null];
    // The book is the one in this file: opening the file again opens it without importing it (bookFromFile).
    const updated = { ...found, source: file.ref, sourceStat: stat ?? undefined };
    return [entries.map((e) => (e === found ? updated : e)), updated];
  });
  if (existing) {
    void platform.deleteBook(manifest.id).catch(() => {});
    return { entry: existing, isNew: false };
  }
  return { entry, isNew: true };
}

/**
 * The book imported from `file`, to open instead of importing the file again: only while the file is unchanged since,
 * where the platform can tell. Where it can't (Android), `unchecked` says whether the book counts anyway.
 */
export async function bookFromFile(platform: Platform, file: FileRef, { unchecked }: { unchecked: boolean }): Promise<LibraryEntry | null> {
  // A file changed since may have been imported again as another book: the newest comes first.
  const imported = (await loadLibrary(platform)).filter((e) => e.source === file.ref);
  if (imported.length === 0) return null;
  if (!platform.fileStat) return unchecked ? imported[0] : null;
  const stat = await platform.fileStat(file);
  return (stat && imported.find((e) => e.sourceStat?.size === stat.size && e.sourceStat.modified === stat.modified)) || null;
}

/**
 * Books imported before series were read have none recorded. Once, reads their series from the files kept
 * in each book's folder. Returns true if any book got one.
 */
export async function backfillSeries(platform: Platform): Promise<boolean> {
  if (await platform.kvGet<boolean>(SERIES_BACKFILL_KEY)) return false;
  const found = new Map<string, Series>();
  for (const entry of await loadLibrary(platform)) {
    if (entry.series) continue;
    // A book whose metadata file can't be read simply has no series.
    const series = await storedSeries(platform, entry).catch(() => undefined);
    if (series) found.set(entry.id, series);
  }
  if (found.size > 0) {
    await updateLibrary(platform, (entries) => [entries.map((e) => (!e.series && found.has(e.id) ? { ...e, series: found.get(e.id) } : e)), undefined]);
  }
  await platform.kvSet(SERIES_BACKFILL_KEY, true);
  return found.size > 0;
}

async function storedSeries(platform: Platform, entry: LibraryEntry): Promise<Series | undefined> {
  const fs = platformBookFs(platform, entry.id, []);
  switch (entry.format) {
    case 'epub': {
      const opfPath = await findPackagePath(fs);
      return epubSeries(parseXml(await fs.readText(opfPath), opfPath));
    }
    case 'fb2':
      // Only a plain .fb2 import keeps its source under a known name; zipped FB2 can't be found again.
      return fb2Series(first(parseXml(decodeFb2(await fs.readBinary('source.fb2')), 'FB2'), 'title-info'));
    case 'cbz':
      return comicSeries(parseXml(await fs.readText('ComicInfo.xml'), 'ComicInfo.xml').documentElement);
    default:
      return undefined;
  }
}

export async function updateEntryFlags(platform: Platform, bookId: string, flags: EntryFlags): Promise<void> {
  await updateLibrary(platform, (entries) => [entries.map((e) => (e.id === bookId ? { ...e, ...flags } : e)), undefined]);
}

export async function loadCollections(platform: Platform): Promise<string[]> {
  return (await platform.kvGet<string[]>(COLLECTIONS_KEY)) ?? [];
}

export async function saveCollections(platform: Platform, names: string[]): Promise<void> {
  await platform.kvSet(COLLECTIONS_KEY, names);
}

/** Deletes a collection and takes every book out of it. The books stay in the library. */
export async function deleteCollection(platform: Platform, name: string): Promise<void> {
  await saveCollections(platform, (await loadCollections(platform)).filter((n) => n !== name));
  await updateLibrary(platform, (entries) => [
    entries.map((e) => (e.collections?.includes(name) ? { ...e, collections: e.collections.filter((c) => c !== name) } : e)),
    undefined,
  ]);
}

export async function loadLibraryPrefs(platform: Platform): Promise<LibraryPrefs> {
  const stored = await platform.kvGet<Partial<LibraryPrefs>>(PREFS_KEY);
  const prefs = { ...DEFAULT_LIBRARY_PREFS, ...stored, filter: { ...DEFAULT_LIBRARY_PREFS.filter, ...stored?.filter } };
  // A theme that has since been withdrawn falls back to the default.
  if (!ALL_COLOR_THEMES.includes(prefs.colorTheme)) prefs.colorTheme = DEFAULT_LIBRARY_PREFS.colorTheme;
  return prefs;
}

export async function saveLibraryPrefs(platform: Platform, prefs: LibraryPrefs): Promise<void> {
  await platform.kvSet(PREFS_KEY, prefs);
}

export async function removeBook(platform: Platform, bookId: string): Promise<void> {
  await updateLibrary(platform, (entries) => [entries.filter((e) => e.id !== bookId), undefined]);
  await platform.kvSet(progressKey(bookId), null);
  await platform.kvSet(viewKey(bookId), null);
  await platform.deleteBook(bookId);
}

export async function markOpened(platform: Platform, bookId: string): Promise<void> {
  await updateLibrary(platform, (entries) => [entries.map((e) => (e.id === bookId ? { ...e, lastOpenedAt: Date.now() } : e)), undefined]);
}

export async function loadProgress(platform: Platform, bookId: string): Promise<Progress | null> {
  return platform.kvGet<Progress>(progressKey(bookId));
}

export async function saveProgress(platform: Platform, bookId: string, progress: Progress): Promise<void> {
  await platform.kvSet(progressKey(bookId), progress);
  await updateLibrary(platform, (entries) => [entries.map((e) => (e.id === bookId ? { ...e, progress: progress.overall } : e)), undefined]);
}

export function overallProgress(manifest: BookManifest, spineIndex: number, fraction: number): number {
  return Math.min(1, (spineIndex + fraction) / Math.max(1, manifest.spine.length));
}

/** The book's own view, or null before the book was first opened with this saved. */
export async function loadBookView(platform: Platform, bookId: string): Promise<BookView | null> {
  const view = await platform.kvGet<Partial<BookView>>(viewKey(bookId));
  return view ? { spread: view.spread === true, spreadCover: view.spreadCover === true } : null;
}

export async function saveBookView(platform: Platform, bookId: string, view: BookView): Promise<void> {
  await platform.kvSet(viewKey(bookId), view);
}

export async function loadSettings(platform: Platform): Promise<ReaderSettings> {
  return { ...DEFAULT_SETTINGS, ...(await platform.kvGet<Partial<ReaderSettings>>(SETTINGS_KEY)) };
}

export async function saveSettings(platform: Platform, settings: ReaderSettings): Promise<void> {
  await platform.kvSet(SETTINGS_KEY, settings);
}
