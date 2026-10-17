/**
 * Keeps the DjVu book being read in memory, so that turning a page shows it at once. When the book opens, its file
 * is read once and parsed in a few Web Workers that live until the book is closed (decoding a scanned page takes
 * most of a second, so several decode side by side). They decode pages in the background: the pages asked for first,
 * then outward from the reader's position (three pages forward for each one back), keeping as many as the memory
 * budget allows — a small book entirely, a large one around the reader.
 * Pages are kept scaled down to what the screen can show (scans are often 600 dpi: 70 MB a page at full size);
 * a page document asks for the full resolution when the reader zooms in.
 * Page documents ask for their pages through the app (`djvuPage` messages, see src/inject/djvu-page.ts).
 */
import type { DjvuLibrary } from './djvu';
import { READER_ASSETS_PREFIX } from './inject';
import type { DjvuPageData } from './messages';

/** Decodes the pages of one open book, at full resolution. */
export interface DjvuPageDecoder {
  readonly count: number;
  /** How many pages it decodes at once (it may grow while more workers start). */
  readonly parallel: number;
  /** Settles when `parallel` has grown as far as it will. */
  readonly started?: Promise<void>;
  decode(page: number): Promise<DjvuPageData>;
  close(): void;
}

/** Workers to decode with: up to one for each two processor cores, fewer on a device with little memory. */
export function djvuWorkerCount(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const gigabytes = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  return Math.max(1, Math.min(Math.floor(cores / 2), gigabytes >= 4 ? 4 : 2));
}

/** Bytes of decoded pages to keep (DjVu, and PDF pages drawn ahead): a share of the device's memory, as far as the browser tells it. */
export function pageMemoryBudget(): number {
  const gigabytes = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  return Math.min(1024, Math.max(192, gigabytes * 64)) * 2 ** 20;
}

interface BookWorker {
  count: number;
  decode(page: number): Promise<DjvuPageData>;
  terminate(): void;
}

