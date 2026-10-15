/**
 * Runs inside each DjVu page document (written by src/core/djvu.ts). Decodes the page from the book's
 * original file with DjVu.js (loaded before this script as the `DjVu` global), draws it at screen
 * resolution, and lays the page's OCR text over it as transparent, selectable text.
 * In a two-page spread (the paginator sets data-ereader-spread) the next page of the book is shown beside it.
 */

interface TextZone {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface DecodedPage {
  image: ImageData;
  zones: TextZone[] | null;
}

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
    getPage(n: number): Promise<{ getImageData(): ImageData; getNormalizedTextZones(): TextZone[] | null }>;
  };
};

const LIBRARY_URL = '/__ereader__/djvu.js';

const root = document.documentElement;

/** How the paginator lays this document out as two pages side by side (FixedSpread), if it does. */
const spreadMode = () => root.dataset.ereaderSpread;

/** The pages decoded, and how many pages the book has. */
interface Decoded {
  count: number;
  pages: DecodedPage[];
}

/** Which decoder ran, recorded on the root element once the page is drawn (diagnostics and tests). */
let decoder = 'worker';

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
    return { count, pages: wanted.map((_, i) => ({ image: results[2 * i] as ImageData, zones: results[2 * i + 1] as TextZone[] | null })) };
  } finally {
    worker.terminate();
  }
}

async function decodeHere(buffer: ArrayBuffer, numbers: number[]): Promise<Decoded> {
  const doc = new DjVu.Document(buffer);
  const count = doc.getPagesQuantity();
  const pages: DecodedPage[] = [];
  for (const n of numbers.filter((n) => n <= count)) {
    const page = await doc.getPage(n);
    pages.push({ image: page.getImageData(), zones: page.getNormalizedTextZones() });
  }
  return { count, pages };
}

/** Decodes pages `numbers` (those past the end of the book are left out) from the book's file. */
async function decodePages(source: string, numbers: number[]): Promise<Decoded> {
  const load = async () => (await fetch(source)).arrayBuffer();
  try {
    return await decodeInWorker(await load(), numbers);
  } catch (error) {
    console.warn('Decoding the DjVu page in a worker failed, decoding on the main thread:', error);
    decoder = 'main';
    return decodeHere(await load(), numbers);
  }
}

/**
 * A page shown in this document: its image and OCR text in the page's own pixels, scaled by `scale` to fit
 * this document's page box (1 for its own page). `data-ereader-part` tells the paginator which page it is.
 */
interface Sheet {
  image: ImageData;
  scale: number;
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  drawn: string;
  drawing: number;
}

function createSheet({ image, zones }: DecodedPage, part: number, scale: number): Sheet {
  const element = document.createElement('div');
  element.className = 'djvu-sheet';
  element.dataset.ereaderPart = String(part);
  element.style.width = `${image.width}px`;
  element.style.height = `${image.height}px`;
  if (scale !== 1) element.style.transform = `scale(${scale})`;
  const canvas = document.createElement('canvas');
  canvas.className = 'djvu-page';
  element.append(canvas);
  if (zones?.length) element.append(textLayer(zones));
  return { image, scale, element, canvas, drawn: '', drawing: 0 };
}

function textLayer(zones: TextZone[]): HTMLElement {
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

/** Draws a page at the size it is displayed at (`fit` screen px per page box px), so the browser never scales a huge bitmap down. */
async function draw(sheet: Sheet, fit: number) {
  const scale = Math.min(1, fit > 0 ? fit * sheet.scale : 1);
  const width = Math.max(1, Math.round(sheet.image.width * scale));
  const height = Math.max(1, Math.round(sheet.image.height * scale));
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

async function renderPage() {
  const original = document.querySelector<HTMLCanvasElement>('canvas.djvu-page');
  if (!original) return;
  const pageNumber = Number(original.dataset.page);
  const source = new URL(original.dataset.source ?? '', location.href).href;

  // A spread shown from the start decodes both pages at once.
  const first = await decodePages(source, spreadMode() === 'pair' ? [pageNumber, pageNumber + 1] : [pageNumber]);
  const { count } = first;
  const main = createSheet(first.pages[0], 0, 1);
  original.replaceWith(main.element);
  /** This document's page box: its own page, and each half of a spread. */
  const box = { width: main.image.width, height: main.image.height };
  /** The next page, while a spread shows it. */
  let next: Sheet | null = null;
  let decodedNext: DecodedPage | null = first.pages[1] ?? null;

  function drawAll() {
    // The paginator sets the reader's zoom on top of fitting the page (or two) to the screen.
    const zoom = Number(root.dataset.ereaderZoom) || 1;
    const fit = Math.min(innerWidth / (box.width * (spreadMode() ? 2 : 1)), innerHeight / box.height) * devicePixelRatio * zoom;
    return Promise.all((next ? [main, next] : [main]).map((sheet) => draw(sheet, fit)));
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
        const { width, height } = decodedNext.image;
        const scale = Math.min(box.width / width, box.height / height);
        next = createSheet(decodedNext, 1, scale);
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
