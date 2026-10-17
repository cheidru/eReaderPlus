/**
 * Keeps the PDF book being read open in the app, so that turning a page shows it at once. pdf.js parses the file once,
 * when the book opens (opening it in each page document took a few hundred ms a page), and the app draws pages ahead
 * of the reader: the pages asked for first, then outward from the reader's position (three pages forward for each one
 * back), at the resolution last asked for, keeping as many as the memory budget allows.
 * Page documents ask for their pages through the app (`pdfPage` messages, see src/inject/pdf-page.ts).
 */
import type { PdfPageData, PdfPageRenderer } from './pdf-common';

interface Waiter {
  resolve: (page: PdfPageData | null) => void;
  reject: (error: unknown) => void;
}

interface Job {
  page: number;
  scale: number;
  /** Who asked for the page: none for a page drawn ahead. */
  waiters: Waiter[];
}

/** A page kept at this scale serves a request for a scale within 1% of it. */
const sameScale = (a: number, b: number) => Math.abs(a - b) <= 0.01 * Math.max(a, b);

const pageBytes = (page: PdfPageData) => page.image.width * page.image.height * 4;

export class PdfPageStore {
  private renderer: PdfPageRenderer | null = null;
  private readonly opening: Promise<PdfPageRenderer>;
  /** Pages drawn, each at the scale it was asked for (`scales`). */
  private readonly pages = new Map<number, PdfPageData>();
  private readonly scales = new Map<number, number>();
  /** Pages asked for and not drawn yet, in the order asked. */
  private readonly jobs: Job[] = [];
  /** The page being drawn: one at a time, since pdf.js draws on the app's main thread. */
  private drawing: { job: Job; abort: AbortController } | null = null;
  /** Pages that could not be drawn, so they are not drawn ahead again. */
  private readonly failed = new Set<number>();
  private bytes = 0;
  /** The page the reader is at, and the scale it asked for: 0 until a page is asked for. */
  private position = 0;
  private scale = 0;
  private closed = false;

  /** `budget`: bytes of pages to keep (the pages being shown are kept anyway). */
  constructor(
    open: () => Promise<PdfPageRenderer>,
    private readonly budget: number,
  ) {
    this.opening = open().then((renderer) => {
      if (this.closed) renderer.close();
      else this.renderer = renderer;
      return renderer;
    });
    // Reported to whoever asks for a page.
    this.opening.catch(() => {});
  }

  /** The book's page count and reading direction, once it is open. */
  async book(): Promise<{ count: number; rtl: boolean }> {
    const { count, rtl } = await this.opening;
    return { count, rtl };
  }

  /**
   * Page `n` (1-based) at `scale` device px per PDF point; null past the last page, or when a request for the same
   * page at another scale replaced this one (zooming). Pages are then drawn ahead from it.
   */
  async page(n: number, scale: number): Promise<PdfPageData | null> {
    const { count } = await this.opening;
    if (this.closed) throw new Error('The book was closed');
    if (n > count) return null;
    this.position = n;
    this.scale = scale;
    const kept = this.kept(n, scale);
    if (kept) {
      this.pump();
      return kept;
    }
    return new Promise<PdfPageData | null>((resolve, reject) => {
      const waiter = { resolve, reject };
      const current = this.drawing?.job;
      // Being drawn ahead already: it is the reader's now.
      if (current?.page === n && sameScale(current.scale, scale)) return void current.waiters.push(waiter);
      const same = this.jobs.find((job) => job.page === n && sameScale(job.scale, scale));
      if (same) same.waiters.push(waiter);
      else {
        // A page asked for again at another scale (zooming) is drawn only at the latest.
        for (const job of this.jobs.filter((j) => j.page === n)) this.settle(job, null);
        this.jobs.push({ page: n, scale, waiters: [waiter] });
      }
      // A page drawn ahead, or at a scale no longer wanted, makes way for it.
      if (current &&(current.waiters.length === 0 || (current.page === n && !sameScale(current.scale, scale)))) this.drawing!.abort.abort();
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
    this.renderer?.close();
    this.drawing?.abort.abort();
    const error = new Error('The book was closed');
    for (const job of this.jobs) for (const waiter of job.waiters) waiter.reject(error);
    this.jobs.length = 0;
    for (const page of this.pages.values()) page.image.close();
    this.pages.clear();
    this.scales.clear();
    this.bytes = 0;
  }

  private kept(n: number, scale: number): PdfPageData | null {
    const page = this.pages.get(n);
    return page && sameScale(this.scales.get(n)!, scale) ? page : null;
  }

  /** The pages to keep, most wanted first: as many as fit the budget at the average size kept so far. */
  private wanted(): number[] {
    if (!this.position || !this.renderer) return [];
    const { count } = this.renderer;
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

  /** Pages asked for first, in the order asked, then the pages wanted around the reader. */
  private nextJob(): Job | null {
    const asked = this.jobs.shift();
    if (asked) return asked;
    const n = this.wanted().find((m) => !this.kept(m, this.scale) && !this.failed.has(m));
    return n === undefined ? null : { page: n, scale: this.scale, waiters: [] };
  }

  private pump(): void {
    const renderer = this.renderer;
    if (!renderer || this.closed || this.drawing) return;
    const job = this.nextJob();
    if (!job) return;
    const abort = new AbortController();
    this.drawing = { job, abort };
    renderer.page(job.page, job.scale, abort.signal).then(
      (page) => {
        this.drawing = null;
        if (this.closed) return page.image.close();
        this.keep(job.page, job.scale, page);
        this.settle(job, page);
        this.pump();
      },
      (error: unknown) => {
        this.drawing = null;
        if (this.closed) return;
        if (abort.signal.aborted) {
          // Made way for another page: asked for again, unless another request replaced it.
          if (job.waiters.length > 0 && !this.jobs.some((j) => j.page === job.page)) this.jobs.push(job);
          else this.settle(job, null);
        } else {
          this.failed.add(job.page);
          for (const waiter of job.waiters) waiter.reject(error);
        }
        this.pump();
      },
    );
  }

  private settle(job: Job, page: PdfPageData | null): void {
    const index = this.jobs.indexOf(job);
    if (index >= 0) this.jobs.splice(index, 1);
    for (const waiter of job.waiters.splice(0)) waiter.resolve(page);
  }

  /** Adds a page; over the budget, drops the pages farthest from the reader that are no longer wanted. */
  private keep(n: number, scale: number, page: PdfPageData): void {
    const old = this.pages.get(n);
    if (old) {
      this.bytes -= pageBytes(old);
      old.image.close();
    }
    this.pages.set(n, page);
    this.scales.set(n, scale);
    this.bytes += pageBytes(page);
    if (this.bytes <= this.budget) return;
    const wanted = new Set(this.wanted());
    const unwanted = [...this.pages.keys()].filter((m) => !wanted.has(m) && m !== n);
    unwanted.sort((a, b) => Math.abs(b - this.position) - Math.abs(a - this.position));
    for (const m of unwanted) {
      if (this.bytes <= this.budget) break;
      const dropped = this.pages.get(m)!;
      this.bytes -= pageBytes(dropped);
      dropped.image.close();
      this.pages.delete(m);
      this.scales.delete(m);
    }
  }
}
