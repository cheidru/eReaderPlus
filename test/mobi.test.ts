import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { INJECTED_TAGS } from '../src/core/inject';
import { decompressPalmDoc, huffCdic, importMobi } from '../src/core/mobi';
import { splitFragment } from '../src/core/paths';
import type { TocItem } from '../src/core/types';

// Made by scripts/make-test-fixtures.mjs (Calibre) from one small EPUB: "Chapter One" with a figure and a
// footnote link to "Chapter Two", whose note links back.
const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/books/${name}`));

async function convert(name: string) {
  const fs = memoryBookFs({ 'source.mobi': fixture(name) });
  const result = await importMobi(fs, 'source.mobi', name);
  return { fs, ...result };
}

type Fs = Awaited<ReturnType<typeof convert>>['fs'];

/** Parses an output document; asserts that a book-root-relative href points at an existing file and element. */
async function expectTarget(fs: Fs, href: string): Promise<Document> {
  const [path, fragment] = splitFragment(href);
  expect(fs.files).toContain(path);
  const doc = new DOMParser().parseFromString(await fs.readText(path), 'text/html');
  if (fragment) expect(doc.getElementById(fragment), `#${fragment} in ${path}`).not.toBeNull();
  return doc;
}

const labels = (items: TocItem[]): unknown[] => items.map((i) => (i.children.length ? [i.label, labels(i.children)] : i.label));

/** Finds the output document containing `text`. */
async function findDocument(fs: Fs, spine: { href: string }[], text: string): Promise<{ path: string; doc: Document }> {
  for (const { href } of spine) {
    const doc = new DOMParser().parseFromString(await fs.readText(href), 'text/html');
    if (doc.body.textContent?.includes(text)) return { path: href, doc };
  }
  throw new Error(`No document contains ${text}`);
}

// Calibre's MOBI 6 writer flattens the outline (no parent entries in the NCX index).
const NESTED_TOC = [['Chapter One', ['The Figure']], 'Chapter Two'];
const FLAT_TOC = ['Chapter One', 'The Figure', 'Chapter Two'];

