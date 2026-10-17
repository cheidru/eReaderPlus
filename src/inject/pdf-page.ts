/**
 * Runs inside each PDF page document (written by src/core/pdf.ts). Gets its page drawn by the app, which keeps the
 * open book and draws pages ahead of the reader (src/core/pdf-pages.ts); outside the app, or if the app can't, opens
 * the book's PDF with pdf.js itself. Shows the page at the size it is displayed at, adds pdf.js's selectable text
 * layer, and turns link annotations into links (other pages of the book, or external URLs, which the paginator hands
 * to the app).
 * In a two-page spread (the paginator sets data-ereader-spread) the next page of the PDF is shown beside it.
 */
import type * as PdfJs from 'pdfjs-dist';
import { MESSAGE_TAG, type HostMessage } from '../core/messages';
import { CSS_PX_PER_PT, MAX_PDF_PAGE_PIXELS, openPdfRenderer, PDFJS_MODULE, PDFJS_WORKER, type PdfPageData, type PdfPageInfo, type PdfPageRenderer } from '../core/pdf-common';

const root = document.documentElement;

/** The reader's zoom on top of fitting the page to the screen, set by the paginator. */
const zoom = () => Number(root.dataset.ereaderZoom) || 1;

/** How the paginator lays this document out as two pages side by side (FixedSpread), if it does. */
const spreadMode = () => root.dataset.ereaderSpread;

let library: Promise<typeof PdfJs> | null = null;

/** pdf.js, for the text layer, and to draw pages here when the app doesn't. */
function loadLibrary(): Promise<typeof PdfJs> {
  library ??= (import(/* @vite-ignore */ new URL(PDFJS_MODULE, location.href).href) as Promise<typeof PdfJs>).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, location.href).href;
    return lib;
  });
  return library;
}

/** How long to wait for the app before drawing here: it answers at once, or once it has read and parsed the book. */
const APP_TIMEOUT_MS = 30000;

interface AppAnswer {
  count: number;
  rtl: boolean;
  data: PdfPageData | null;
}

/** Asks the app for page `n` drawn at `scale`. Null when there is no app, or it can't draw the book. */
function pageFromApp(n: number, scale: number): Promise<AppAnswer | null> {
  if (window.parent === window) return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = (answer: AppAnswer | null) => {
      removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(answer);
    };
    // The app answers every page document shown in this frame: keep the answer to this request only.
    const onMessage = (event: MessageEvent) => {
      const message = event.data as HostMessage;
      if (event.source !== window.parent || typeof message !== 'object' || message === null) return;
      if (message.tag !== MESSAGE_TAG || message.type !== 'pdfPage' || message.page !== n || message.scale !== scale) return;
      if (!message.count) return finish(null);
      finish({ count: message.count, rtl: message.rtl, data: message.data?.image instanceof ImageBitmap ? message.data : null });
    };
    const timer = setTimeout(() => finish(null), APP_TIMEOUT_MS);
    addEventListener('message', onMessage);
    window.parent.postMessage({ tag: MESSAGE_TAG, type: 'pdfPage', page: n, scale }, '*');
  });
}

/** The book's pages, drawn by the app, or here once the app can't. */
const book = {
  count: 0,
  rtl: false,
  local: null as Promise<PdfPageRenderer> | null,
  /** Which drew the pages ('app' or 'here'), recorded on the root element once the page is shown (diagnostics and tests). */
  drawer: 'app',

  /** Page `n` at `scale` device px per PDF point; null past the last page, or when the app drew it at a newer scale instead. */
  async page(source: string, n: number, scale: number, signal: AbortSignal): Promise<PdfPageData | null> {
    if (!this.local) {
      const answer = await pageFromApp(n, scale);
      if (answer) {
        this.count = answer.count;
        this.rtl = answer.rtl;
        return answer.data;
      }
      this.drawer = 'here';
      this.local = loadLibrary().then((lib) => openPdfRenderer(lib, { url: source }));
    }
    const renderer = await this.local;
    this.count = renderer.count;
    this.rtl = renderer.rtl;
    return n > renderer.count ? null : renderer.page(n, scale, signal);
  },
};

