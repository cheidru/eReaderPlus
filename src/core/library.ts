import type { FileRef, Platform } from '../platform/platform';
import { importBook } from './import';
import { DEFAULT_SETTINGS, type BookManifest, type LibraryEntry, type Progress, type ReaderSettings } from './types';

const LIBRARY_KEY = 'library';
const SETTINGS_KEY = 'settings';
const progressKey = (bookId: string) => `progress:${bookId}`;

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

function entryFor(manifest: BookManifest): LibraryEntry {
  const now = Date.now();
  return {
    id: manifest.id,
    identifier: manifest.identifier,
    format: manifest.format,
    title: manifest.title,
    authors: manifest.authors,
    cover: manifest.cover,
    addedAt: now,
    lastOpenedAt: now,
    progress: 0,
  };
}

/**
 * Imports a file and adds it to the library. If the same book is already in the library,
 * the new copy is discarded and the existing entry is returned.
 */
export async function addBook(platform: Platform, file: FileRef): Promise<LibraryEntry> {
  const manifest = await importBook(platform, file);
  const existing = await updateLibrary(platform, (entries) => {
    const found = entries.find((e) => e.format === manifest.format && e.identifier === manifest.identifier);
    return [found ? entries : [entryFor(manifest), ...entries], found ?? null];
  });
  if (existing) {
    await platform.deleteBook(manifest.id);
    return existing;
  }
  return entryFor(manifest);
}

export async function removeBook(platform: Platform, bookId: string): Promise<void> {
  await updateLibrary(platform, (entries) => [entries.filter((e) => e.id !== bookId), undefined]);
  await platform.kvSet(progressKey(bookId), null);
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

export async function loadSettings(platform: Platform): Promise<ReaderSettings> {
  return { ...DEFAULT_SETTINGS, ...(await platform.kvGet<Partial<ReaderSettings>>(SETTINGS_KEY)) };
}

export async function saveSettings(platform: Platform, settings: ReaderSettings): Promise<void> {
  await platform.kvSet(SETTINGS_KEY, settings);
}
