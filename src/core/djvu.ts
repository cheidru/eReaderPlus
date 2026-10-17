/**
 * DjVu: one fixed-layout HTML page per DjVu page. Pages are not converted at import; each page document gets its
 * page decoded from the original file by the app, which keeps the open book in memory (djvu-pages.ts), and decodes
 * it with DjVu.js itself when the app can't (src/inject/djvu-page.ts).
 * DjVu.js (vendor/djvujs) is GPL-licensed; it is loaded at runtime from the reader assets, not bundled.
 */
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { sha256Hex } from './fonts';
import { injectReader, READER_ASSETS_PREFIX } from './inject';
import type { OnPreview, SpineItem, TocItem } from './types';
import { escapeXml } from './xml';

export const DJVU_SOURCE = 'source.djvu';
const COVER_PATH = '.ereader/cover.jpg';

/** The parts of DjVu.js used by the app: the synchronous API at import, the worker while a book is read (djvu-pages.ts). */
export interface DjvuLibrary {
  Document: new (buffer: ArrayBuffer) => DjvuDocument;
  Worker: new (url: string) => DjvuWorker;
}

/** A DjVu.js worker: `doc` builds a task (a chain of document method calls) that `run` carries out in the worker. */
export interface DjvuWorker {
  worker: Worker;
  doc: DjvuWorkerTask;
  createDocument(buffer: ArrayBuffer): Promise<void>;
  /** Resolves to the result of a single task, or to an array of the results of several. */
  run(...tasks: DjvuWorkerTask[]): Promise<unknown>;
  terminate(): void;
}

export interface DjvuWorkerTask {
  getPagesQuantity(): DjvuWorkerTask;
  getPage(n: number): DjvuWorkerTask;
  getImageData(): DjvuWorkerTask;
  getNormalizedTextZones(): DjvuWorkerTask;
}

interface DjvuDocument {
  getPagesQuantity(): number;
  isBundled(): boolean;
  getContents(): DjvuBookmark[] | null;
  getPageNumberByUrl(url: string): number | null;
  getPageUnsafe(number: number): DjvuPage;
}

interface DjvuPage {
  getWidth(): number;
  getHeight(): number;
  getRotation(): number;
  getImageData(): ImageData;
  reset(): void;
}

interface DjvuBookmark {
  description: string;
  url: string;
  children?: DjvuBookmark[];
}

let library: Promise<DjvuLibrary> | null = null;

/** Loads DjVu.js into the app (it defines a `DjVu` global). */
export function loadDjvuLibrary(): Promise<DjvuLibrary> {
  library ??= new Promise<DjvuLibrary>((resolve, reject) => {
    const global = () => (window as unknown as { DjVu?: DjvuLibrary }).DjVu;
    if (global()) return resolve(global()!);
    const script = document.createElement('script');
    script.src = `${READER_ASSETS_PREFIX}djvu.js`;
    script.onload = () => (global() ? resolve(global()!) : reject(new Error('The DjVu library did not load')));
    script.onerror = () => reject(new Error('The DjVu library could not be loaded'));
    document.head.append(script);
  }).catch((error: unknown) => {
    library = null;
    throw error;
  });
  return library;
}

const pagePath = (n: number) => `.ereader/pages/${String(n).padStart(4, '0')}.html`;

function pageHtml(n: number, width: number, height: number): string {
  return injectReader(
    '<!DOCTYPE html>\n<html><head><meta charset="utf-8"/>' +
      `<meta name="viewport" content="width=${width}, height=${height}"/><title>${n}</title>` +
      `<link rel="stylesheet" href="${READER_ASSETS_PREFIX}djvu-page.css"/>` +
      `<script src="${READER_ASSETS_PREFIX}djvu-page.js"></script>` +
      `</head><body><canvas class="djvu-page" data-source="../../${escapeXml(DJVU_SOURCE)}" data-page="${n}"></canvas></body></html>`,
  );
}

/** Renders the first page, scaled down, as the library cover. */
async function writeCover(fs: BookFs, doc: DjvuDocument): Promise<string | null> {
  // Platforms without createImageBitmap (unit tests) get no cover.
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const page = doc.getPageUnsafe(1);
    const jpeg = await jpegThumbnail(page.getImageData());
    page.reset();
    if (!jpeg) return null;
    await fs.writeBinary(COVER_PATH, jpeg);
    return COVER_PATH;
  } catch (error) {
    console.warn('Could not render the DjVu cover:', error);
    return null;
  }
}

async function jpegThumbnail(image: ImageData): Promise<Uint8Array | null> {
  const scale = Math.min(1, 800 / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Writes the page documents for the DjVu file at `sourcePath`. */
export async function importDjvu(fs: BookFs, sourcePath: string, fileName: string, lib: DjvuLibrary, onPreview?: OnPreview): Promise<ParsedBook> {
  const bytes = await fs.readBinary(sourcePath);
  let doc: DjvuDocument;
  try {
    doc = new lib.Document(bytes.slice().buffer);
  } catch {
    throw new Error(`Not a DjVu file: ${fileName}`);
  }
  if (!doc.isBundled()) throw new Error('Indirect (multi-file) DjVu documents are not supported. Open a bundled .djvu file.');

  const count = doc.getPagesQuantity();
  if (count < 1) throw new Error('The DjVu document has no pages');
  const title = fileName.replace(/\.[^.]+$/, '');
  // The cover first, so the library shows it while the page documents are written.
  const cover = await writeCover(fs, doc);
  onPreview?.({ title, authors: [], cover });
  const spine: SpineItem[] = [];
  for (let n = 1; n <= count; n++) {
    const page = doc.getPageUnsafe(n);
    // Width/height initialize the page; the rotation is only known afterwards.
    let width = page.getWidth();
    let height = page.getHeight();
    if (page.getRotation() % 180 !== 0) [width, height] = [height, width];
    page.reset();
    await fs.writeText(pagePath(n), pageHtml(n, width, height));
    spine.push({ href: pagePath(n), linear: true });
  }

  const toToc = (items: DjvuBookmark[]): TocItem[] =>
    items.map((b) => {
      const n = b.url ? doc.getPageNumberByUrl(b.url) : null;
      return { label: b.description || '…', href: n ? pagePath(n) : '', children: toToc(b.children ?? []) };
    });
  let toc: TocItem[] = [];
  try {
    toc = toToc(doc.getContents() ?? []);
  } catch {
    // A damaged outline should not stop the book from opening.
  }
  // Outlines often wrap everything in a single entry named after the file.
  if (toc.length === 1 && toc[0].children.length > 0 && !toc[0].href) toc = toc[0].children;

  return {
    identifier: `djvu:${await sha256Hex(bytes)}`,
    title,
    authors: [],
    language: '',
    cover,
    layout: 'pre-paginated',
    direction: 'ltr',
    spine,
    toc,
  };
}
