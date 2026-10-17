/**
 * Search inside a book, on the app side: extracts the text of every spine document once per book (kept
 * while the book stays open), then finds matches in it. The paginator locates a chosen match in the shown
 * document by its occurrence number (see textsearch.ts), so both sides must extract the same text.
 */
import type { Platform } from '../platform/platform';
import { loadPdfLibrary, PDF_SOURCE } from './pdf';
import { pdfDocumentOptions } from './pdf-common';
import { collectChunks, findOccurrences, indexText, normalizeQuery, type TextChunk } from './textsearch';
import type { BookManifest } from './types';

export interface SearchHit {
  spineIndex: number;
  /** Which match in its spine document (0-based), as the paginator counts them. */
  occurrence: number;
  /** Text around the match, for the result list. */
  before: string;
  match: string;
  after: string;
}

/** Most results listed; a very common word would otherwise list thousands. */
export const MAX_HITS = 500;
const CONTEXT_CHARS = 48;

/** DjVu text needs the DjVu decoder and comics have none, so neither can be searched. */
export function isSearchable(manifest: BookManifest): boolean {
  return manifest.format !== 'djvu' && manifest.format !== 'cbz';
}

/** A spine document's text: folded for matching, and as written for showing results (same length). */
export interface DocText {
  text: string;
  display: string;
}

/** The text of every spine document, for the book whose texts were read last. */
let cache: { bookId: string; texts: Promise<DocText[]> } | null = null;

/**
 * Reads the text of every spine document of a book, reporting progress (0..1) to the caller that started
 * the reading. Cached, also while still reading, so only the first search in a book waits for it and
 * typing on doesn't start over. `signal` (the book being closed) stops the reading.
 */
export function bookTexts(platform: Platform, manifest: BookManifest, onProgress: (done: number) => void, signal: AbortSignal): Promise<DocText[]> {
  if (cache?.bookId !== manifest.id) {
    const texts: Promise<DocText[]> = (manifest.format === 'pdf' ? pdfTexts : htmlTexts)(platform, manifest, onProgress, signal).catch((error: unknown) => {
      if (cache?.texts === texts) cache = null;
      throw error;
    });
    cache = { bookId: manifest.id, texts };
  }
  return cache.texts;
}

async function htmlTexts(platform: Platform, manifest: BookManifest, onProgress: (done: number) => void, signal: AbortSignal): Promise<DocText[]> {
  const parser = new DOMParser();
  const texts: DocText[] = [];
  for (const [i, item] of manifest.spine.entries()) {
    signal.throwIfAborted();
    texts.push(htmlText(parser, item.href, await platform.readText(manifest.id, item.href).catch(() => '')));
    onProgress((i + 1) / manifest.spine.length);
  }
  return texts;
}

/** The text of one stored document, parsed the way the browser parses it when the book shows it. */
export function htmlText(parser: DOMParser, path: string, source: string): DocText {
  const xml = /\.(xhtml|xht|xml)$/i.test(path);
  let doc = parser.parseFromString(source, xml ? 'application/xhtml+xml' : 'text/html');
  // The reader can't show a malformed XHTML document either; its text still deserves to be found.
  if (xml && doc.getElementsByTagName('parsererror').length > 0) doc = parser.parseFromString(source, 'text/html');
  const body = doc.body ?? doc.getElementsByTagNameNS('*', 'body')[0];
  const { text, display } = indexText(body ? collectChunks(body) : [], false);
  return { text, display };
}

/**
 * PDF: the text of each page as pdf.js's text layer shows it in the page document, one span per text item
 * and a line break where an item ends a line.
 */
async function pdfTexts(platform: Platform, manifest: BookManifest, onProgress: (done: number) => void, signal: AbortSignal): Promise<DocText[]> {
  const lib = await loadPdfLibrary();
  const data = await platform.readBinary(manifest.id, PDF_SOURCE);
  const task = lib.getDocument({ data, ...pdfDocumentOptions() });
  try {
    const doc = await task.promise;
    const texts: DocText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      signal.throwIfAborted();
      const content = await (await doc.getPage(n)).getTextContent();
      const chunks: TextChunk[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        if (item.str) chunks.push({ node: null, text: item.str });
        if (item.hasEOL) chunks.push({ node: null, text: ' ' });
      }
      const { text, display } = indexText(chunks, false);
      texts.push({ text, display });
      onProgress(n / doc.numPages);
    }
    return texts;
  } finally {
    void task.destroy();
  }
}

/** Matches of `query` in the documents' texts, in reading order, at most MAX_HITS. */
export function findInTexts(texts: DocText[], query: string): SearchHit[] {
  const q = normalizeQuery(query);
  const hits: SearchHit[] = [];
  if (!q) return hits;
  for (const [spineIndex, doc] of texts.entries()) {
    for (const [occurrence, at] of findOccurrences(doc.text, q).entries()) {
      if (hits.length >= MAX_HITS) return hits;
      hits.push({ spineIndex, occurrence, ...snippet(doc.display, at, q.length) });
    }
  }
  return hits;
}

/** The match with some context on each side, cut at word boundaries where possible. */
function snippet(text: string, at: number, length: number): Pick<SearchHit, 'before' | 'match' | 'after'> {
  let start = Math.max(0, at - CONTEXT_CHARS);
  let end = Math.min(text.length, at + length + CONTEXT_CHARS);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(' ', end) > at + length ? text.lastIndexOf(' ', end) : end;
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, at),
    match: text.slice(at, at + length),
    after: text.slice(at + length, end) + (end < text.length ? '…' : ''),
  };
}
