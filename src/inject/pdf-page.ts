/**
 * Runs inside each PDF page document (written by src/core/pdf.ts). Renders the page with pdf.js at the
 * size it is displayed at, adds pdf.js's selectable text layer, and turns link annotations into links
 * (other pages of the book, or external URLs, which the paginator hands to the app).
 * In a two-page spread (the paginator sets data-ereader-spread) the next page of the PDF is shown beside it.
 */
import type * as PdfJs from 'pdfjs-dist';
import { CSS_PX_PER_PT, destinationPage, pdfDocumentOptions, PDFJS_MODULE, PDFJS_WORKER } from '../core/pdf-common';

type Page = PdfJs.PDFPageProxy;

const pagePath = (n: number) => `${String(n).padStart(4, '0')}.html`;

/** About 64 MB of canvas memory, shared by the pages shown. */
const MAX_CANVAS_PIXELS = 4096 * 4096;

const root = document.documentElement;

/** The reader's zoom on top of fitting the page to the screen, set by the paginator. */
const zoom = () => Number(root.dataset.ereaderZoom) || 1;

/** How the paginator lays this document out as two pages side by side (FixedSpread), if it does. */
const spreadMode = () => root.dataset.ereaderSpread;

/**
 * A PDF page shown in this document. Its box (CSS px, in document coordinates) is the size of the canvas
 * and of the text and link layers on top of it; `data-ereader-part` tells the paginator which page it is.
 */
interface Sheet {
  page: Page;
  box: PdfJs.PageViewport;
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  task: PdfJs.RenderTask | null;
  drawn: string;
}

function createSheet(page: Page, box: PdfJs.PageViewport, part: number): Sheet {
  const element = document.createElement('div');
  element.className = 'pdf-sheet';
  element.dataset.ereaderPart = String(part);
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
  // The text layer is sized by this (pdf_viewer.css's variable), so it lines up with a page fitted smaller.
  element.style.setProperty('--total-scale-factor', String(box.scale));
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-page';
  element.append(canvas);
  return { page, box, element, canvas, task: null, drawn: '' };
}

/**
 * Renders a page at `scale` screen px per document px into a fresh canvas, swapped in when done (no blank
 * flash). Zoomed in, the page is drawn only as large as `maxPixels` allows (the rest is upscaled).
 */
async function draw(sheet: Sheet, scale: number, maxPixels: number) {
  const max = Math.sqrt(maxPixels / (sheet.box.width * sheet.box.height));
  const viewport = sheet.page.getViewport({ scale: sheet.box.scale * Math.min(Math.max(scale, 0.1), max) });
  const key = `${Math.floor(viewport.width)}x${Math.floor(viewport.height)}`;
  if (key === sheet.drawn) return;
  sheet.task?.cancel();
  const target = document.createElement('canvas');
  target.className = 'pdf-page';
  target.width = Math.max(1, Math.floor(viewport.width));
  target.height = Math.max(1, Math.floor(viewport.height));
  const context = target.getContext('2d');
  if (!context) return;
  const current = sheet.page.render({ canvas: target, canvasContext: context, viewport });
  sheet.task = current;
  try {
    await current.promise;
  } catch (error) {
    if ((error as Error)?.name === 'RenderingCancelledException') return;
    throw error;
  }
  sheet.canvas.replaceWith(target);
  sheet.canvas = target;
  sheet.drawn = key;
}

async function renderPage() {
  const original = document.querySelector<HTMLCanvasElement>('canvas.pdf-page');
  if (!original) return;
  const pageNumber = Number(original.dataset.page);
  const source = new URL(original.dataset.source ?? '', location.href).href;

  const lib = (await import(/* @vite-ignore */ new URL(PDFJS_MODULE, location.href).href)) as typeof PdfJs;
  lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, location.href).href;
  const doc = await lib.getDocument({ url: source, ...pdfDocumentOptions() }).promise;
  const page = await doc.getPage(pageNumber);
  /** The page box in CSS px: the size of this document's viewport, and of each half of a spread. */
  const box = page.getViewport({ scale: CSS_PX_PER_PT });
  const rtl = (await doc.getViewerPreferences().catch(() => null))?.get('Direction') === 'R2L';

  const main = createSheet(page, box, 0);
  original.replaceWith(main.element);
  /** The next page, while a spread shows it. */
  let next: Sheet | null = null;

  function drawAll() {
    const sheets = next ? [main, next] : [main];
    const scale = Math.min(innerWidth / (box.width * (spreadMode() ? 2 : 1)), innerHeight / box.height) * devicePixelRatio * zoom();
    return Promise.all(sheets.map((sheet) => draw(sheet, scale, MAX_CANVAS_PIXELS / sheets.length)));
  }

  /**
   * Places this page in its half of a pair and shows or hides the next page beside it: the first page of a
   * pair is on the left (on the right in a right-to-left book). A page alone fills the box (the paginator centers it).
   */
  async function updateSpread() {
    const mode = spreadMode();
    const on = mode === 'pair' && pageNumber < doc.numPages;
    main.element.style.left = mode === 'pair' && rtl ? `${box.width}px` : '0';
    let added: Sheet | null = null;
    if (on && !next) {
      const nextPage = await doc.getPage(pageNumber + 1);
      const natural = nextPage.getViewport({ scale: CSS_PX_PER_PT });
      // A page of another size is fitted into the same box, centered.
      const fitted = nextPage.getViewport({ scale: CSS_PX_PER_PT * Math.min(box.width / natural.width, box.height / natural.height) });
      added = next = createSheet(nextPage, fitted, 1);
      next.element.style.left = `${(rtl ? 0 : box.width) + (box.width - fitted.width) / 2}px`;
      next.element.style.top = `${(box.height - fitted.height) / 2}px`;
      document.body.append(next.element);
    } else if (!on && next) {
      next.task?.cancel();
      next.element.remove();
      next = null;
    }
    await drawAll();
    if (added) await addLayers(lib, doc, added);
  }

  await drawAll();
  root.dataset.pdfRendered = 'true';
  const warn = (error: unknown) => console.warn('Re-rendering the PDF page failed:', error);
  const redraw = () => void drawAll().catch(warn);
  addEventListener('resize', redraw);
  addEventListener('ereader:zoom', redraw);
  // One change at a time, so turning the spread off and on again quickly can't add the next page twice.
  let spreadChange = Promise.resolve();
  const onSpread = () => (spreadChange = spreadChange.then(updateSpread).catch(warn));
  addEventListener('ereader:spread', onSpread);
  if (spreadMode()) onSpread();
  await addLayers(lib, doc, main);
}

async function addLayers(lib: typeof PdfJs, doc: PdfJs.PDFDocumentProxy, sheet: Sheet) {
  await addTextLayer(lib, sheet);
  await addLinks(lib, doc, sheet);
}

async function addTextLayer(lib: typeof PdfJs, { page, box, element }: Sheet) {
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  element.append(layer);
  await new lib.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: box }).render();
}

async function addLinks(lib: typeof PdfJs, doc: PdfJs.PDFDocumentProxy, { page, box, element }: Sheet) {
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
  if (layer.childElementCount > 0) element.append(layer);
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