/**
 * A PDF page shown in this document. Its box (CSS px, in document coordinates) is the size of the canvas and of the
 * text and link layers on top of it: its page's box scaled by `fit` (1 for this document's own page, which sets the
 * box; the next page in a spread is fitted into it). `data-ereader-part` tells the paginator which page it is.
 */
interface Sheet {
  page: number;
  info: PdfPageInfo;
  fit: number;
  width: number;
  height: number;
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The scale it is drawn at, and the latest drawing asked for. */
  drawn: number;
  drawing: AbortController | null;
}

function createSheet(page: number, info: PdfPageInfo, fit: number, part: number): Sheet {
  const width = info.width * fit;
  const height = info.height * fit;
  const element = document.createElement('div');
  element.className = 'pdf-sheet';
  element.dataset.ereaderPart = String(part);
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  // The text layer is sized by this (pdf_viewer.css's variable), so it lines up with a page fitted smaller.
  element.style.setProperty('--total-scale-factor', String(info.viewport.scale * fit));
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-page';
  element.append(canvas);
  return { page, info, fit, width, height, element, canvas, drawn: 0, drawing: null };
}

/** Shows a page's image (drawn at the size it is displayed at, so the browser never scales a huge bitmap down). */
function paint(sheet: Sheet, image: ImageBitmap, scale: number) {
  sheet.canvas.width = image.width;
  sheet.canvas.height = image.height;
  sheet.canvas.getContext('2d')?.drawImage(image, 0, 0);
  image.close();
  sheet.drawn = scale;
}

/** The scale to draw a page box of `width`×`height` CSS px at, shown `fit` screen px per CSS px, within `maxPixels`. */
function drawScale(width: number, height: number, fit: number, maxPixels: number): number {
  return CSS_PX_PER_PT * Math.min(Math.max(fit, 0.1), Math.sqrt(maxPixels / (width * height)));
}

/** This document's page box, from its viewport (written with the page's size), until the page itself is known. */
function viewportBox(): { width: number; height: number } {
  const content = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? '';
  const size = (name: string) => Number(new RegExp(`${name}=(\\d+)`).exec(content)?.[1]) || 1000;
  return { width: size('width'), height: size('height') };
}

