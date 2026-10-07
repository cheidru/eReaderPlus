import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { INJECTED_TAGS } from '../src/core/inject';
import { importLit } from '../src/core/lit';
import { splitFragment } from '../src/core/paths';

// Made by scripts/make-test-fixtures.mjs (Calibre) from the same EPUB as the Kindle fixtures. Calibre writes
// "sealed" LIT files (DES-encrypted, LZX-compressed), like Microsoft's own tools did.
const fixture = () => new Uint8Array(readFileSync('test/fixtures/books/sample.lit'));

async function convert() {
  const fs = memoryBookFs({ 'source.lit': fixture() });
  return { fs, book: await importLit(fs, 'source.lit', 'sample.lit') };
}

describe('LIT', () => {
  it('unseals and decompresses the book and reads its metadata', async () => {
    const { fs, book } = await convert();
    expect(book.title).toBe('Kindle Sample');
    expect(book.authors).toEqual(['eReaderPlus samples']);
    expect(book.cover).toMatch(/cover\.png$/);
    expect(fs.files).toContain(book.cover);
    expect(book.spine.length).toBeGreaterThanOrEqual(2);
  });

  it('builds a TOC whose targets exist', async () => {
    const { fs, book } = await convert();
    expect(book.toc.map((t) => t.label)).toEqual(['Chapter One', 'The Figure', 'Chapter Two']);
    for (const item of book.toc) {
      const [path, fragment] = splitFragment(item.href);
      const doc = new DOMParser().parseFromString(await fs.readText(path), 'text/html');
      if (fragment) expect(doc.getElementById(fragment), item.href).not.toBeNull();
    }
  });

  it('rebuilds documents as HTML with working images, styles and links', async () => {
    const { fs, book } = await convert();
    const chapters = await Promise.all(book.spine.map(async (s) => ({ path: s.href, html: await fs.readText(s.href) })));
    const one = chapters.find((c) => c.html.includes('See the note'))!;
    expect(one.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(one.html).toContain(INJECTED_TAGS);
    expect(one.html).toContain('Ünïcödé text survives');

    const doc = new DOMParser().parseFromString(one.html, 'text/html');
    /** Book-root-relative path and fragment of a URL found in this document. */
    const resolve = (url: string) => {
      const resolved = new URL(url, `https://book/${one.path}`);
      return { path: decodeURIComponent(resolved.pathname.slice(1)), fragment: resolved.hash.slice(1) };
    };
    expect(fs.files).toContain(resolve(doc.querySelector('img')!.getAttribute('src')!).path);
    const css = doc.querySelector('link[rel="stylesheet"]:not([href^="/__ereader__/"])')!.getAttribute('href')!;
    expect(fs.files).toContain(resolve(css).path);

    const note = resolve(Array.from(doc.querySelectorAll('a')).find((a) => a.textContent === '[1]')!.getAttribute('href')!);
    const target = new DOMParser().parseFromString(await fs.readText(note.path), 'text/html');
    expect(target.getElementById(note.fragment)?.textContent).toContain('The note.');
  });

  it('rejects files that are not LIT', async () => {
    const fs = memoryBookFs({ 'source.lit': new TextEncoder().encode('ITSF not a lit file') });
    await expect(importLit(fs, 'source.lit', 'x.lit')).rejects.toThrow(/Not a LIT file/);
  });
});
