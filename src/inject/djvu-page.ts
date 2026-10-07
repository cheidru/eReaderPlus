/**
 * Runs inside each DjVu page document (written by src/core/djvu.ts). Decodes the page from the book's
 * original file with DjVu.js (loaded before this script as the `DjVu` global), draws it at screen
 * resolution, and lays the page's OCR text over it as transparent, selectable text.
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
    getPage(n: number): Promise<{ getImageData(): ImageData; getNormalizedTextZones(): TextZone[] | null }>;
  };
};

const LIBRARY_URL = '/__ereader__/djvu.js';

function renderPage() {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.djvu-page');
  if (!canvas) return;
  const pageNumber = Number(canvas.dataset.page);
  const source = new URL(canvas.dataset.source ?? '', location.href).href;

  const load = async () => (await fetch(source)).arrayBuffer();

  async function decodeInWorker(buffer: ArrayBuffer): Promise<DecodedPage> {
    const worker = new DjVu.Worker(new URL(LIBRARY_URL, location.href).href);
    try {
      // DjVu.js only logs worker failures, so watch for them here to fall back instead of hanging.
      const failed = new Promise<never>((_, reject) => worker.worker.addEventListener('error', () => reject(new Error('DjVu worker failed'))));
      await Promise.race([worker.createDocument(buffer), failed]);
      const [image, zones] = await Promise.race([
        worker.run(worker.doc.getPage(pageNumber).getImageData(), worker.doc.getPage(pageNumber).getNormalizedTextZones()),
        failed,
      ]);
      return { image: image as ImageData, zones: zones as TextZone[] | null };
    } finally {
      worker.terminate();
    }
  }

  async function decodeHere(buffer: ArrayBuffer): Promise<DecodedPage> {
    const page = await new DjVu.Document(buffer).getPage(pageNumber);
    return { image: page.getImageData(), zones: page.getNormalizedTextZones() };
  }

  /** Which decoder ran, recorded on the root element once the page is drawn (diagnostics and tests). */
  let decoder = 'worker';

  async function decode(): Promise<DecodedPage> {
    try {
      return await decodeInWorker(await load());
    } catch (error) {
      console.warn('Decoding the DjVu page in a worker failed, decoding on the main thread:', error);
      decoder = 'main';
      return decodeHere(await load());
    }
  }

  let image: ImageData | null = null;
  let drawn = '';
  let drawing = 0;

  /** Draws the page at the size it is displayed at, so the browser never scales a huge bitmap down. */
  async function draw() {
    if (!image) return;
    // The paginator sets the reader's zoom on top of fitting the page to the screen.
    const zoom = Number(document.documentElement.dataset.ereaderZoom) || 1;
    const fit = Math.min(innerWidth / image.width, innerHeight / image.height) * devicePixelRatio * zoom;
    const scale = Math.min(1, fit > 0 ? fit : 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const key = `${width}x${height}`;
    if (key === drawn) return;
    const token = ++drawing;
    const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    if (token !== drawing) return bitmap.close();
    canvas!.width = width;
    canvas!.height = height;
    canvas!.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    drawn = key;
  }

  function addTextLayer(zones: TextZone[]) {
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
    document.body.append(layer);
  }

  decode()
    .then(async (page) => {
      image = page.image;
      await draw();
      document.documentElement.dataset.djvuDecoder = decoder;
      if (page.zones?.length) addTextLayer(page.zones);
      addEventListener('resize', () => void draw());
      addEventListener('ereader:zoom', () => void draw());
    })
    .catch((error: unknown) => {
      const message = document.createElement('p');
      message.className = 'djvu-error';
      message.textContent = `Page ${pageNumber} could not be displayed: ${error instanceof Error ? error.message : String(error)}`;
      document.body.append(message);
    });
}

// Loaded from <head>, before the canvas exists.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderPage, { once: true });
else renderPage();
