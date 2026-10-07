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

export async function extractArchive(archivePath: string, bookId: string): Promise<string[]> {
  const zip = await yauzl.openPromise(archivePath, { lazyEntries: true, autoClose: true });
  const extracted: string[] = [];
  let totalBytes = 0;
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        if (extracted.length >= MAX_ENTRIES) throw new Error('Archive has too many files');
        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Archive is too large');
        const name = entry.fileName.replace(/\\/g, '/');
        if (!name.endsWith('/')) {
          const target = resolveInBook(bookId, name);
          await mkdir(path.dirname(target), { recursive: true });
          await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(target));
          extracted.push(name);
        }
        zip.readEntry();
      })().catch((error: unknown) => {
        zip.close();
        reject(error);
      });
    });
    zip.readEntry();
  });
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
