import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { decodeChmText, importChm, lcidEncoding } from '../src/core/chm';
import { INJECTED_TAGS } from '../src/core/inject';
import { relativePath } from '../src/core/paths';
import type { TocItem } from '../src/core/types';

// Made by scripts/make-test-fixtures.mjs: a Russian help file in Windows-1251 without charset declarations,
// with links written the Windows way (wrong case, backslashes, ms-its: URLs).
async function convert() {
  const fs = memoryBookFs({ 'source.chm': new Uint8Array(readFileSync('test/fixtures/books/sample.chm')) });
  return { fs, book: await importChm(fs, 'source.chm', 'sample.chm') };
}

const outline = (items: TocItem[]): unknown[] => items.map((i) => (i.children.length ? [i.label, i.href, outline(i.children)] : [i.label, i.href]));

describe('CHM', () => {
  it('reads the title, reading order and sitemap TOC in the archive code page', async () => {
    const { book } = await convert();
    expect(book.title).toBe('Пример справки');
    expect(book.layout).toBe('reflowable');
    expect(book.identifier).toMatch(/^chm:[0-9a-f]{64}$/);
    expect(book.spine).toEqual([
      { href: 'index.htm', linear: true },
      { href: 'topics/chapter1.htm', linear: true },
      { href: 'topics/chapter2.htm', linear: true },
    ]);
    expect(outline(book.toc)).toEqual([
      ['Пример справки', 'index.htm'],
      [
        'Главы',
        '',
        [
          ['Глава первая', 'topics/chapter1.htm'],
          ['Глава вторая & часть два', 'topics/chapter2.htm#part'],
        ],
      ],
    ]);
  });

  it('transcodes pages to UTF-8, keeps their scripts and fixes Windows-style links', async () => {
    const { fs } = await convert();
    const index = await fs.readText('index.htm');
    expect(index).toContain(`<meta charset="utf-8">${INJECTED_TAGS}`);
    expect(index).toContain('Добро пожаловать.');
    expect(index).toContain('HREF="topics/chapter1.htm"');
    expect(index).toContain('HREF="topics/chapter2.htm#part"');
    expect(index).toContain('SRC="images/pic.png"');
    expect(index).toContain('HREF="style.css"');

    const chapter = await fs.readText('topics/chapter1.htm');
    expect(chapter).toContain('HREF="../index.htm"');
    expect(chapter).toContain('HREF="../style.css"');
    expect(chapter).toContain('<SCRIPT>window.__chmScript = true;</SCRIPT>');

    expect(await fs.readText('style.css')).toContain('url(images/pic.png)');
    expect(fs.files).not.toContain('#SYSTEM');
    expect((await fs.readBinary('images/pic.png'))[1]).toBe(0x50); // PNG signature
  });

  it('rejects files that are not CHM', async () => {
    const fs = memoryBookFs({ 'source.chm': new TextEncoder().encode('not a help file') });
    await expect(importChm(fs, 'source.chm', 'x.chm')).rejects.toThrow(/Not a CHM file/);
  });

  it('maps locales to Windows code pages', () => {
    expect(lcidEncoding(0x0419)).toBe('windows-1251');
    expect(lcidEncoding(0x0405)).toBe('windows-1250');
    expect(lcidEncoding(0x0411)).toBe('shift_jis');
    expect(lcidEncoding(0x0804)).toBe('gbk');
    expect(lcidEncoding(0x0404)).toBe('big5');
    expect(lcidEncoding(0x0409)).toBe('windows-1252');
  });

  it('prefers a declared charset over the archive code page', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('<meta charset="utf-8"><p>'), ...new TextEncoder().encode('Ж')]);
    expect(decodeChmText(bytes, 'windows-1251')).toContain('<p>Ж');
  });

  it('computes relative paths between book files', () => {
    expect(relativePath('topics/a.htm', 'index.htm')).toBe('../index.htm');
    expect(relativePath('index.htm', 'images/p.png')).toBe('images/p.png');
    expect(relativePath('a/b/c.htm', 'a/d/e.htm')).toBe('../d/e.htm');
  });
});
