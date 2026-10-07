/**
 * PDF: one fixed-layout HTML page per PDF page, rendered by pdf.js when shown (src/inject/pdf-page.ts).
 * pdf.js (Apache-2.0) is loaded at runtime from the reader assets, not bundled into the app.
 */
import type * as PdfJs from 'pdfjs-dist';
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { injectReader, READER_ASSETS_PREFIX } from './inject';
import { CSS_PX_PER_PT, destinationPage, pdfDocumentOptions, PDFJS_MODULE, PDFJS_WORKER } from './pdf-common';
import type { SpineItem, TocItem } from './types';
import { escapeXml } from './xml';

export const PDF_SOURCE = 'source.pdf';
const COVER_PATH = '.ereader/cover.jpg';

export type PdfLibrary = typeof PdfJs;
type PdfDocument = PdfJs.PDFDocumentProxy;
type OutlineNode = Awaited<ReturnType<PdfDocument['getOutline']>>[number];

let library: Promise<PdfLibrary> | null = null;

/** Loads pdf.js into the app from the reader assets. */
export function loadPdfLibrary(): Promise<PdfLibrary> {
  library ??= (import(/* @vite-ignore */ PDFJS_MODULE) as Promise<PdfLibrary>)
    .then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    })
    .catch((error: unknown) => {
      library = null;
      throw error;
    });
  return library;
}

export const pdfPagePath = (n: number) => `.ereader/pages/${String(n).padStart(4, '0')}.html`;

function pageHtml(n: number, width: number, height: number): string {
  return injectReader(
    '<!DOCTYPE html>\n<html><head><meta charset="utf-8"/>' +
      `<meta name="viewport" content="width=${width}, height=${height}"/><title>${n}</title>` +
      `<link rel="stylesheet" href="${READER_ASSETS_PREFIX}pdf-page.css"/>` +
      `<script src="${READER_ASSETS_PREFIX}pdf-page.js"></script>` +
      `</head><body><canvas class="pdf-page" data-source="../../${escapeXml(PDF_SOURCE)}" data-page="${n}"></canvas></body></html>`,
  );
}

async function outlineToc(doc: PdfDocument, items: OutlineNode[]): Promise<TocItem[]> {
  const toc: TocItem[] = [];
  for (const item of items) {
    const page = item.dest ? await destinationPage(doc, item.dest) : null;
    toc.push({
      label: item.title.trim() || '…',
      href: page !== null && page < doc.numPages ? pdfPagePath(page + 1) : '',
      children: await outlineToc(doc, item.items ?? []),
    });
  }
  return toc;
}

async function writeCover(fs: BookFs, doc: PdfDocument): Promise<string | null> {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 800 / base.height });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    // No 2D context where there is no real canvas (unit tests).
    const context = canvas.getContext('2d');
    if (!context) return null;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return null;
    await fs.writeBinary(COVER_PATH, new Uint8Array(await blob.arrayBuffer()));
    return COVER_PATH;
  } catch (error) {
    console.warn('Could not render the PDF cover:', error);
    return null;
  }
}

function metadataText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Writes the page documents for the PDF at `sourcePath`. */
export async function importPdf(fs: BookFs, sourcePath: string, fileName: string, lib: PdfLibrary): Promise<ParsedBook> {
  const bytes = await fs.readBinary(sourcePath);
  const task = lib.getDocument({ data: bytes.slice(), ...pdfDocumentOptions() });
  let doc: PdfDocument;
  try {
    doc = await task.promise;
  } catch (error) {
    void task.destroy();
    if ((error as Error)?.name === 'PasswordException') throw new Error('This PDF is password-protected and cannot be opened.');
    throw new Error(`Not a PDF file, or the file is damaged: ${fileName}`);
  }
  try {
    const spine: SpineItem[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: CSS_PX_PER_PT });
      await fs.writeText(pdfPagePath(n), pageHtml(n, Math.round(viewport.width), Math.round(viewport.height)));
      page.cleanup();
      spine.push({ href: pdfPagePath(n), linear: true });
    }
    if (spine.length === 0) throw new Error('The PDF has no pages');

    let toc: TocItem[] = [];
    try {
      toc = await outlineToc(doc, (await doc.getOutline()) ?? []);
    } catch {
      // A damaged outline should not stop the book from opening.
    }

    const { info, metadata } = (await doc.getMetadata().catch(() => null)) ?? { info: {}, metadata: null };
    const fields = info as Record<string, unknown>;
    const title = metadataText(metadata?.get('dc:title')) || metadataText(fields.Title) || fileName.replace(/\.[^.]+$/, '');
    const author = metadataText(metadata?.get('dc:creator')) || metadataText(fields.Author);
    const direction = (await doc.getViewerPreferences().catch(() => null))?.get('Direction') === 'R2L' ? 'rtl' : 'ltr';

    return {
      identifier: `pdf:${doc.fingerprints[0] ?? fileName}`,
      title,
      authors: author ? author.split(/\s*;\s*/).filter(Boolean) : [],
      language: metadataText(fields.Language),
      cover: await writeCover(fs, doc),
      layout: 'pre-paginated',
      direction,
      spine,
      toc,
    };
  } finally {
    await task.destroy();
  }
}
