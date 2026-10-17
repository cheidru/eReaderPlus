/**
 * Two-page spreads of page-image books (PDF, DjVu): which spine documents are shown together. A spread is
 * shown by the document of its first page, which draws the second page beside its own.
 */
import type { BookFormat } from './types';

/** Books whose page documents can show the next page beside their own. */
export const hasPageSpreads = (book: { format: BookFormat } | null | undefined) => book?.format === 'pdf' || book?.format === 'djvu';

/** Narrower than this, two pages side by side would be too cramped to read. */
const SPREAD_MIN_WIDTH = 640;

/** Whether a book frame this size shows two pages side by side, if the reader turned that on: landscape and wide enough. */
export const spreadFits = (width: number, height: number) => width > height && width >= SPREAD_MIN_WIDTH;

/**
 * Index of the first page of the spread holding page `index`. Pages pair as 1–2, 3–4, …, or with
 * `coverAlone`, as in a printed book: the cover by itself, then 2–3, 4–5, …
 */
export function spreadStart(index: number, coverAlone: boolean): number {
  if (!coverAlone) return index - (index % 2);
  return index === 0 ? 0 : index - ((index - 1) % 2);
}

/** Index of the last page of the spread starting at `start`, in a book of `count` pages. */
export function spreadEnd(start: number, count: number, coverAlone: boolean): number {
  return coverAlone && start === 0 ? 0 : Math.min(start + 1, count - 1);
}
