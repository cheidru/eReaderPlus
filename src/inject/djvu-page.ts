/**
 * Runs inside each DjVu page document (written by src/core/djvu.ts). Gets its page decoded from the app, which keeps
 * the open book in memory and decodes pages ahead of the reader (src/core/djvu-pages.ts); outside the app, or if the
 * app can't, decodes the page from the book's original file with DjVu.js itself. Draws the page at screen
 * resolution and lays the page's OCR text over it as transparent, selectable text.
 * In a two-page spread (the paginator sets data-ereader-spread) the next page of the book is shown beside it.
 */
import { MESSAGE_TAG, type DjvuPageData, type DjvuTextZone, type HostMessage } from '../core/messages';

interface DjvuTask {
  getPagesQuantity(): DjvuTask;
  getPage(n: number): DjvuTask;
  getImageData(): DjvuTask;
  getNormalizedTextZones(): DjvuTask;
}

declare const DjVu: {
  Worker: new (url: string) => {
    worker: Worker;
    doc: DjvuTask;
    createDocument(buffer: ArrayBuffer): Promise<void>;
    run(...tasks: DjvuTask[]): Promise<unknown[]>;
    terminate(): void;
  };
  Document: new (buffer: ArrayBuffer) => {
    getPagesQuantity(): number;
    getPage(n: number): Promise<{ getImageData(): ImageData; getNormalizedTextZones(): DjvuTextZone[] | null }>;
  };
};

const LIBRARY_URL = '/__ereader__/djvu.js';

const root = document.documentElement;

/** How the paginator lays this document out as two pages side by side (FixedSpread), if it does. */
const spreadMode = () => root.dataset.ereaderSpread;

/** The pages decoded, and how many pages the book has. */
interface Decoded {
  count: number;
  pages: DjvuPageData[];
}

/** Which decoder ran ('app', 'worker' or 'main'), recorded on the root element once the page is drawn (diagnostics and tests). */
let decoder = 'app';

/** How long to wait for the app before decoding here: it answers at once, or once it has read and parsed the book. */
const APP_TIMEOUT_MS = 30000;

/**
 * Asks the app for pages `numbers`, those past the end of the book left out, scaled to the screen or `full` resolution.
 * Null when the app can't decode the book.
 */
function pagesFromApp(numbers: number[], full: boolean): Promise<Decoded | null> {
  if (window.parent === window) return Promise.resolve(null);
  return new Promise((resolve) => {
    const answers = new Map<number, DjvuPageData | null>();
    const finish = (result: Decoded | null) => {
      removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(result);
    };
    // The app answers every page document shown in this frame: keep the answers to this request only.
    const onMessage = (event: MessageEvent) => {
      const message = event.data as HostMessage;
      if (event.source !== window.parent || typeof message !== 'object' || message === null) return;
      if (message.tag !== MESSAGE_TAG || message.type !== 'djvuPage' || message.full !== full || !numbers.includes(message.page)) return;
      if (!message.count) return finish(null);
      answers.set(message.page, message.data?.image instanceof ImageData ? message.data : null);
      if (answers.size < numbers.length) return;
      finish({ count: message.count, pages: numbers.flatMap((n) => answers.get(n) ?? []) });
    };
    const timer = setTimeout(() => finish(null), APP_TIMEOUT_MS);
    addEventListener('message', onMessage);
    for (const page of numbers) window.parent.postMessage({ tag: MESSAGE_TAG, type: 'djvuPage', page, full }, '*');
  });
}

let library: Promise<void> | null = null;

/** Loads DjVu.js (the `DjVu` global), which page documents written by older versions load from <head>. */
function loadLibrary(): Promise<void> {
  if (typeof DjVu !== 'undefined') return Promise.resolve();
  library ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LIBRARY_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('The DjVu library could not be loaded'));
    document.head.append(script);
  });
  return library;
}

/** A page decoded here, at full resolution. */
const decoded = (image: ImageData, zones: DjvuTextZone[] | null): DjvuPageData => ({ width: image.width, height: image.height, image, zones });

