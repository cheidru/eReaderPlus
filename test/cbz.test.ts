import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { comicImages, importCbz, upgradeComicPages } from '../src/core/cbz';
import { hasPageSpreads } from '../src/core/spread';
import type { BookManifest } from '../src/core/types';

describe('CBZ', () => {
  it('orders pages naturally and skips hidden files', () => {
    expect(comicImages(['p10.jpg', 'p2.jpg', 'p1.png', '__MACOSX/p1.jpg', '.thumb.jpg', 'info.txt'])).toEqual([
      'p1.png',
      'p2.jpg',
      'p10.jpg',
    ]);
  });

  it('builds one fixed-layout page per image', async () => {
    const fs = memoryBookFs({ 'b/2.jpg': new Uint8Array(1), 'b/1 a.jpg': new Uint8Array(1) });
    const previews: unknown[] = [];
    const book = await importCbz(fs, 'My Comic.cbz', (preview) => previews.push(preview));
    expect(previews).toEqual([{ title: 'My Comic', authors: [], cover: 'b/1 a.jpg' }]);
    expect(book.title).toBe('My Comic');
    expect(book.layout).toBe('pre-paginated');
    expect(book.cover).toBe('b/1 a.jpg');
    expect(book.spine.map((s) => s.href)).toEqual(['.ereader/pages/0001.xhtml', '.ereader/pages/0002.xhtml']);
    expect(await fs.readText('.ereader/pages/0001.xhtml')).toContain('src="../../b/1%20a.jpg"');
  });

  it('puts the next image in each page, for two-page spreads', async () => {
    const fs = memoryBookFs({ '1.jpg': new Uint8Array(1), '2.jpg': new Uint8Array(1) });
    const book = await importCbz(fs, 'c.cbz');
    const first = await fs.readText('.ereader/pages/0001.xhtml');
    expect(first).toContain('<img class="page" src="../../1.jpg" alt=""/><img class="next" src="../../2.jpg" alt=""/>');
    expect(await fs.readText('.ereader/pages/0002.xhtml')).not.toContain('class="next"');
    expect(book.direction).toBe('ltr');
    expect(hasPageSpreads({ format: 'cbz', ...book })).toBe(true);
  });

  it('reads manga from right to left', async () => {
    const fs = memoryBookFs({
      '1.jpg': new Uint8Array(1),
      'ComicInfo.xml': '<ComicInfo><Title>M</Title><Manga>YesAndRightToLeft</Manga></ComicInfo>',
    });
    const book = await importCbz(fs, 'm.cbz');
    expect(book.direction).toBe('rtl');
    expect(await fs.readText('.ereader/pages/0001.xhtml')).toContain('dir="rtl"');
  });

  it('writes the pages of a comic imported before spreads again, with the next image in each', async () => {
    const old = (src: string) =>
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><img src="../../${src}" alt=""/></body></html>`;
    const fs = memoryBookFs({ '.ereader/pages/0001.xhtml': old('a/p%201.jpg'), '.ereader/pages/0002.xhtml': old('a/p%26.jpg') });
    const manifest: BookManifest = {
      version: 1,
      id: 'x',
      format: 'cbz',
      identifier: 'cbz|x|2',
      title: 'x',
      authors: [],
      language: '',
      cover: 'a/p 1.jpg',
      layout: 'pre-paginated',
      direction: 'ltr',
      spine: [{ href: '.ereader/pages/0001.xhtml', linear: true }, { href: '.ereader/pages/0002.xhtml', linear: true }],
      toc: [],
    };
    expect(hasPageSpreads(manifest)).toBe(false);
    const upgraded = await upgradeComicPages(fs, manifest);
    expect(upgraded?.pagesVersion).toBe(2);
    expect(hasPageSpreads(upgraded)).toBe(true);
    expect(await fs.readText('.ereader/pages/0001.xhtml')).toContain('src="../../a/p%201.jpg" alt=""/><img class="next" src="../../a/p%26.jpg"');
    expect(await upgradeComicPages(fs, upgraded!)).toBeNull();
  });
});
