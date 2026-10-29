import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { forEachAtOnce, importEpub } from '../src/core/epub';
import { INJECTED_TAGS } from '../src/core/inject';
import { epub2Files, epub3Files } from './fixtures';

describe('importEpub', () => {
  it('parses EPUB 3 metadata, spine, cover and nav TOC', async () => {
    const fs = memoryBookFs(epub3Files());
    const book = await importEpub(fs);
    expect(book.title).toBe('Test Book');
    expect(book.authors).toEqual(['Ada Lovelace', 'Charles Babbage']);
    expect(book.language).toBe('en');
    expect(book.identifier).toBe('urn:uuid:12345678-1234-1234-1234-123456789abc');
    expect(book.cover).toBe('OEBPS/images/cover art.jpg');
    expect(book.layout).toBe('reflowable');
    expect(book.spine).toEqual([
      { href: 'OEBPS/text/ch1.xhtml.html', linear: true },
      { href: 'OEBPS/text/ch2.xhtml', linear: true },
      { href: 'OEBPS/text/notes.xhtml', linear: false },
    ]);
    expect(book.toc).toEqual([
      {
        label: 'Chapter One',
        href: 'OEBPS/text/ch1.xhtml.html',
        children: [{ label: 'Part B', href: 'OEBPS/text/ch1.xhtml.html#part-b', children: [] }],
      },
      { label: 'Unlinked heading', href: '', children: [] },
      { label: 'Chapter Two', href: 'OEBPS/text/ch2.xhtml', children: [] },
    ]);
  });

  it('tells the title, authors and cover before converting the chapters', async () => {
    const fs = memoryBookFs(epub3Files());
    const previews: unknown[] = [];
    await importEpub(fs, (preview) => previews.push({ ...preview, injected: String(fs.data.get('OEBPS/text/ch2.xhtml')).includes(INJECTED_TAGS) }));
    expect(previews).toEqual([{ title: 'Test Book', authors: ['Ada Lovelace', 'Charles Babbage'], cover: 'OEBPS/images/cover art.jpg', injected: false }]);
  });

  it('injects the paginator into every spine document', async () => {
    const fs = memoryBookFs(epub3Files());
    await importEpub(fs);
    for (const path of ['OEBPS/text/ch1.xhtml.html', 'OEBPS/text/ch2.xhtml', 'OEBPS/text/notes.xhtml']) {
      expect(await fs.readText(path)).toContain(INJECTED_TAGS);
    }
    expect(await fs.readText('OEBPS/nav.xhtml')).not.toContain(INJECTED_TAGS);
  });

  it('serves scripted XHTML as HTML so module scripts run, keeping the old path as an alias', async () => {
    const fs = memoryBookFs(epub3Files());
    const book = await importEpub(fs);
    expect(book.aliases).toEqual({ 'OEBPS/text/ch1.xhtml': 'OEBPS/text/ch1.xhtml.html' });
    const html = await fs.readText('OEBPS/text/ch1.xhtml.html');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toContain('<?xml');
    expect(html).toContain('<script>window.bookScript = 1;</script>');
    expect(html).toContain('<meta charset="utf-8">');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.getElementById('part-b')?.textContent).toBe('B');
    // Unscripted XHTML stays XHTML.
    expect(book.spine[1].href).toBe('OEBPS/text/ch2.xhtml');
  });

  it('parses EPUB 2 with prefixed OPF, meta cover and NCX TOC', async () => {
    const book = await importEpub(memoryBookFs(epub2Files()));
    expect(book.title).toBe('Old Book');
    expect(book.identifier).toBe('isbn-123');
    expect(book.cover).toBe('OEBPS/cover.png');
    expect(book.toc).toEqual([
      { label: 'Start', href: 'OEBPS/a.html', children: [{ label: 'Inner', href: 'OEBPS/a.html#x', children: [] }] },
    ]);
  });

  it('finds a cover meta giving a path instead of an id, and takes no web page for a cover', async () => {
    const files = epub2Files();
    files['OEBPS/content.opf'] = (files['OEBPS/content.opf'] as string)
      .replace('content="cov"', 'content="cover.png"')
      .replace('<opf:item id="ncx"', '<opf:item id="img_cover" href="cover.xhtml" media-type="image/xhtml"/><opf:item id="ncx"');
    expect((await importEpub(memoryBookFs(files))).cover).toBe('OEBPS/cover.png');
  });

  it('reads fixed-layout and right-to-left books', async () => {
    const files = epub3Files();
    files['OEBPS/content.opf'] = (files['OEBPS/content.opf'] as string)
      .replace('>reflowable<', '>pre-paginated<')
      .replace('page-progression-direction="ltr"', 'page-progression-direction="rtl"');
    const book = await importEpub(memoryBookFs(files));
    expect(book.layout).toBe('pre-paginated');
    expect(book.direction).toBe('rtl');
  });
});

describe('forEachAtOnce', () => {
  it('runs every task, no more than the limit at a time', async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    await forEachAtOnce([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 8 - n));
      done.push(n);
      running--;
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(most).toBe(3);
  });

  it('starts no more tasks after one fails, and rejects with its error', async () => {
    const started: number[] = [];
    const run = forEachAtOnce([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (n === 2) throw new Error('broken');
    });
    await expect(run).rejects.toThrow('broken');
    expect(started.length).toBeLessThan(6);
  });
});
