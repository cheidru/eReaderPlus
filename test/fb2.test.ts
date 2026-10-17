import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { decodeFb2, importFb2 } from '../src/core/fb2';
import { INJECTED_TAGS } from '../src/core/inject';

const FB2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <author><first-name>Лев</first-name><last-name>Толстой</last-name></author>
      <book-title>Война и мир</book-title>
      <lang>ru</lang>
      <coverpage><image l:href="#cover.jpg"/></coverpage>
    </title-info>
    <document-info><id>doc-42</id></document-info>
  </description>
  <body>
    <title><p>Том 1</p></title>
    <section>
      <title><p>Часть 1</p></title>
      <section id="s1"><title><p>Глава I</p></title><p>Текст<a l:href="#n1" type="note">1</a> &amp; <emphasis>курсив</emphasis>.</p></section>
    </section>
    <section><title><p>Часть 2</p></title><p>Ещё <strong>текст</strong></p><image l:href="#pic.png"/></section>
  </body>
  <body name="notes">
    <title><p>Примечания</p></title>
    <section id="n1"><title><p>1</p></title><p>Сноска</p></section>
  </body>
  <binary id="cover.jpg" content-type="image/jpeg">/9j/4A==</binary>
  <binary id="pic.png" content-type="image/png">iVBORw==</binary>
</FictionBook>`;

describe('FB2', () => {
  it('converts to XHTML chapters with TOC, notes, images and metadata', async () => {
    const fs = memoryBookFs({ 'source.fb2': new TextEncoder().encode(FB2) });
    const book = await importFb2(fs, 'source.fb2');

    expect(book.title).toBe('Война и мир');
    expect(book.authors).toEqual(['Лев Толстой']);
    expect(book.language).toBe('ru');
    expect(book.identifier).toBe('doc-42');
    expect(book.cover).toBe('images/cover.jpg');
    expect(await fs.readBinary('images/cover.jpg')).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    expect(book.spine.map((s) => s.href)).toEqual([
      'text/cover.xhtml',
      'text/ch001.xhtml',
      'text/ch002.xhtml',
      'text/ch003.xhtml',
      'text/ch004.xhtml',
    ]);
    expect(book.spine[4].linear).toBe(false);

    expect(book.toc.map((t) => t.label)).toEqual(['Часть 1', 'Часть 2', 'Примечания']);
    expect(book.toc[0].children).toEqual([{ label: 'Глава I', href: 'text/ch002.xhtml#s1', children: [] }]);

    const chapter = await fs.readText('text/ch002.xhtml');
    expect(chapter).toContain(INJECTED_TAGS);
    expect(chapter).toContain('<a href="ch004.xhtml#n1" class="note">1</a>');
    expect(chapter).toContain('&#38; <em>курсив</em>');
    const parsed = new DOMParser().parseFromString(chapter, 'application/xhtml+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);

    expect(await fs.readText('text/ch003.xhtml')).toContain('<img src="../images/pic.png" alt=""/>');
  });

  it('writes the cover first and tells it before converting the chapters', async () => {
    const fs = memoryBookFs({ 'source.fb2': new TextEncoder().encode(FB2) });
    const previews: unknown[] = [];
    await importFb2(fs, 'source.fb2', (preview) => previews.push({ ...preview, files: fs.files.filter((f) => f !== 'source.fb2') }));
    expect(previews).toEqual([{ title: 'Война и мир', authors: ['Лев Толстой'], cover: 'images/cover.jpg', files: ['images/cover.jpg'] }]);
  });

  it('decodes windows-1251 files using the XML declaration', () => {
    const head = new TextEncoder().encode('<?xml version="1.0" encoding="windows-1251"?><a>');
    const tail = new TextEncoder().encode('</a>');
    const bytes = new Uint8Array([...head, 0xcf, 0xf0, 0xe8, ...tail]);
    expect(decodeFb2(bytes)).toContain('<a>При</a>');
  });
});
