/**
 * Page numbers across a whole reflowable book. Only the documents loaded in the reader's frames are laid out, so
 * their page counts are known; the others are estimated from the length of their text, at the pages per character
 * of the documents measured so far. Fixed-layout books need none of this: each spine document is a page.
 */
import type { Platform } from '../platform/platform';
import { htmlText } from './booksearch';
import { loadTextLengths, saveTextLengths } from './library';
import type { BookManifest } from './types';

/**
 * The page count of each spine document: `measured` where known, else estimated from `lengths` (text length of
 * each document; null while not known yet, when every document counts as long as the average measured one).
 */
export function estimatePageCounts(spineCount: number, lengths: readonly number[] | null, measured: ReadonlyMap<number, number>): number[] {
  const weight = (i: number) => (lengths ? (lengths[i] ?? 0) : 1);
  let pages = 0;
  let chars = 0;
  for (const [i, count] of measured) {
    if (weight(i) <= 0) continue;
    pages += count;
    chars += weight(i);
  }
  const perChar = chars > 0 ? pages / chars : 0;
  return Array.from({ length: spineCount }, (_, i) => measured.get(i) ?? Math.max(1, Math.round(weight(i) * perChar)));
}

/** The text length of each spine document, read once per book and kept with it. */
export async function bookTextLengths(platform: Platform, manifest: BookManifest, signal: AbortSignal): Promise<number[]> {
  const saved = await loadTextLengths(platform, manifest.id);
  if (saved?.length === manifest.spine.length) return saved;
  const parser = new DOMParser();
  const lengths: number[] = [];
  for (const item of manifest.spine) {
    signal.throwIfAborted();
    lengths.push(htmlText(parser, item.href, await platform.readText(manifest.id, item.href).catch(() => '')).text.length);
  }
  await saveTextLengths(platform, manifest.id, lengths);
  return lengths;
}
