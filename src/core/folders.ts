/**
 * Watched folders: the user picks folders, and the app imports the books in them (and their subfolders).
 * Every file seen is recorded with its size and modification time, so a scan imports only new or changed
 * files: a book the reader removed stays removed, and a file that failed to import is not retried until it
 * changes. Books whose files disappear stay in the library; the app keeps its own copy.
 */
import type { FileRef, Platform } from '../platform/platform';
import { SUPPORTED_EXTENSIONS, type ImportPreview } from './import';
import { addBook } from './library';
import { MARKDOWN_EXTENSIONS } from './markdown';
import type { LibraryEntry } from './types';

const FOLDERS_KEY = 'watched-folders';
const SEEN_KEY = 'watched-files';

/**
 * What the folder browser lists and scans look for. Plain .zip is left out: a generic archive is rarely a book, and
 * finding out means copying and unpacking it. Opening one by hand still works.
 */
export const SCAN_EXTENSIONS = SUPPORTED_EXTENSIONS.filter((ext) => ext !== 'zip');

/**
 * What scans of watched folders import: not Markdown, as folders are full of read-me and note files that are not
 * books. The folder browser lists Markdown files, to open by hand.
 */
export const WATCHED_EXTENSIONS = SCAN_EXTENSIONS.filter((ext) => !MARKDOWN_EXTENSIONS.includes(ext));

interface SeenFile {
  size: number;
  modified: number;
  /** The book it became, or null when it could not be imported. */
  bookId: string | null;
}

export interface ScanResult {
  /** Book files found in the watched folders. */
  found: number;
  /** New books in the library. */
  added: number;
  /** Files that could not be imported (damaged, DRM-protected, or not really a book). */
  failed: number;
}

export async function loadWatchedFolders(platform: Platform): Promise<string[]> {
  return (await platform.kvGet<string[]>(FOLDERS_KEY)) ?? [];
}

export async function saveWatchedFolders(platform: Platform, folders: string[]): Promise<void> {
  await platform.kvSet(FOLDERS_KEY, folders);
}

/** Adds a folder, unless it or a folder containing it is already watched. Folders inside it are dropped. */
export function withFolder(folders: string[], folder: string): string[] {
  if (folders.some((f) => isInside(folder, f))) return folders;
  return [...folders.filter((f) => !isInside(f, folder)), folder];
}

/** Whether `path` is `folder` or inside it (either path separator, case-insensitively on Windows-style paths). */
export function isInside(path: string, folder: string): boolean {
  const norm = (p: string) => {
    const unified = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return /^[a-z]:/i.test(unified) ? unified.toLowerCase() : unified;
  };
  const p = norm(path);
  const f = norm(folder);
  return p === f || p.startsWith(`${f}/`);
}

let running: Promise<ScanResult> | null = null;

/** What a scan reports while it runs. */
export interface ScanEvents {
  /** Files handled out of the files to import. */
  onProgress?: (done: number, total: number) => void;
  /** A file's import starts. */
  onImporting?: (file: FileRef) => void;
  /** The title and cover of the file being imported are known (see importBook). */
  onPreview?: (preview: ImportPreview) => void;
  /** The file being imported is done: its book (new, or the same book already in the library), or null if it failed. */
  onImported?: (entry: LibraryEntry | null, isNew: boolean) => void;
}

/**
 * Imports new and changed book files from the watched folders. One scan at a time: a scan requested while
 * one runs gets that scan's result (and only the first caller's events).
 */
export function scanWatchedFolders(platform: Platform, events: ScanEvents = {}): Promise<ScanResult> {
  running ??= scan(platform, events).finally(() => (running = null));
  return running;
}

async function scan(platform: Platform, { onProgress = () => {}, onImporting, onPreview, onImported }: ScanEvents): Promise<ScanResult> {
  const folders = await loadWatchedFolders(platform);
  const seen = (await platform.kvGet<Record<string, SeenFile>>(SEEN_KEY)) ?? {};
  const files = new Map<string, { file: FileRef; size: number; modified: number }>();
  for (const folder of folders) {
    for (const found of await platform.findBookFiles(folder, WATCHED_EXTENSIONS)) files.set(found.path, found);
  }

  const todo = [...files].filter(([path, f]) => seen[path]?.size !== f.size || seen[path]?.modified !== f.modified);
  const result: ScanResult = { found: files.size, added: 0, failed: 0 };
  for (const [i, [path, f]] of todo.entries()) {
    onProgress(i, todo.length);
    onImporting?.(f.file);
    let bookId: string | null = null;
    try {
      const { entry, isNew } = await addBook(platform, f.file, { opened: false, onPreview });
      bookId = entry.id;
      if (isNew) result.added++;
      onImported?.(entry, isNew);
    } catch {
      result.failed++;
      onImported?.(null, false);
    }
    seen[path] = { size: f.size, modified: f.modified, bookId };
    // Saved as it goes, so a scan cut short (app closed) doesn't import the same files again.
    await platform.kvSet(SEEN_KEY, seen);
  }
  onProgress(todo.length, todo.length);
  return result;
}
