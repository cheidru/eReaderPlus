import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { decodeText, frontMatter, importMarkdown, markdownFiles } from '../src/core/markdown';

const encode = (text: string) => new TextEncoder().encode(text);

describe('Markdown', () => {
  it('reads title, authors and language from front matter', () => {
    const { meta, body } = frontMatter('---\ntitle: "My Book"\nauthor:\n  - Ann\n  - Bob\nlang: ru\n---\n# Text\n');
    expect(meta).toEqual({ title: 'My Book', authors: ['Ann', 'Bob'], language: 'ru' });
    expect(body).toBe('# Text\n');
    expect(frontMatter('---\nauthors: [A, "B"]\n---\n').meta.authors).toEqual(['A', 'B']);
    expect(frontMatter('# No front matter').body).toBe('# No front matter');
  });

  it('decodes UTF-8 (with or without a byte order mark), and guesses legacy code pages', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...encode('Привет')]))).toBe('Привет');
    expect(decodeText(encode('Привет'))).toBe('Привет');
    // "Привет мир" in Windows-1251.
    expect(decodeText(new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0]))).toBe('Привет мир');
    // "café au lait" in Windows-1252.
    expect(decodeText(new Uint8Array([...encode('caf'), 0xe9, ...encode(' au lait')]))).toBe('café au lait');
  });

  it('converts a file into one chapter with GitHub-flavored Markdown and lists its headings', async () => {
    const source = '# The Title\n\nIntro.\n\n## Part One\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n### Detail\n\n~~old~~ [up](#the-title)\n\n## Part One\n';
    const fs = memoryBookFs({ 'source.md': encode(source) });
    const previews: unknown[] = [];
    const book = await importMarkdown(fs, ['source.md'], 'notes.md', (preview) => previews.push(preview));
    expect(book.title).toBe('The Title');
    expect(previews).toEqual([{ title: 'The Title', authors: [], cover: null }]);
    expect(book.identifier).toMatch(/^md:[0-9a-f]{64}$/);
    expect(book.layout).toBe('reflowable');
    expect(book.spine).toEqual([{ href: 'source.md.0001.html', linear: true }]);
    expect(book.toc).toEqual([
      {
        label: 'The Title',
        href: 'source.md.0001.html',
        children: [
          { label: 'Part One', href: 'source.md.0001.html#part-one', children: [{ label: 'Detail', href: 'source.md.0001.html#detail', children: [] }] },
          { label: 'Part One', href: 'source.md.0001.html#part-one-1', children: [] },
        ],
      },
    ]);
    const html = await fs.readText('source.md.0001.html');
    expect(html).toContain('<table>');
    expect(html).toContain('<del>old</del>');
    expect(html).toContain('href="source.md.0001.html#the-title"');
    expect(html).toContain('/__ereader__/paginator.js');
  });

  it('splits a long file into chapters at its top headings, keeping links between them', async () => {
    const filler = `${'Words to fill the chapter. '.repeat(40)}\n\n`.repeat(15);
    const source = `# Book\n\n## One\n\nSee [two](#two).\n\n${filler}## Two\n\n${filler}`;
    const fs = memoryBookFs({ 'source.md': encode(source) });
    const book = await importMarkdown(fs, ['source.md'], 'b.md');
    expect(book.spine.map((s) => s.href)).toEqual(['source.md.0001.html', 'source.md.0002.html']);
    expect(book.toc[0].children.map((c) => c.href)).toEqual(['source.md.0001.html#one', 'source.md.0002.html']);
    expect(await fs.readText('source.md.0001.html')).toContain('href="source.md.0002.html#two"');
  });

  it('reads the Markdown files of an archive in order, linking between them, with their images', async () => {
    expect(markdownFiles(['b/ch10.md', 'b/ch2.md', 'README.md', '.git/x.md', 'img/a.png'])).toEqual(['README.md', 'b/ch2.md', 'b/ch10.md']);
    const fs = memoryBookFs({
      'b/ch1.md': encode('# One\n\n![pic](../img/a.png) [next](ch2.md#end)'),
      'b/ch2.md': encode('# Two\n\n<a id="end"></a>The end.'),
      'img/a.png': new Uint8Array(1),
    });
    const book = await importMarkdown(fs, ['b/ch1.md', 'b/ch2.md'], 'book.zip');
    expect(book.title).toBe('One');
    expect(book.spine.map((s) => s.href)).toEqual(['b/ch1.md.0001.html', 'b/ch2.md.0002.html']);
    const first = await fs.readText('b/ch1.md.0001.html');
    expect(first).toContain('src="../img/a.png"');
    expect(first).toContain('href="ch2.md.0002.html#end"');
  });

  it('brings images from beside a single file into the book', async () => {
    const fs = memoryBookFs({ 'source.md': encode('![a](pics/a.png) ![b](pics/a.png) ![c](https://example.com/c.png)') });
    const copied: string[] = [];
    await importMarkdown(fs, ['source.md'], 'a.md', undefined, async (path) => void copied.push(path));
    expect(copied).toEqual(['pics/a.png']);
  });
});