async function decodeInWorker(buffer: ArrayBuffer, numbers: number[]): Promise<Decoded> {
  const worker = new DjVu.Worker(new URL(LIBRARY_URL, location.href).href);
  try {
    // DjVu.js only logs worker failures, so watch for them here to fall back instead of hanging.
    const failed = new Promise<never>((_, reject) => worker.worker.addEventListener('error', () => reject(new Error('DjVu worker failed'))));
    // DjVu.js returns the result of a single task by itself, and an array for several.
    const run = async (...tasks: DjvuTask[]) => {
      const results = await Promise.race([worker.run(...tasks), failed]);
      return tasks.length === 1 ? [results as unknown] : results;
    };
    await Promise.race([worker.createDocument(buffer), failed]);
    const [count] = (await run(worker.doc.getPagesQuantity())) as [number];
    const wanted = numbers.filter((n) => n <= count);
    const results = await run(...wanted.flatMap((n) => [worker.doc.getPage(n).getImageData(), worker.doc.getPage(n).getNormalizedTextZones()]));
    return { count, pages: wanted.map((_, i) => decoded(results[2 * i] as ImageData, results[2 * i + 1] as DjvuTextZone[] | null)) };
  } finally {
    worker.terminate();
  }
}

async function decodeHere(buffer: ArrayBuffer, numbers: number[]): Promise<Decoded> {
  const doc = new DjVu.Document(buffer);
  const count = doc.getPagesQuantity();
  const pages: DjvuPageData[] = [];
  for (const n of numbers.filter((n) => n <= count)) {
    const page = await doc.getPage(n);
    pages.push(decoded(page.getImageData(), page.getNormalizedTextZones()));
  }
  return { count, pages };
}

/**
 * Decodes pages `numbers` (those past the end of the book are left out): by the app, or here from the book's file.
 * The app's pages are scaled to the screen unless `full` resolution is asked for; pages decoded here are always full.
 */
async function decodePages(source: string, numbers: number[], full = false): Promise<Decoded> {
  const fromApp = await pagesFromApp(numbers, full);
  if (fromApp) {
    decoder = 'app';
    return fromApp;
  }
  await loadLibrary();
  const load = async () => (await fetch(source)).arrayBuffer();
  try {
    decoder = 'worker';
    return await decodeInWorker(await load(), numbers);
  } catch (error) {
    console.warn('Decoding the DjVu page in a worker failed, decoding on the main thread:', error);
    decoder = 'main';
    return decodeHere(await load(), numbers);
  }
}

/**
 * A page shown in this document: book page `page`, laid out in its own pixels (`width`×`height`) with its OCR text,
 * scaled by `scale` to fit this document's page box (1 for its own page). Its image may be smaller than the page
 * (the app keeps pages scaled to the screen) until zooming in needs more. `data-ereader-part` tells the paginator
 * which page it is.
 */
interface Sheet {
  page: number;
  width: number;
  height: number;
  image: ImageData;
  scale: number;
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  drawn: string;
  drawing: number;
  /** The `fit` it was last drawn at. */
  fit: number;
  /** Set while the full-resolution image is being fetched. */
  sharpening: boolean;
}

function createSheet({ width, height, image, zones }: DjvuPageData, page: number, part: number, scale: number): Sheet {
  const element = document.createElement('div');
  element.className = 'djvu-sheet';
  element.dataset.ereaderPart = String(part);
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  if (scale !== 1) element.style.transform = `scale(${scale})`;
  const canvas = document.createElement('canvas');
  canvas.className = 'djvu-page';
  element.append(canvas);
  if (zones?.length) element.append(textLayer(zones));
  return { page, width, height, image, scale, element, canvas, drawn: '', drawing: 0, fit: 0, sharpening: false };
}

function textLayer(zones: DjvuTextZone[]): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'djvu-text';
  const measure = document.createElement('canvas').getContext('2d');
  for (const zone of zones) {
    if (!zone.text.trim() || zone.height <= 0) continue;
    const span = document.createElement('span');
    span.textContent = zone.text;
    span.style.left = `${zone.x}px`;
    span.style.top = `${zone.y}px`;
    span.style.fontSize = `${zone.height}px`;
    if (measure) {
      measure.font = `${zone.height}px sans-serif`;
      const natural = measure.measureText(zone.text).width;
      if (natural > 0) span.style.transform = `scaleX(${zone.width / natural})`;
    }
    layer.append(span);
  }
  return layer;
}

/** A page shown larger than its image by more than this asks for the image at full resolution. */
const SHARPEN_ABOVE = 1.1;

/**
 * Draws a page at the size it is displayed at (`fit` screen px per page box px), so the browser never scales a huge
 * bitmap down. When that is larger than the image the app sent, draws it anyway and asks for the full resolution.
 */
