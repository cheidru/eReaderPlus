import type { FileRef, Platform } from '../platform/platform';
import { platformBookFs } from './bookfs';
import { comicImages, importCbz } from './cbz';
import { CHM_SOURCE, importChm } from './chm';
import { DJVU_SOURCE, importDjvu, loadDjvuLibrary } from './djvu';
import { importEpub, isEpubContainer, type ParsedBook } from './epub';
import { importFb2 } from './fb2';
import { importLit } from './lit';
import { importMobi } from './mobi';
import { importPdf, loadPdfLibrary, PDF_SOURCE } from './pdf';
import { extension } from './paths';
import { MANIFEST_PATH, type BookFormat, type BookManifest } from './types';

export const SUPPORTED_EXTENSIONS = ['epub', 'kepub', 'fb2', 'fbz', 'cbz', 'zip', 'mobi', 'azw', 'azw3', 'djvu', 'djv', 'pdf', 'chm', 'lit'];
const MOBI_EXTENSIONS = ['mobi', 'azw', 'azw3'];
const DJVU_EXTENSIONS = ['djvu', 'djv'];

export function newBookId(): string {
  // Lowercase hex: usable as a URL host label on every platform.
  return crypto.randomUUID().replace(/-/g, '');
}

export interface ImportedBook {
  manifest: BookManifest;
  /** Set while the cover is still being drawn: settles to its path (also saved in the manifest), or null. */
  pendingCover: Promise<string | null> | null;
}

/** Imports a book file into its own folder and returns its manifest. Cleans up on failure. */
export async function importBook(platform: Platform, file: FileRef): Promise<ImportedBook> {
  const id = newBookId();
  let book: ParsedBook;
  let format: BookFormat;
  try {
    ({ format, parsed: book } = await convert(platform, file, id));
  } catch (error) {
    await platform.deleteBook(id).catch(() => {});
    throw error;
  }
  const { pendingCover, ...parsed } = book;
  const manifest: BookManifest = { version: 1, id, format, ...parsed };
  try {
    await platform.writeText(id, MANIFEST_PATH, JSON.stringify(manifest));
  } catch (error) {
    // Let a cover being drawn finish writing before the folder goes.
    await pendingCover?.catch(() => {});
    await platform.deleteBook(id).catch(() => {});
    throw error;
  }
  const savedCover =
    pendingCover?.then(async (cover) => {
      if (cover) await platform.writeText(id, MANIFEST_PATH, JSON.stringify({ ...manifest, cover }));
      return cover;
    }) ?? null;
  return { manifest, pendingCover: savedCover };
}

async function convert(platform: Platform, file: FileRef, id: string): Promise<{ format: BookFormat; parsed: ParsedBook }> {
  const ext = extension(file.name);
  if (ext === 'fb2' || file.name.toLowerCase().endsWith('.fb2.xml')) {
    await platform.copyRawFile(file, id, 'source.fb2');
    return { format: 'fb2', parsed: await importFb2(platformBookFs(platform, id, ['source.fb2']), 'source.fb2') };
  }
  if (MOBI_EXTENSIONS.includes(ext)) {
    await platform.copyRawFile(file, id, 'source.mobi');
    return importMobi(platformBookFs(platform, id, ['source.mobi']), 'source.mobi', file.name);
  }
  if (DJVU_EXTENSIONS.includes(ext)) {
    await platform.copyRawFile(file, id, DJVU_SOURCE);
    const parsed = await importDjvu(platformBookFs(platform, id, [DJVU_SOURCE]), DJVU_SOURCE, file.name, await loadDjvuLibrary());
    return { format: 'djvu', parsed };
  }
  if (ext === 'pdf') {
    await platform.copyRawFile(file, id, PDF_SOURCE);
    const parsed = await importPdf(platformBookFs(platform, id, [PDF_SOURCE]), PDF_SOURCE, file.name, await loadPdfLibrary());
    return { format: 'pdf', parsed };
  }
  if (ext === 'chm') {
    await platform.copyRawFile(file, id, CHM_SOURCE);
    return { format: 'chm', parsed: await importChm(platformBookFs(platform, id, [CHM_SOURCE]), CHM_SOURCE, file.name) };
  }
  if (ext === 'lit') {
    await platform.copyRawFile(file, id, 'source.lit');
    return { format: 'lit', parsed: await importLit(platformBookFs(platform, id, ['source.lit']), 'source.lit', file.name) };
  }

  let files: string[];
  try {
    files = await platform.extractArchive(file, id);
  } catch {
    throw new Error(`Unsupported or damaged file: ${file.name}`);
  }
  const fs = platformBookFs(platform, id, files);

  if (isEpubContainer(files)) return { format: 'epub', parsed: await importEpub(fs) };
  const fb2 = files.find((f) => extension(f) === 'fb2');
  if (fb2) return { format: 'fb2', parsed: await importFb2(fs, fb2) };
  if (comicImages(files).length > 0) return { format: 'cbz', parsed: await importCbz(fs, file.name) };
  throw new Error(`Unsupported book format: ${file.name}`);
}

export async function loadManifest(platform: Platform, bookId: string): Promise<BookManifest> {
  return JSON.parse(await platform.readText(bookId, MANIFEST_PATH)) as BookManifest;
}
