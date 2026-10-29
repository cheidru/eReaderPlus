import { app } from 'electron';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

const MAX_ENTRIES = 50_000;
const MAX_TOTAL_BYTES = 4 * 1024 ** 3;

export function booksDir(): string {
  return path.join(app.getPath('userData'), 'books');
}

export function isBookId(id: string): boolean {
  return /^[a-f0-9]{32}$/.test(id);
}

export function bookDir(bookId: string): string {
  if (!isBookId(bookId)) throw new Error('Invalid book id');
  return path.join(booksDir(), bookId);
}

/** Resolves a book-relative path to an absolute file path, refusing anything outside the book folder. */
export function resolveInBook(bookId: string, relative: string): string {
  const dir = bookDir(bookId);
  const resolved = path.resolve(dir, relative.replace(/^[/\\]+/, ''));
  if (!resolved.startsWith(dir + path.sep)) throw new Error(`Path escapes the book folder: ${relative}`);
  return resolved;
}

/** Files written at once while extracting: a book of thousands of small files extracts several times faster than one by one. */
const EXTRACT_CONCURRENCY = 4;

export async function extractArchive(archivePath: string, bookId: string): Promise<string[]> {
  const zip = await yauzl.openPromise(archivePath, { lazyEntries: true, autoClose: false });
  const extracted: string[] = [];
  let entries = 0;
  let totalBytes = 0;
  /** Each folder is made once, also when files in it are written at the same time. */
  const folders = new Map<string, Promise<unknown>>();
  const makeFolder = (dir: string) => {
    let made = folders.get(dir);
    if (!made) folders.set(dir, (made = mkdir(dir, { recursive: true })));
    return made;
  };
  const writing = new Set<Promise<void>>();
  try {
    await new Promise<void>((resolve, reject) => {
      let failed = false;
      const fail = (error: unknown) => {
        failed = true;
        reject(error);
      };
      zip.on('error', fail);
      zip.on('end', () => void Promise.all(writing).then(() => resolve(), fail));
      zip.on('entry', (entry: yauzl.Entry) => {
        if (failed) return;
        if (++entries > MAX_ENTRIES) return fail(new Error('Archive has too many files'));
        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_TOTAL_BYTES) return fail(new Error('Archive is too large'));
        const name = entry.fileName.replace(/\\/g, '/');
        if (name.endsWith('/')) return zip.readEntry();
        const write = (async () => {
          const target = resolveInBook(bookId, name);
          await makeFolder(path.dirname(target));
          await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(target));
          extracted.push(name);
        })();
        writing.add(write);
        write.then(
          () => {
            writing.delete(write);
            // The next entry is read once a file is written, if all the others were still being written.
            if (!failed && writing.size === EXTRACT_CONCURRENCY - 1) zip.readEntry();
          },
          fail,
        );
        if (writing.size < EXTRACT_CONCURRENCY) zip.readEntry();
      });
      zip.readEntry();
    });
  } finally {
    // Files still being written when another failed finish (or fail) before the archive closes under them.
    await Promise.allSettled(writing);
    zip.close();
  }
  return extracted;
}

export async function copyRawFile(source: string, bookId: string, dest: string): Promise<void> {
  const target = resolveInBook(bookId, dest);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

export async function readText(bookId: string, relative: string): Promise<string> {
  return readFile(resolveInBook(bookId, relative), 'utf8');
}

export async function readBinary(bookId: string, relative: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(resolveInBook(bookId, relative)));
}

export async function writeFileInBook(bookId: string, relative: string, data: string | Uint8Array): Promise<void> {
  const target = resolveInBook(bookId, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}

export async function deleteBook(bookId: string): Promise<void> {
  await rm(bookDir(bookId), { recursive: true, force: true });
}