/** A DjVu.js worker with its own copy of the book's file, parsed. */
async function startWorker(lib: DjvuLibrary, bytes: Uint8Array): Promise<BookWorker> {
  const worker = new lib.Worker(new URL(`${READER_ASSETS_PREFIX}djvu.js`, location.href).href);
  // DjVu.js only logs worker failures, so watch for them here to fail instead of hanging.
  const failed = new Promise<never>((_, reject) => worker.worker.addEventListener('error', () => reject(new Error('The DjVu worker failed'))));
  failed.catch(() => {});
  const run = <T>(work: Promise<unknown>) => Promise.race([work, failed]) as Promise<T>;
  try {
    await run(worker.createDocument(bytes.slice().buffer));
    return {
      count: await run<number>(worker.run(worker.doc.getPagesQuantity())),
      async decode(page) {
        // DjVu.js returns the results of several tasks as an array.
        const [image, zones] = await run<[ImageData, DjvuPageData['zones']]>(
          worker.run(worker.doc.getPage(page).getImageData(), worker.doc.getPage(page).getNormalizedTextZones()),
        );
        return { width: image.width, height: image.height, image, zones };
      },
      terminate: () => worker.terminate(),
    };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

/**
 * Reads the book's DjVu file and parses it in `workers` DjVu.js workers, each decoding one page at a time. The first
 * one opens the book; the others start meanwhile, and only add speed: one that fails to start is left out.
 */
export async function openDjvuWorkers(lib: DjvuLibrary, read: () => Promise<Uint8Array>, workers = djvuWorkerCount()): Promise<DjvuPageDecoder> {
  const bytes = await read();
  const first = await startWorker(lib, bytes);
  const all = [first];
  const idle = [first];
  const queue: ((worker: BookWorker) => void)[] = [];
  let closed = false;
  const release = (worker: BookWorker) => {
    const next = queue.shift();
    if (next) next(worker);
    else idle.push(worker);
  };
  const started = Promise.all(
    Array.from({ length: workers - 1 }, () =>
      startWorker(lib, bytes).then(
        (worker) => {
          if (closed) return worker.terminate();
          all.push(worker);
          release(worker);
        },
        (error: unknown) => console.warn('An extra DjVu worker could not start:', error),
      ),
    ),
  ).then(() => {});
  return {
    count: first.count,
    get parallel() {
      return all.length;
    },
    started,
    async decode(page) {
      const worker = idle.pop() ?? (await new Promise<BookWorker>((resolve) => queue.push(resolve)));
      try {
        return await worker.decode(page);
      } finally {
        release(worker);
      }
    },
    close() {
      closed = true;
      for (const worker of all) worker.terminate();
    },
  };
}

/**
 * The largest a page of `width`×`height` px is shown on this screen without zooming in, as a share of its size:
 * fitted into the screen either way round (the window can be maximized, the phone turned).
 */
function screenScale(width: number, height: number): number {
  const ratio = devicePixelRatio || 1;
  const long = Math.max(screen.width, screen.height) * ratio;
  const short = Math.min(screen.width, screen.height) * ratio;
  return Math.min(1, Math.max(Math.min(short / width, long / height), Math.min(long / width, short / height)));
}

/** Scales a decoded page's image down to the screen's size; the page keeps its size and text in its own pixels. */
export async function fitToScreen(page: DjvuPageData): Promise<DjvuPageData> {
  const scale = screenScale(page.width, page.height);
  if (scale >= 1) return page;
  const width = Math.max(1, Math.round(page.width * scale));
  const height = Math.max(1, Math.round(page.height * scale));
  const bitmap = await createImageBitmap(page.image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  if (!context) return page;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { ...page, image: context.getImageData(0, 0, width, height) };
}

interface Job {
  page: number;
  full: boolean;
  waiters: { resolve: (page: DjvuPageData) => void; reject: (error: unknown) => void }[];
}

const pageBytes = (page: DjvuPageData) => page.image.data.byteLength;
const jobKey = (page: number, full: boolean) => `${page}${full ? 'f' : ''}`;
/** Full-resolution pages kept for zooming: the pages shown, at most. */
const FULL_PAGES_KEPT = 2;

export class DjvuPageStore {
  private decoder: DjvuPageDecoder | null = null;
  private readonly opening: Promise<DjvuPageDecoder>;
  /** Pages scaled to the screen. */
  private readonly pages = new Map<number, DjvuPageData>();
  /** Pages at full resolution, the latest asked for last. */
  private readonly fullPages = new Map<number, DjvuPageData>();
  /** Pages asked for and not decoded yet, in the order they were asked for. */
  private readonly jobs = new Map<string, Job>();
  /** Pages that could not be decoded, so the background decoding does not try them again. */
  private readonly failed = new Set<number>();
  /** Pages being decoded (keys as in `jobs`). */
  private readonly decoding = new Set<string>();
  private bytes = 0;
  /** The page the reader is at: 0 until a page is asked for, so nothing is decoded before the reader's first page. */
  private position = 0;
  private closed = false;

  /**
   * `budget`: bytes of pages to keep (the pages being shown are kept anyway). `reduce` scales a page decoded at full
   * resolution down to the size it is kept at.
   */
  constructor(
    open: () => Promise<DjvuPageDecoder>,
    private readonly budget: number,
    private readonly reduce: (page: DjvuPageData) => Promise<DjvuPageData> = fitToScreen,
  ) {
    this.opening = open().then((decoder) => {
      if (this.closed) {
        decoder.close();
        return decoder;
      }
      this.decoder = decoder;
      // More workers may start after the first: give them work as they do.
      void decoder.started?.then(() => this.pump());
      this.pump();
      return decoder;
    });
    // Reported to whoever asks for a page.
    this.opening.catch(() => {});
  }

  /** The book's page count, 0 until it is open. */
  get count(): number {
    return this.decoder?.count ?? 0;
  }

  /** Page `n` (1-based), or null past the last page; `full` at full resolution. Pages are then decoded outward from it. */
  async page(n: number, full = false): Promise<DjvuPageData | null> {
    const { count } = await this.opening;
    if (this.closed) throw new Error('The book was closed');
    if (n > count) return null;
    if (!full) this.position = n;
    const kept = full ? this.fullPages.get(n) : this.pages.get(n);
    if (kept) {
      this.pump();
      return kept;
    }
    return new Promise<DjvuPageData>((resolve, reject) => {
      const job = this.jobs.get(jobKey(n, full)) ?? { page: n, full, waiters: [] };
      job.waiters.push({ resolve, reject });
      this.jobs.set(jobKey(n, full), job);
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
    this.decoder?.close();
    const error = new Error('The book was closed');
    for (const job of this.jobs.values()) for (const waiter of job.waiters) waiter.reject(error);
    this.jobs.clear();
    this.pages.clear();
    this.fullPages.clear();
    this.bytes = 0;
  }

  /** The pages to keep, most wanted first: as many as fit the budget at the average size kept so far. */
  private wanted(): number[] {
    if (!this.position) return [];
    const count = this.decoder?.count ?? 0;
    const average = this.pages.size ? this.bytes / this.pages.size : 0;
    const limit = Math.min(count, average ? Math.max(2, Math.floor(this.budget / average)) : 2);
    const order = [this.position];
    let ahead = this.position + 1;
    let back = this.position - 1;
    while (order.length < limit && (ahead <= count || back >= 1)) {
      for (let i = 0; i < 3 && ahead <= count && order.length < limit; i++) order.push(ahead++);
      if (back >= 1 && order.length < limit) order.push(back--);
    }
    return order;
  }

  /**
   * Starts decoding the next pages wanted, as many at once as the decoder decodes, and no more: a page asked for
   * then never waits behind a queue of pages decoded ahead.
   */
  private pump(): void {
    const decoder = this.decoder;
    if (!decoder || this.closed) return;
    while (this.decoding.size < decoder.parallel) {
      const job = this.nextJob();
      if (!job) return;
      this.start(job);
    }
  }

  /** Pages asked for first, in the order asked, then the pages wanted around the reader. */
  private nextJob(): Job | null {
    for (const job of this.jobs.values()) if (!this.decoding.has(jobKey(job.page, job.full))) return job;
    const n = this.wanted().find((m) => !this.pages.has(m) && !this.failed.has(m) && !this.decoding.has(jobKey(m, false)));
    return n === undefined ? null : { page: n, full: false, waiters: [] };
  }

  private start(job: Job): void {
    const key = jobKey(job.page, job.full);
    this.decoding.add(key);
    this.decode(job.page, job.full).then(
      (page) => {
        this.decoding.delete(key);
        if (this.closed) return;
        for (const waiter of this.take(job)) waiter.resolve(page);
        this.pump();
      },
      (error: unknown) => {
        this.decoding.delete(key);
        if (this.closed) return;
        this.failed.add(job.page);
        for (const waiter of this.take(job)) waiter.reject(error);
        this.pump();
      },
    );
  }

  /** Decodes page `n` and keeps it scaled down, and at full resolution when that was asked for. */
  private async decode(n: number, full: boolean): Promise<DjvuPageData> {
    // Kept meanwhile, by decoding it the other way.
    const kept = full ? this.fullPages.get(n) : this.pages.get(n);
    if (kept) return kept;
    const page = await this.decoder!.decode(n);
    if (!this.pages.has(n)) this.keep(n, await this.reduce(page));
    if (!full) return this.pages.get(n) ?? page;
    this.fullPages.delete(n);
    this.fullPages.set(n, page);
    for (const m of this.fullPages.keys()) if (this.fullPages.size > FULL_PAGES_KEPT) this.fullPages.delete(m);
    return page;
  }

  /** The waiters for a page just decoded, including any that asked while it was being decoded ahead. */
  private take(job: Job): Job['waiters'] {
    const key = jobKey(job.page, job.full);
    const waiters = this.jobs.get(key)?.waiters ?? job.waiters;
    this.jobs.delete(key);
    return waiters;
  }

  /** Adds a page; over the budget, drops the pages farthest from the reader that are no longer wanted. */
  private keep(n: number, page: DjvuPageData): void {
    if (this.closed) return;
    this.pages.set(n, page);
    this.bytes += pageBytes(page);
    if (this.bytes <= this.budget) return;
    const wanted = new Set(this.wanted());
    const unwanted = [...this.pages.keys()].filter((m) => !wanted.has(m) && m !== n);
    unwanted.sort((a, b) => Math.abs(b - this.position) - Math.abs(a - this.position));
    for (const m of unwanted) {
      if (this.bytes <= this.budget) break;
      this.bytes -= pageBytes(this.pages.get(m)!);
      this.pages.delete(m);
    }
  }
}
