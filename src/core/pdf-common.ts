/** pdf.js setup shared by PDF import (app) and PDF page documents (book frames). */
import type * as PdfJs from 'pdfjs-dist';

/** Where scripts/build-inject.mjs puts the pdf.js build and its data files, on every origin. */
export const PDFJS_DIR = '/__ereader__/pdfjs/';
export const PDFJS_MODULE = `${PDFJS_DIR}pdf.min.mjs`;
export const PDFJS_WORKER = `${PDFJS_DIR}pdf.worker.min.mjs`;

/** pdf.js renders 1 PDF point as 1 px at scale 1; CSS has 96 px per 72 pt. */
export const CSS_PX_PER_PT = 96 / 72;

export function pdfDocumentOptions() {
  return {
    cMapUrl: `${PDFJS_DIR}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_DIR}standard_fonts/`,
    wasmUrl: `${PDFJS_DIR}wasm/`,
    iccUrl: `${PDFJS_DIR}iccs/`,
  };
}

/** A PDF page document's file name, relative to the other page documents. */
export const pdfPageFile = (n: number) => `${String(n).padStart(4, '0')}.html`;

/** Draws pages at most this large (about 64 MB of pixels): zoomed in further, a page is upscaled. */
export const MAX_PDF_PAGE_PIXELS = 4096 * 4096;

/** pdf.js's page viewport as its TextLayer reads it, as plain data (it is sent between documents). */
export interface PdfTextViewport {
  scale: number;
  rotation: number;
  rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };
}

/** A link on a page: a page document of the book (pdfPageFile) or an external URL, over a box in the page's CSS px. */
export interface PdfLink {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfTextContent = Awaited<ReturnType<PdfJs.PDFPageProxy['getTextContent']>>;

/** What a page document lays out besides the page's image: its box in CSS px, its text for the text layer, its links. */
export interface PdfPageInfo {
  width: number;
  height: number;
  viewport: PdfTextViewport;
  text: PdfTextContent;
  links: PdfLink[];
}

/** A page drawn at `scale` device px per PDF point, with what goes over it. */
export interface PdfPageData {
  info: PdfPageInfo;
  image: ImageBitmap;
}

/** One open PDF book that draws its pages: in the app (src/core/pdf-pages.ts), or in a page document outside it. */
export interface PdfPageRenderer {
  readonly count: number;
  /** Pages are read right to left (pairs in a spread start on the right). */
  readonly rtl: boolean;
  /** Page `n` (1-based) at `scale` device px per PDF point; `signal` cancels drawing it. */
  page(n: number, scale: number, signal?: AbortSignal): Promise<PdfPageData>;
  close(): void;
}

/** Opens a PDF with pdf.js (parsed in its worker) to draw its pages. */
export async function openPdfRenderer(lib: typeof PdfJs, source: { data: Uint8Array } | { url: string }): Promise<PdfPageRenderer> {
  const task = lib.getDocument({ ...source, ...pdfDocumentOptions() });
  try {
    const doc = await task.promise;
    const rtl = (await doc.getViewerPreferences().catch(() => null))?.get('Direction') === 'R2L';
    return {
      count: doc.numPages,
      rtl,
      async page(n, scale, signal) {
        const page = await doc.getPage(n);
        const [info, image] = await Promise.all([pageInfo(lib, doc, page), drawPage(page, scale, signal)]);
        return { info, image };
      },
      close: () => void task.destroy(),
    };
  } catch (error) {
    void task.destroy();
    throw error;
  }
}

async function pageInfo(lib: typeof PdfJs, doc: PdfJs.PDFDocumentProxy, page: PdfJs.PDFPageProxy): Promise<PdfPageInfo> {
  const box = page.getViewport({ scale: CSS_PX_PER_PT });
  const { pageWidth, pageHeight, pageX, pageY } = box.rawDims as PdfTextViewport['rawDims'];
  const [text, links] = await Promise.all([page.getTextContent(), pageLinks(lib, doc, page, box)]);
  return { width: box.width, height: box.height, viewport: { scale: box.scale, rotation: box.rotation, rawDims: { pageWidth, pageHeight, pageX, pageY } }, text, links };
}

async function pageLinks(lib: typeof PdfJs, doc: PdfJs.PDFDocumentProxy, page: PdfJs.PDFPageProxy, box: PdfJs.PageViewport): Promise<PdfLink[]> {
  const links: PdfLink[] = [];
  for (const annotation of await page.getAnnotations({ intent: 'display' })) {
    if (annotation.subtype !== 'Link' || !annotation.rect) continue;
    let href: string | null = null;
    if (typeof annotation.url === 'string') href = annotation.url;
    else if (annotation.dest) {
      const index = await destinationPage(doc, annotation.dest);
      if (index !== null && index < doc.numPages) href = pdfPageFile(index + 1);
    }
    if (!href) continue;
    const [ax1, ay1, ax2, ay2] = annotation.rect as number[];
    const [x1, y1, x2, y2] = lib.Util.normalizeRect([...box.convertToViewportPoint(ax1, ay1), ...box.convertToViewportPoint(ax2, ay2)]);
    links.push({ href, x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  }
  return links;
}

/** Draws a page into a bitmap, no larger than MAX_PDF_PAGE_PIXELS. */
async function drawPage(page: PdfJs.PDFPageProxy, scale: number, signal?: AbortSignal): Promise<ImageBitmap> {
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(scale, Math.sqrt(MAX_PDF_PAGE_PIXELS / (natural.width * natural.height))) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas to draw the page on');
  signal?.throwIfAborted();
  const task = page.render({ canvas, canvasContext: context, viewport });
  const cancel = () => task.cancel();
  signal?.addEventListener('abort', cancel);
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  signal?.throwIfAborted();
  const image = await createImageBitmap(canvas);
  // Frees the canvas's pixels now rather than when it is collected.
  canvas.width = canvas.height = 0;
  return image;
}

/** Page index (0-based) of an outline or link destination, or null. */
export async function destinationPage(doc: PdfJs.PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const target = explicit[0];
    if (typeof target === 'number') return target;
    if (target && typeof target === 'object') return await doc.getPageIndex(target as Parameters<PdfJs.PDFDocumentProxy['getPageIndex']>[0]);
  } catch {
    // Broken destinations are common; they just don't link anywhere.
  }
  return null;
}
