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
import { MANIFEST_PATH, type BookFormat, type BookManifest, type BookPreview, type OnPreview } from './types';

export const SUPPORTED_EXTENSIONS = ['epub', 'kepub', 'fb2', 'fbz', 'cbz', 'zip', 'mobi', 'azw', 'azw3', 'djvu', 'djv', 'pdf', 'chm', 'lit'];
const MOBI_EXTENSIONS = ['mobi', 'azw', 'azw3'];
const DJVU_EXTENSIONS = ['djvu', 'djv'];

export function newBookId(): string {
  // Lowercase hex: usable as a URL host label on every platform.
  return crypto.randomUUID().replace(/-/g, '');
}

/** A book's preview (see BookPreview) while it is imported into the folder of `bookId`, where its cover is. */
export interface ImportPreview extends BookPreview {
  bookId: string;
}

/**
 * Imports a book file into its own folder and returns its manifest. Cleans up on failure. As soon as the title and
 * cover are known, well before the book is converted, `onPreview` tells them (for the formats that can).
 */
export async function importBook(platform: Platform, file: FileRef, onPreview?: (preview: ImportPreview) => void): Promise<BookManifest> {
  const id = newBookId();
  try {
    const { format, parsed } = await convert(platform, file, id, onPreview && ((preview) => onPreview({ ...preview, bookId: id })));
    const manifest: BookManifest = { version: 1, id, format, ...parsed };
    await platform.writeText(id, MANIFEST_PATH, JSON.stringify(manifest));
    return manifest;
  } catch (error) {
    await platform.deleteBook(id).catch(() => {});
    throw error;
  }
}

async function convert(platform: Platform, file: FileRef, id: string, onPreview?: OnPreview): Promise<{ format: BookFormat; parsed: ParsedBook }> {
  const ext = extension(file.name);
  if (ext === 'fb2' || file.name.toLowerCase().endsWith('.fb2.xml')) {
    await platform.copyRawFile(file, id, 'source.fb2');
    return { format: 'fb2', parsed: await importFb2(platformBookFs(platform, id, ['source.fb2']), 'source.fb2', onPreview) };
  }
  if (MOBI_EXTENSIONS.includes(ext)) {
    await platform.copyRawFile(file, id, 'source.mobi');
    return importMobi(platformBookFs(platform, id, ['source.mobi']), 'source.mobi', file.name, onPreview);
  }
  if (DJVU_EXTENSIONS.includes(ext)) {
    await platform.copyRawFile(file, id, DJVU_SOURCE);
    const parsed = await importDjvu(platformBookFs(platform, id, [DJVU_SOURCE]), DJVU_SOURCE, file.name, await loadDjvuLibrary(), onPreview);
    return { format: 'djvu', parsed };
  }
  if (ext === 'pdf') {
    await platform.copyRawFile(file, id, PDF_SOURCE);
    const parsed = await importPdf(platformBookFs(platform, id, [PDF_SOURCE]), PDF_SOURCE, file.name, await loadPdfLibrary(), onPreview);
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

  if (isEpubContainer(files)) return { format: 'epub', parsed: await importEpub(fs, onPreview) };
  const fb2 = files.find((f) => extension(f) === 'fb2');
  if (fb2) return { format: 'fb2', parsed: await importFb2(fs, fb2, onPreview) };
  if (comicImages(files).length > 0) return { format: 'cbz', parsed: await importCbz(fs, file.name, onPreview) };
  throw new Error(`Unsupported book format: ${file.name}`);
}

export async function loadManifest(platform: Platform, bookId: string): Promise<BookManifest> {
  return JSON.parse(await platform.readText(bookId, MANIFEST_PATH)) as BookManifest;
}