async function renderPage() {
  const original = document.querySelector<HTMLCanvasElement>('canvas.pdf-page');
  if (!original) return;
  const pageNumber = Number(original.dataset.page);
  const source = new URL(original.dataset.source ?? '', location.href).href;

  /** Screen px per CSS px of this document's page box, as the paginator fits it (two of them in a spread). */
  const screenFit = (box: { width: number; height: number }) =>
    Math.min(innerWidth / (box.width * (spreadMode() ? 2 : 1)), innerHeight / box.height) * devicePixelRatio * zoom();

  const initial = viewportBox();
  const firstScale = drawScale(initial.width, initial.height, screenFit(initial), MAX_PDF_PAGE_PIXELS / (spreadMode() === 'pair' ? 2 : 1));
  const first = await book.page(source, pageNumber, firstScale, new AbortController().signal);
  if (!first) throw new Error('The page is missing from the book');
  const main = createSheet(pageNumber, first.info, 1, 0);
  paint(main, first.image, firstScale);
  original.replaceWith(main.element);
  /** The page box: this document's own page, and each half of a spread. */
  const box = { width: main.width, height: main.height };
  /** The next page, while a spread shows it. */
  let next: Sheet | null = null;

  /** Draws a sheet again at the scale it is now shown at, unless it already is. */
  async function redrawSheet(sheet: Sheet, scale: number) {
    if (sheet.drawn && Math.abs(scale - sheet.drawn) <= 0.01 * scale) return;
    sheet.drawing?.abort();
    const drawing = (sheet.drawing = new AbortController());
    try {
      const page = await book.page(source, sheet.page, scale, drawing.signal);
      if (!page) return;
      if (drawing.signal.aborted) return page.image.close();
      paint(sheet, page.image, scale);
    } catch (error) {
      if (!drawing.signal.aborted && (error as Error)?.name !== 'RenderingCancelledException') throw error;
    }
  }

  function drawAll() {
    const sheets = next ? [main, next] : [main];
    const fit = screenFit(box);
    return Promise.all(sheets.map((sheet) => redrawSheet(sheet, drawScale(sheet.width, sheet.height, fit, MAX_PDF_PAGE_PIXELS / sheets.length) * sheet.fit)));
  }

  /**
   * Places this page in its half of a pair and shows or hides the next page beside it: the first page of a
   * pair is on the left (on the right in a right-to-left book). A page alone fills the box (the paginator centers it).
   */
  async function updateSpread() {
    const mode = spreadMode();
    const on = mode === 'pair' && pageNumber < book.count;
    main.element.style.left = mode === 'pair' && book.rtl ? `${box.width}px` : '0';
    let added: Sheet | null = null;
    if (on && !next) {
      const sheets = 2;
      const scale = drawScale(box.width, box.height, screenFit(box), MAX_PDF_PAGE_PIXELS / sheets);
      const page = await book.page(source, pageNumber + 1, scale, new AbortController().signal);
      // The spread may have been turned off while the page was drawn.
      if (page && spreadMode() === 'pair' && !next) {
        // A page of another size is fitted into the same box, centered.
        const fit = Math.min(box.width / page.info.width, box.height / page.info.height);
        added = next = createSheet(pageNumber + 1, page.info, fit, 1);
        // Drawn again below if fitting it made it smaller.
        paint(next, page.image, scale);
        next.element.style.left = `${(book.rtl ? 0 : box.width) + (box.width - next.width) / 2}px`;
        next.element.style.top = `${(box.height - next.height) / 2}px`;
        document.body.append(next.element);
      } else page?.image.close();
    } else if (!on && next) {
      next.drawing?.abort();
      next.element.remove();
      next = null;
    }
    await drawAll();
    if (added) await addLayers(added);
  }

  root.dataset.pdfRendered = 'true';
  root.dataset.pdfDrawer = book.drawer;
  const warn = (error: unknown) => console.warn('Re-rendering the PDF page failed:', error);
  const redraw = () => void drawAll().catch(warn);
  addEventListener('resize', redraw);
  addEventListener('ereader:zoom', redraw);
  // One change at a time, so turning the spread off and on again quickly can't add the next page twice.
  let spreadChange = Promise.resolve();
  const onSpread = () => (spreadChange = spreadChange.then(updateSpread).catch(warn));
  addEventListener('ereader:spread', onSpread);
  if (spreadMode()) onSpread();
  // A page drawn at the scale of the page box read from the viewport is drawn again if that was not quite it.
  redraw();
  await addLayers(main);
}

async function addLayers(sheet: Sheet) {
  await addTextLayer(sheet);
  addLinks(sheet);
}

async function addTextLayer({ info, fit, element }: Sheet) {
  const lib = await loadLibrary();
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  element.append(layer);
  // The TextLayer reads only these of the viewport; a plain copy came from the app.
  const viewport = { ...info.viewport, scale: info.viewport.scale * fit } as unknown as PdfJs.PageViewport;
  await new lib.TextLayer({ textContentSource: info.text, container: layer, viewport }).render();
}

function addLinks({ info, fit, element }: Sheet) {
  const layer = document.createElement('div');
  layer.className = 'pdf-links';
  for (const { href, x, y, width, height } of info.links) {
    const link = document.createElement('a');
    link.href = href;
    link.style.left = `${x * fit}px`;
    link.style.top = `${y * fit}px`;
    link.style.width = `${width * fit}px`;
    link.style.height = `${height * fit}px`;
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
