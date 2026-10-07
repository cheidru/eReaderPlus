import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { INJECTED_TAGS } from '../src/core/inject';
import { importPdf, type PdfLibrary } from '../src/core/pdf';

// pdf.js's legacy build runs in Node (with its worker on the main thread).
const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfLibrary;

// Made by scripts/make-test-fixtures.mjs: three 450×600 pt pages; outline "Red page" → 1,
// "Part two" → 2 › "Blue page" → 3; page 1 links to page 3 and to https://example.com/.
const sample = () => new Uint8Array(readFileSync('test/fixtures/books/sample.pdf'));

describe('PDF', () => {
  it('writes one fixed-layout page document per page, sized in CSS px', async () => {
    const fs = memoryBookFs({ 'source.pdf': sample() });
    const book = await importPdf(fs, 'source.pdf', 'sample.pdf', pdfjs);
    expect(book.title).toBe('PDF Sample');
    expect(book.authors).toEqual(['eReaderPlus samples']);
    expect(book.layout).toBe('pre-paginated');
    expect(book.identifier).toMatch(/^pdf:[0-9a-f]+$/);
    expect(book.spine.map((s) => s.href)).toEqual(['.ereader/pages/0001.html', '.ereader/pages/0002.html', '.ereader/pages/0003.html']);

    const page = await fs.readText('.ereader/pages/0003.html');
    expect(page).toContain(INJECTED_TAGS);
    expect(page).toContain('<meta name="viewport" content="width=600, height=800"/>');
    expect(page).toContain('src="/__ereader__/pdf-page.js"');
    expect(page).toContain('data-source="../../source.pdf" data-page="3"');
  });

  it('maps the outline to pages', async () => {
    const fs = memoryBookFs({ 'source.pdf': sample() });
    const book = await importPdf(fs, 'source.pdf', 'sample.pdf', pdfjs);
    expect(book.toc).toEqual([
      { label: 'Red page', href: '.ereader/pages/0001.html', children: [] },
      { label: 'Part two', href: '.ereader/pages/0002.html', children: [{ label: 'Blue page', href: '.ereader/pages/0003.html', children: [] }] },
    ]);
  });

  it('rejects files that are not PDF', async () => {
    const fs = memoryBookFs({ 'source.pdf': new TextEncoder().encode('AT&TFORM not a pdf') });
    await expect(importPdf(fs, 'source.pdf', 'x.pdf', pdfjs)).rejects.toThrow(/Not a PDF file/);
  });
});
