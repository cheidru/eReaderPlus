/** The in-app folder browser and watched-folder scans, on the desktop file system. */
import type { Dirent } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FolderEntry, FolderListing, FoundBookFile } from '../src/platform/platform';

/** Deeper than this is almost certainly not a book collection (and guards against pathological trees). */
const MAX_DEPTH = 16;
/** A scan stops after this many book files. */
const MAX_FILES = 20_000;
/** Folders that hold system data, never books. */
const SYSTEM_FOLDERS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '$windows.~bt', '$windows.~ws']);

const isHidden = (name: string) => name.startsWith('.') || SYSTEM_FOLDERS.has(name.toLowerCase());
const hasExtension = (name: string, extensions: Set<string>) => extensions.has(path.extname(name).slice(1).toLowerCase());
const byName = (a: FolderEntry, b: FolderEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** How long a drive or folder may take to answer: a disconnected network drive can hang for minutes. */
const RESPONSE_TIMEOUT_MS = 2000;

class NotRespondingError extends Error {}

/** `promise`, or a NotRespondingError if it takes longer than `ms` (the work itself goes on in the background). */
function answerWithin<T>(promise: Promise<T>, ms = RESPONSE_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new NotRespondingError('The drive is not responding')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Checks still waiting for an answer, by path: one that hangs is shared by everyone who asks again meanwhile, so
 * a drive that doesn't respond doesn't tie up another file system thread each time the folder list is shown.
 */
const pending = new Map<string, Promise<unknown>>();

function once<T>(key: string, start: () => Promise<T>): Promise<T> {
  let running = pending.get(key) as Promise<T> | undefined;
  if (!running) {
    running = start();
    pending.set(key, running);
    void running.catch(() => {}).finally(() => pending.delete(key));
  }
  return running;
}

/** Whether a drive is there and answers in time. One still not answering since it was last asked is left out at once. */
async function available(root: string): Promise<boolean> {
  const key = `access:${root}`;
  if (pending.has(key)) return false;
  try {
    await answerWithin(once(key, () => access(root)));
    return true;
  } catch {
    return false;
  }
}

/** A folder's entries; a NotRespondingError if its drive doesn't answer in time. */
const readFolder = (dir: string) => answerWithin(once(`readdir:${dir}`, () => readdir(dir, { withFileTypes: true })));

/**
 * Home folder first, then drives (Windows), volumes (macOS) or the file system root and mounts (Linux). Drives that
 * don't answer in time (a mapped network drive whose server is away) are left out.
 */
async function roots(): Promise<FolderEntry[]> {
  const home = os.homedir();
  const list: FolderEntry[] = [{ name: `Home (${home})`, path: home }];
  if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const drives = await Promise.all(letters.map(async (l) => ((await available(`${l}:\\`)) ? `${l}:\\` : null)));
    for (const drive of drives) if (drive) list.push({ name: `Drive ${drive.slice(0, 2)}`, path: drive });
  } else {
    list.push({ name: 'File system (/)', path: '/' });
    const mounts = process.platform === 'darwin' ? ['/Volumes'] : [`/media/${os.userInfo().username}`, '/mnt'];
    for (const mount of mounts) {
      const entries = await readFolder(mount).catch(() => [] as Dirent[]);
      for (const e of entries) if (e.isDirectory() && !isHidden(e.name)) list.push({ name: e.name, path: path.join(mount, e.name) });
    }
  }
  return list;
}

export async function listFolder(dir: string, extensions: string[]): Promise<FolderListing> {
  if (dir === '') return { path: '', parent: null, folders: await roots(), books: [], error: null };
  const parentDir = path.dirname(dir);
  // The parent of a drive or of / is the roots list.
  const parent = parentDir === dir ? '' : parentDir;
  try {
    const wanted = new Set(extensions);
    const entries = await readFolder(dir);
    const folders = entries.filter((e) => e.isDirectory() && !isHidden(e.name)).map((e) => ({ name: e.name, path: path.join(dir, e.name) }));
    const books: FoundBookFile[] = [];
    for (const e of entries.filter((e) => e.isFile() && hasExtension(e.name, wanted))) {
      const full = path.join(dir, e.name);
      const info = await stat(full).catch(() => null);
      if (info) books.push({ file: { ref: full, name: e.name }, path: full, size: info.size, modified: info.mtimeMs });
    }
    books.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { sensitivity: 'base', numeric: true }));
    return { path: dir, parent, folders: folders.sort(byName), books, error: null };
  } catch (error) {
    const message = error instanceof NotRespondingError ? 'This drive is not responding. If it is a network drive, check its connection.' : error instanceof Error ? error.message : String(error);
    return { path: dir, parent, folders: [], books: [], error: message };
  }
}

export async function findBookFiles(folder: string, extensions: string[]): Promise<FoundBookFile[]> {
  const wanted = new Set(extensions);
  const found: FoundBookFile[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    // An unreadable (or unresponsive) subfolder is skipped, not fatal: the rest of the collection still counts.
    const entries = await readFolder(dir).catch(() => [] as Dirent[]);
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      const full = path.join(dir, entry.name);
      // Dirent types come from lstat: symbolic links are neither files nor directories here, so they are not followed.
      if (entry.isDirectory() && !isHidden(entry.name)) await walk(full, depth + 1);
      else if (entry.isFile() && hasExtension(entry.name, wanted)) {
        const info = await stat(full).catch(() => null);
        if (info) found.push({ file: { ref: full, name: entry.name }, path: full, size: info.size, modified: info.mtimeMs });
      }
    }
  };
  await walk(folder, 0);
  return found;
}
