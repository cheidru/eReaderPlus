/**
 * Runs inside each PDF page document (written by src/core/pdf.ts). Renders the page with pdf.js at the
 * size it is displayed at, adds pdf.js's selectable text layer, and turns link annotations into links
 * (other pages of the book, or external URLs, which the paginator hands to the app).
 */
import type * as PdfJs from 'pdfjs-dist';
import { CSS_PX_PER_PT, destinationPage, pdfDocumentOptions, PDFJS_MODULE, PDFJS_WORKER } from '../core/pdf-common';

type Page = PdfJs.PDFPageProxy;

const pagePath = (n: number) => `${String(n).padStart(4, '0')}.html`;

/** About 64 MB of canvas memory. */
const MAX_CANVAS_PIXELS = 4096 * 4096;

/** The reader's zoom on top of fitting the page to the screen, set by the paginator. */
const zoom = () => Number(document.documentElement.dataset.ereaderZoom) || 1;

async function renderPage() {
  let canvas = document.querySelector<HTMLCanvasElement>('canvas.pdf-page');
  if (!canvas) return;
  const pageNumber = Number(canvas.dataset.page);
  const source = new URL(canvas.dataset.source ?? '', location.href).href;

  const lib = (await import(/* @vite-ignore */ new URL(PDFJS_MODULE, location.href).href)) as typeof PdfJs;
  lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, location.href).href;
  const doc = await lib.getDocument({ url: source, ...pdfDocumentOptions() }).promise;
  const page = await doc.getPage(pageNumber);
  /** The page box in CSS px: the size of this document's viewport and of the text and link layers. */
  const box = page.getViewport({ scale: CSS_PX_PER_PT });

  let task: PdfJs.RenderTask | null = null;
  let drawn = '';

  /** Renders at the displayed resolution into a fresh canvas, swapped in when done (no blank flash). */
  async function draw() {
    const fit = Math.min(innerWidth / box.width, innerHeight / box.height) * devicePixelRatio * zoom();
    // Zoomed in, the page is drawn only as large as memory allows (the rest is upscaled).
    const max = Math.sqrt(MAX_CANVAS_PIXELS / (box.width * box.height));
    const viewport = page.getViewport({ scale: CSS_PX_PER_PT * Math.min(Math.max(fit, 0.1), max) });
    const key = `${Math.floor(viewport.width)}x${Math.floor(viewport.height)}`;
    if (key === drawn) return;
    task?.cancel();
    const target = document.createElement('canvas');
    target.className = 'pdf-page';
    target.width = Math.max(1, Math.floor(viewport.width));
    target.height = Math.max(1, Math.floor(viewport.height));
    const context = target.getContext('2d');
    if (!context) return;
    const current = page.render({ canvas: target, canvasContext: context, viewport });
    task = current;
    try {
      await current.promise;
    } catch (error) {
      if ((error as Error)?.name === 'RenderingCancelledException') return;
      throw error;
    }
    canvas!.replaceWith(target);
    canvas = target;
    drawn = key;
  }

  await draw();
  document.documentElement.dataset.pdfRendered = 'true';
  const redraw = () => void draw().catch((error: unknown) => console.warn('Re-rendering the PDF page failed:', error));
  addEventListener('resize', redraw);
  addEventListener('ereader:zoom', redraw);
  await addTextLayer(lib, page, box);
  await addLinks(lib, doc, page, box);
}

async function addTextLayer(lib: typeof PdfJs, page: Page, box: PdfJs.PageViewport) {
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  document.body.append(layer);
  await new lib.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: box }).render();
}

async function addLinks(lib: typeof PdfJs, doc: PdfJs.PDFDocumentProxy, page: Page, box: PdfJs.PageViewport) {
  const layer = document.createElement('div');
  layer.className = 'pdf-links';
  for (const annotation of await page.getAnnotations({ intent: 'display' })) {
    if (annotation.subtype !== 'Link' || !annotation.rect) continue;
    let href: string | null = null;
    if (typeof annotation.url === 'string') href = annotation.url;
    else if (annotation.dest) {
      const index = await destinationPage(doc, annotation.dest);
      if (index !== null && index < doc.numPages) href = pagePath(index + 1);
    }
    if (!href) continue;
    const [ax1, ay1, ax2, ay2] = annotation.rect as number[];
    const [x1, y1, x2, y2] = lib.Util.normalizeRect([...box.convertToViewportPoint(ax1, ay1), ...box.convertToViewportPoint(ax2, ay2)]);
    const link = document.createElement('a');
    link.href = href;
    link.style.left = `${x1}px`;
    link.style.top = `${y1}px`;
    link.style.width = `${x2 - x1}px`;
    link.style.height = `${y2 - y1}px`;
    layer.append(link);
  }
  if (layer.childElementCount > 0) document.body.append(layer);
}

function start() {
  renderPage().catch((error: unknown) => {
    const message = document.createElement('p');
    message.className = 'pdf-error';
    message.textContent = `This page could not be displayed: ${error instanceof Error ? error.message : String(error)}`;
    document.body.append(message);
  });
}

// Loaded from <head>, before the canvas exists.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