async function draw(sheet: Sheet, fit: number, source: string) {
  sheet.fit = fit;
  const scale = Math.min(1, fit > 0 ? fit * sheet.scale : 1);
  const width = Math.max(1, Math.round(sheet.width * scale));
  const height = Math.max(1, Math.round(sheet.height * scale));
  if (width > sheet.image.width * SHARPEN_ABOVE) void sharpen(sheet, source);
  const key = `${width}x${height}`;
  if (key === sheet.drawn) return;
  const token = ++sheet.drawing;
  const bitmap = await createImageBitmap(sheet.image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  if (token !== sheet.drawing) return bitmap.close();
  sheet.canvas.width = width;
  sheet.canvas.height = height;
  sheet.canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  sheet.drawn = key;
}

/** Replaces a sheet's image with the page at full resolution, and redraws it. */
async function sharpen(sheet: Sheet, source: string) {
  if (sheet.sharpening) return;
  sheet.sharpening = true;
  try {
    const page = (await decodePages(source, [sheet.page], true)).pages[0];
    if (!page) return;
    sheet.image = page.image;
    sheet.drawn = '';
    await draw(sheet, sheet.fit, source);
  } catch (error) {
    console.warn(`Page ${sheet.page} could not be decoded at full resolution:`, error);
  }
}

async function renderPage() {
  const original = document.querySelector<HTMLCanvasElement>('canvas.djvu-page');
  if (!original) return;
  const pageNumber = Number(original.dataset.page);
  const source = new URL(original.dataset.source ?? '', location.href).href;

  // A spread shown from the start decodes both pages at once.
  const first = await decodePages(source, spreadMode() === 'pair' ? [pageNumber, pageNumber + 1] : [pageNumber]);
  const { count } = first;
  const main = createSheet(first.pages[0], pageNumber, 0, 1);
  original.replaceWith(main.element);
  /** This document's page box: its own page, and each half of a spread. */
  const box = { width: main.width, height: main.height };
  /** The next page, while a spread shows it. */
  let next: Sheet | null = null;
  let decodedNext: DjvuPageData | null = first.pages[1] ?? null;

  function drawAll() {
    // The paginator sets the reader's zoom on top of fitting the page (or two) to the screen.
    const zoom = Number(root.dataset.ereaderZoom) || 1;
    const fit = Math.min(innerWidth / (box.width * (spreadMode() ? 2 : 1)), innerHeight / box.height) * devicePixelRatio * zoom;
    return Promise.all((next ? [main, next] : [main]).map((sheet) => draw(sheet, fit, source)));
  }

  const warn = (error: unknown) => console.warn('Showing the next DjVu page failed:', error);

  /** Shows or hides the next page beside this one (on the right): a page of another size is fitted into the same box, centered. */
  async function updateSpread() {
    const wanted = () => spreadMode() === 'pair' && pageNumber < count;
    if (wanted() && !next) {
      decodedNext ??= await decodePages(source, [pageNumber + 1]).then(
        (decoded) => decoded.pages[0] ?? null,
        (error: unknown) => {
          warn(error);
          return null;
        },
      );
      // The spread may have been turned off while the page decoded.
      if (decodedNext && wanted()) {
        const { width, height } = decodedNext;
        const scale = Math.min(box.width / width, box.height / height);
        next = createSheet(decodedNext, pageNumber + 1, 1, scale);
        next.element.style.left = `${box.width + (box.width - width * scale) / 2}px`;
        next.element.style.top = `${(box.height - height * scale) / 2}px`;
        document.body.append(next.element);
      }
    } else if (!wanted() && next) {
      next.element.remove();
      next = null;
    }
    await drawAll();
  }

  // One change at a time, so turning the spread off and on again quickly can't add the next page twice.
  let spreadChange = Promise.resolve();
  const onSpread = () => (spreadChange = spreadChange.then(updateSpread).catch(warn));
  addEventListener('ereader:spread', onSpread);
  onSpread();
  await spreadChange;
  root.dataset.djvuDecoder = decoder;
  const redraw = () => void drawAll();
  addEventListener('resize', redraw);
  addEventListener('ereader:zoom', redraw);
}

function start() {
  renderPage().catch((error: unknown) => {
    const page = document.querySelector<HTMLCanvasElement>('canvas.djvu-page')?.dataset.page;
    const message = document.createElement('p');
    message.className = 'djvu-error';
    message.textContent = `Page ${page ?? ''} could not be displayed: ${error instanceof Error ? error.message : String(error)}`;
    document.body.append(message);
  });
}

// Loaded from <head>, before the canvas exists.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