describe.each([
  ['sample.mobi', 'mobi', FLAT_TOC],
  ['sample.azw3', 'azw3', NESTED_TOC],
  ['sample-combo.mobi', 'azw3', NESTED_TOC],
])('%s', (name, expectedFormat, expectedToc) => {
  it('reads metadata and the cover', async () => {
    const { fs, format, parsed } = await convert(name);
    expect(format).toBe(expectedFormat);
    expect(parsed.title).toBe('Kindle Sample');
    expect(parsed.authors).toEqual(['eReaderPlus samples']);
    expect(parsed.language).toBe('en');
    expect(parsed.layout).toBe('reflowable');
    expect(parsed.cover).toMatch(/^images\/res\d+\.(png|jpg)$/);
    expect(fs.files).toContain(parsed.cover);
  });

  it('builds a TOC whose targets exist', async () => {
    const { fs, parsed } = await convert(name);
    expect(labels(parsed.toc)).toEqual(expectedToc);
    const all = (items: TocItem[]): TocItem[] => items.flatMap((i) => [i, ...all(i.children)]);
    for (const item of all(parsed.toc)) await expectTarget(fs, item.href);
    expect(parsed.spine.map((s) => s.href)).toContain(splitFragment(parsed.toc.at(-1)!.href)[0]);
  });

  it('writes HTML with the reader injected, working images and cross-document links', async () => {
    const { fs, parsed } = await convert(name);
    const first = await fs.readText(parsed.spine[0].href);
    expect(first.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(first).toContain(INJECTED_TAGS);
    expect(first).toContain('<meta charset="utf-8">');

    const { path: chapterOne, doc } = await findDocument(fs, parsed.spine, 'See the note');
    expect(doc.body.textContent).toContain('Ünïcödé');
    const img = doc.querySelector('img')!;
    expect(fs.files).toContain(`images/${img.getAttribute('src')!.replace('../images/', '')}`);

    const link = Array.from(doc.querySelectorAll('a')).find((a) => a.textContent === '[1]')!;
    const href = link.getAttribute('href')!;
    expect(href).not.toMatch(/^kindle:/);
    const target = await expectTarget(fs, href.startsWith('#') ? chapterOne + href : `text/${href}`);
    // The target is the note paragraph, or (MOBI 6) an anchor placed right before it.
    const anchor = target.getElementById(splitFragment(href)[1])!;
    const paragraphs = Array.from(target.querySelectorAll('p'));
    const note = paragraphs.find((p) => p.textContent?.includes('The note.'))!;
    const before = paragraphs.filter((p) => p.textContent?.startsWith('Paragraph 8')).pop()!;
    const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(note.contains(anchor) || follows(anchor, note)).toBe(true);
    expect(follows(before, anchor)).toBe(true);
  });
});

describe('MOBI', () => {
  it('refuses DRM-protected books', async () => {
    const bytes = fixture('sample.mobi');
    const record0 = new DataView(bytes.buffer).getUint32(78);
    bytes[record0 + 13] = 2; // PalmDOC header: encryption type
    const fs = memoryBookFs({ 'source.mobi': bytes });
    await expect(importMobi(fs, 'source.mobi', 'x.mobi')).rejects.toThrow(/DRM/);
  });

  it('rejects files that are not MOBI', async () => {
    const fs = memoryBookFs({ 'source.mobi': new Uint8Array(200) });
    await expect(importMobi(fs, 'source.mobi', 'x.mobi')).rejects.toThrow(/Not a MOBI file/);
  });

  it('decompresses PalmDOC (literals, raw runs, back-references, space + char)', () => {
    // "ab", 2 raw bytes, back-reference (distance 4, length 3), " c"
    const input = new Uint8Array([0x61, 0x62, 0x02, 0x00, 0x09, 0x80, 0x20, 0xe3]);
    expect(new TextDecoder().decode(decompressPalmDoc(input))).toBe('ab\u0000\tab\u0000 c');
  });

  it('decompresses HUFF/CDIC, including dictionary entries that are themselves compressed', () => {
    // Every code is 8 bits long and maps byte b to dictionary entry 255 - b.
    const huff = new Uint8Array(24 + 256 * 4 + 32 * 8);
    const hv = new DataView(huff.buffer);
    huff.set(new TextEncoder().encode('HUFF'));
    hv.setUint32(8, 24);
    hv.setUint32(12, 24 + 256 * 4);
    for (let i = 0; i < 256; i++) hv.setUint32(24 + i * 4, (255 << 8) | 0x80 | 8);

    const entries = new Map<number, [Uint8Array, boolean]>([
      [255 - 0x41, [new TextEncoder().encode('Hello '), true]],
      [255 - 0x42, [new Uint8Array([0x41, 0x41]), false]],
    ]);
    const table = new Uint8Array(256 * 2);
    const data: number[] = [];
    for (let code = 0; code < 256; code++) {
      new DataView(table.buffer).setUint16(code * 2, table.length + data.length);
      const [bytes, literal] = entries.get(code) ?? [new Uint8Array(0), true];
      data.push(((literal ? 0x8000 : 0) | bytes.length) >> 8, bytes.length & 0xff, ...bytes);
    }
    const cdic = new Uint8Array(16 + table.length + data.length);
    const cv = new DataView(cdic.buffer);
    cdic.set(new TextEncoder().encode('CDIC'));
    cv.setUint32(4, 16);
    cv.setUint32(8, 256);
    cv.setUint32(12, 8);
    cdic.set(table, 16);
    cdic.set(data, 16 + table.length);

    const decompress = huffCdic(huff, [cdic]);
    expect(new TextDecoder().decode(decompress(new Uint8Array([0x41, 0x42])))).toBe('Hello Hello Hello ');
  });
});
