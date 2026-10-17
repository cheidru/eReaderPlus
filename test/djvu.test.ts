import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { importDjvu, type DjvuLibrary } from '../src/core/djvu';
import { INJECTED_TAGS } from '../src/core/inject';

// The real (vendored) DjVu.js. With `document` defined it does not start its worker message loop.
const DjVu = new Function(`${readFileSync('vendor/djvujs/djvu.js', 'utf8')};return DjVu;`)() as DjvuLibrary;

// Made by scripts/make-test-fixtures.mjs: three 600×800 pages; outline "Red page" → 1, "Part two" → 2 › "Blue page" → 3.
const sample = () => new Uint8Array(readFileSync('test/fixtures/books/sample.djvu'));

describe('DjVu', () => {
  it('writes one fixed-layout page document per page', async () => {
    const fs = memoryBookFs({ 'source.djvu': sample() });
    const book = await importDjvu(fs, 'source.djvu', 'My Scan.djvu', DjVu);
    expect(book.title).toBe('My Scan');
    expect(book.layout).toBe('pre-paginated');
    expect(book.identifier).toMatch(/^djvu:[0-9a-f]{64}$/);
    expect(book.spine.map((s) => s.href)).toEqual(['.ereader/pages/0001.html', '.ereader/pages/0002.html', '.ereader/pages/0003.html']);

    const page = await fs.readText('.ereader/pages/0002.html');
    expect(page).toContain(INJECTED_TAGS);
    expect(page).toContain('<meta name="viewport" content="width=600, height=800"/>');
    // DjVu.js is loaded by the page only when the app can't decode the page for it.
    expect(page).not.toContain('src="/__ereader__/djvu.js"');
    expect(page).toContain('src="/__ereader__/djvu-page.js"');
    expect(page).toContain('data-source="../../source.djvu" data-page="2"');
  });

  it('tells the title before writing the page documents', async () => {
    const fs = memoryBookFs({ 'source.djvu': sample() });
    const previews: unknown[] = [];
    await importDjvu(fs, 'source.djvu', 'My Scan.djvu', DjVu, (preview) => previews.push({ ...preview, files: fs.files.length }));
    // No cover in Node: it has no canvas to draw one.
    expect(previews).toEqual([{ title: 'My Scan', authors: [], cover: null, files: 1 }]);
  });

  it('maps the outline to pages', async () => {
    const fs = memoryBookFs({ 'source.djvu': sample() });
    const book = await importDjvu(fs, 'source.djvu', 'x.djvu', DjVu);
    expect(book.toc).toEqual([
      { label: 'Red page', href: '.ereader/pages/0001.html', children: [] },
      {
        label: 'Part two',
        href: '.ereader/pages/0002.html',
        children: [{ label: 'Blue page', href: '.ereader/pages/0003.html', children: [] }],
      },
    ]);
  });

  it('rejects files that are not DjVu', async () => {
    const fs = memoryBookFs({ 'source.djvu': new TextEncoder().encode('%PDF-1.7 not a djvu') });
    await expect(importDjvu(fs, 'source.djvu', 'x.djvu', DjVu)).rejects.toThrow(/Not a DjVu file/);
  });
});
