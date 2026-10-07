/**
 * MOBI 6 (.mobi, old .azw) and KF8 (.azw3, and the KF8 half of combined .mobi files) → HTML conversion.
 * Text sections become text/partNNNN.html, images go to images/, fonts to fonts/ and KF8 stylesheets to styles/.
 *
 * The binary parsing (PDB records, MOBI/EXTH headers, PalmDOC and HUFF/CDIC decompression, INDX tables,
 * KF8 skeleton/fragment reassembly) is adapted from foliate-js (https://github.com/johnfactotum/foliate-js):
 *
 *   Copyright (c) 2022 John Factotum
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 *   documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 *   the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 *   to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *   The above copyright notice and this permission notice shall be included in all copies or substantial portions
 *   of the Software.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 *   THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 *   CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 *   IN THE SOFTWARE.
 */
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { DrmError } from './fonts';
import { readerHtml } from './html';
import type { SpineItem, TocItem } from './types';

const NONE = 0xffffffff;

// --- Binary helpers -------------------------------------------------------------------------------

const u8 = (b: Uint8Array, o: number) => b[o] ?? 0;
const u16 = (b: Uint8Array, o: number) => (u8(b, o) << 8) | u8(b, o + 1);
const u32 = (b: Uint8Array, o: number) => o + 4 > b.length ? NONE : ((u8(b, o) << 24) | (u8(b, o + 1) << 16) | (u8(b, o + 2) << 8) | u8(b, o + 3)) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const latin1 = new TextDecoder('latin1');

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Forward variable-length integer: 7 bits per byte, the high bit marks the last byte. */
function varLen(b: Uint8Array, at: number): { value: number; length: number } {
  let value = 0;
  let length = 0;
  for (const byte of b.subarray(at, at + 4)) {
    value = (value << 7) | (byte & 0x7f);
    length++;
    if (byte & 0x80) break;
  }
  return { value, length };
}

/** Backward variable-length integer at the end of `b` (trailing entries). */
function varLenFromEnd(b: Uint8Array): number {
  let value = 0;
  let shift = 0;
  for (let i = b.length - 1; i >= 0; i--) {
    value |= (b[i] & 0x7f) << shift;
    shift += 7;
    if (b[i] & 0x80 || shift >= 28) break;
  }
  return value;
}

const bitCount = (x: number) => {
  let n = 0;
  for (; x > 0; x >>= 1) n += x & 1;
  return n;
};

const trailingZeros = (x: number) => {
  let n = 0;
  while (x !== 0 && (x & 1) === 0) (x >>= 1), n++;
  return n;
};

// --- Decompression --------------------------------------------------------------------------------

export function decompressPalmDoc(input: Uint8Array): Uint8Array {
  let out = new Uint8Array(Math.max(4096, input.length * 8));
  let o = 0;
  const ensure = (n: number) => {
    if (o + n <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, o + n));
    bigger.set(out);
    out = bigger;
  };
  for (let i = 0; i < input.length; i++) {
    const byte = input[i];
    if (byte >= 1 && byte <= 8) {
      ensure(byte);
      for (let j = 0; j < byte && i + 1 < input.length; j++) out[o++] = input[++i];
    } else if (byte < 0x80) {
      ensure(1);
      out[o++] = byte;
    } else if (byte < 0xc0) {
      const pair = (byte << 8) | u8(input, ++i);
      const distance = (pair & 0x3fff) >>> 3;
      const length = (pair & 7) + 3;
      ensure(length);
      for (let j = 0; j < length; j++) out[o] = out[o - distance] ?? 0, o++;
    } else {
      ensure(2);
      out[o++] = 0x20;
      out[o++] = byte ^ 0x80;
    }
  }
  return out.slice(0, o);
}

/** 32 bits starting at bit `pos` (big-endian), zero-padded past the end. */
function read32(b: Uint8Array, pos: number): number {
  const i = pos >>> 3;
  const shift = pos & 7;
  const hi = ((u8(b, i) << 24) | (u8(b, i + 1) << 16) | (u8(b, i + 2) << 8) | u8(b, i + 3)) >>> 0;
  return shift === 0 ? hi : ((hi << shift) | (u8(b, i + 4) >>> (8 - shift))) >>> 0;
}

export function huffCdic(huff: Uint8Array, cdics: Uint8Array[]): (input: Uint8Array) => Uint8Array {
  if (ascii(huff, 0, 4) !== 'HUFF') throw new Error('Invalid HUFF record');
  const offset1 = u32(huff, 8);
  const offset2 = u32(huff, 12);
  const table1 = Array.from({ length: 256 }, (_, i) => {
    const x = u32(huff, offset1 + i * 4);
    return { found: (x & 0x80) !== 0, codeLength: x & 0x1f, value: x >>> 8 };
  });
  // Indexed by code length, 1..32.
  const minCode = [0];
  const maxCode = [0];
  for (let i = 0; i < 32; i++) {
    minCode.push(u32(huff, offset2 + i * 8));
    maxCode.push(u32(huff, offset2 + i * 8 + 4));
  }

  const dictionary: { data: Uint8Array; done: boolean }[] = [];
  for (const cdic of cdics) {
    if (ascii(cdic, 0, 4) !== 'CDIC') throw new Error('Invalid CDIC record');
    const headerLength = u32(cdic, 4);
    const total = u32(cdic, 8);
    const codeLength = u32(cdic, 12);
    const body = cdic.subarray(headerLength);
    const n = Math.min(1 << codeLength, total - dictionary.length);
    for (let i = 0; i < n; i++) {
      const at = u16(body, i * 2);
      const x = u16(body, at);
      dictionary.push({ data: body.subarray(at + 2, at + 2 + (x & 0x7fff)), done: (x & 0x8000) !== 0 });
    }
  }

  const decompress = (input: Uint8Array): Uint8Array => {
    const parts: Uint8Array[] = [];
    const bitLength = input.length * 8;
    for (let pos = 0; pos < bitLength; ) {
      const bits = read32(input, pos);
      let { found, codeLength, value } = table1[bits >>> 24];
      if (!found) {
        while (codeLength < 32 && bits >>> (32 - codeLength) < minCode[codeLength]) codeLength++;
        value = maxCode[codeLength];
      }
      pos += codeLength;
      if (pos > bitLength) break;
      const entry = dictionary[value - (bits >>> (32 - codeLength))];
      if (!entry) throw new Error('Corrupt HUFF/CDIC data');
      if (!entry.done) {
        entry.data = decompress(entry.data);
        entry.done = true;
      }
      parts.push(entry.data);
    }
    return concat(parts);
  };
  return decompress;
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// --- PDB / MOBI headers ---------------------------------------------------------------------------

class Pdb {
  private readonly offsets: number[];
  readonly type: string;

  constructor(readonly data: Uint8Array) {
    if (data.length < 78) throw new Error('Not a MOBI file');
    this.type = ascii(data, 60, 8);
    const count = u16(data, 76);
    this.offsets = Array.from({ length: count }, (_, i) => u32(data, 78 + i * 8));
  }

  get count(): number {
    return this.offsets.length;
  }

  record(index: number): Uint8Array {
    if (index < 0 || index >= this.offsets.length) throw new RangeError(`Record ${index} is out of bounds`);
    const end = this.offsets[index + 1] ?? this.data.length;
    return this.data.subarray(this.offsets[index], Math.max(this.offsets[index], end));
  }
}

interface Exth {
  creator: string[];
  publisher?: string;
  description?: string;
  isbn?: string;
  asin?: string;
  title?: string;
  language?: string;
  boundary?: number;
  fixedLayout?: string;
  coverOffset?: number;
  thumbnailOffset?: number;
  direction?: string;
}

interface Header {
  compression: number;
  numTextRecords: number;
  encryption: number;
  encoding: number;
  uid: number;
  version: number;
  fullName: Uint8Array;
  language: string;
  resourceStart: number;
  huffcdic: number;
  numHuffcdic: number;
  trailingFlags: number;
  ncx: number;
  fdst: number;
  frag: number;
  skel: number;
  exth: Exth;
}

const MOBI_LANG: Record<number, string> = {
  1: 'ar', 2: 'bg', 3: 'ca', 4: 'zh', 5: 'cs', 6: 'da', 7: 'de', 8: 'el', 9: 'en', 10: 'es', 11: 'fi', 12: 'fr',
  13: 'he', 14: 'hu', 15: 'is', 16: 'it', 17: 'ja', 18: 'ko', 19: 'nl', 20: 'no', 21: 'pl', 22: 'pt', 23: 'rm',
  24: 'ro', 25: 'ru', 26: 'hr', 27: 'sk', 28: 'sq', 29: 'sv', 30: 'th', 31: 'tr', 32: 'ur', 33: 'id', 34: 'uk',
  35: 'be', 36: 'sl', 37: 'et', 38: 'lv', 39: 'lt', 41: 'fa', 42: 'vi', 43: 'hy', 44: 'az', 45: 'eu', 47: 'mk',
  54: 'af', 55: 'ka', 56: 'fo', 57: 'hi', 58: 'mt', 62: 'ms', 63: 'kk', 65: 'sw', 67: 'uz', 68: 'tt', 69: 'bn',
  70: 'pa', 71: 'gu', 73: 'ta', 74: 'te', 75: 'kn', 76: 'ml', 78: 'mr', 79: 'sa', 82: 'cy', 83: 'gl', 97: 'ne',
};

function textDecoder(encoding: number): TextDecoder {
  return new TextDecoder(encoding === 65001 ? 'utf-8' : 'windows-1252');
}

function parseExth(b: Uint8Array, decoder: TextDecoder): Exth {
  const exth: Exth = { creator: [] };
  if (ascii(b, 0, 4) !== 'EXTH') return exth;
  const count = u32(b, 8);
  let at = 12;
  for (let i = 0; i < count && at + 8 <= b.length; i++) {
    const type = u32(b, at);
    const length = u32(b, at + 4);
    if (length < 8) break;
    const data = b.subarray(at + 8, at + length);
    const str = () => decoder.decode(data).replace(/\0+$/, '').trim();
    const uint = () => (data.length >= 4 ? u32(data, 0) : NONE);
    switch (type) {
      case 100: exth.creator.push(str()); break;
      case 101: exth.publisher = str(); break;
      case 103: exth.description = str(); break;
      case 104: exth.isbn = str(); break;
      case 113: exth.asin = str(); break;
      case 121: exth.boundary = uint(); break;
      case 122: exth.fixedLayout = str(); break;
      case 201: exth.coverOffset = uint(); break;
      case 202: exth.thumbnailOffset = uint(); break;
      case 503: exth.title = str(); break;
      case 524: exth.language ??= str(); break;
      case 527: exth.direction = str(); break;
    }
    at += length;
  }
  return exth;
}

function parseHeader(record0: Uint8Array): Header {
  if (ascii(record0, 16, 4) !== 'MOBI') throw new Error('Missing MOBI header');
  const length = u32(record0, 20);
  const encoding = u32(record0, 28);
  const exthFlag = u32(record0, 128);
  const exth = exthFlag & 0x40 ? parseExth(record0.subarray(16 + length), textDecoder(encoding)) : { creator: [] };
  const titleOffset = u32(record0, 84);
  // Fields beyond the declared header length are garbage (or the EXTH block).
  const field = (offset: number) => (offset + 4 <= 16 + length ? u32(record0, offset) : NONE);
  return {
    compression: u16(record0, 0),
    numTextRecords: u16(record0, 8),
    encryption: u16(record0, 12),
    encoding,
    uid: u32(record0, 32),
    version: u32(record0, 36),
    fullName: record0.subarray(titleOffset, titleOffset + u32(record0, 88)),
    language: MOBI_LANG[u8(record0, 95)] ?? '',
    resourceStart: field(108),
    huffcdic: field(112),
    numHuffcdic: field(116),
    trailingFlags: length >= 0xe4 ? u16(record0, 0xf2) : 0,
    ncx: field(0xf4),
    fdst: field(0xc0),
    frag: field(0xf8),
    skel: field(0xfc),
    exth,
  };
}

/** Record access for one MOBI header: text and index records are relative to its record 0. */
class MobiBook {
  readonly decoder: TextDecoder;
  private decompress!: (b: Uint8Array) => Uint8Array;

  constructor(
    readonly pdb: Pdb,
    readonly header: Header,
    /** Record index of this header's record 0 (non-zero for the KF8 part of a combined file). */
    readonly start: number,
    /** Absolute record index of the first image/font resource. */
    readonly resourceStart: number,
  ) {
    this.decoder = textDecoder(header.encoding);
    if (header.encryption !== 0) throw new DrmError();
  }

  init(): this {
    const { compression } = this.header;
    if (compression === 1) this.decompress = (b) => b;
    else if (compression === 2) this.decompress = decompressPalmDoc;
    else if (compression === 17480) {
      const cdics = Array.from({ length: Math.max(0, this.header.numHuffcdic - 1) }, (_, i) => this.record(this.header.huffcdic + 1 + i));
      this.decompress = huffCdic(this.record(this.header.huffcdic), cdics);
    } else throw new Error(`Unknown MOBI compression type ${compression}`);
    return this;
  }

  record(index: number): Uint8Array {
    return this.pdb.record(this.start + index);
  }

  /** The whole text flow, with each record's trailing entries removed. */
  text(): Uint8Array {
    const flags = this.header.trailingFlags;
    const entries = bitCount(flags >>> 1);
    const parts: Uint8Array[] = [];
    for (let i = 1; i <= this.header.numTextRecords; i++) {
      let data = this.record(i);
      for (let e = 0; e < entries; e++) {
        const size = varLenFromEnd(data);
        data = data.subarray(0, Math.max(0, data.length - size));
      }
      if (flags & 1 && data.length > 0) data = data.subarray(0, Math.max(0, data.length - ((data[data.length - 1] & 3) + 1)));
      parts.push(this.decompress(data));
    }
    return concat(parts);
  }

  /** A resource record, 0-based from the first resource. Null for non-media records. */
  async resource(index: number): Promise<{ data: Uint8Array; ext: string } | null> {
    let data: Uint8Array;
    try {
      data = this.pdb.record(this.resourceStart + index);
    } catch {
      return null;
    }
    const magic = ascii(data, 0, 4);
    if (magic === 'FONT') {
      const font = await decodeFont(data);
      return { data: font, ext: fontExtension(font) };
    }
    if (magic === 'VIDE' || magic === 'AUDI') {
      const media = data.subarray(12);
      return { data: media, ext: ascii(media, 4, 4) === 'ftyp' ? 'mp4' : 'mp3' };
    }
    const ext = imageExtension(data);
    return ext ? { data, ext } : null;
  }

  title(): string {
    return unescapeHtml(this.header.exth.title || this.decoder.decode(this.header.fullName)) || '';
  }
}

async function decodeFont(record: Uint8Array): Promise<Uint8Array> {
  const flags = u32(record, 8);
  const dataStart = u32(record, 12);
  const keyLength = u32(record, 16);
  const keyStart = u32(record, 20);
  const font = record.slice(dataStart);
  if (flags & 2 && keyLength > 0) {
    const key = record.subarray(keyStart, keyStart + keyLength);
    const n = Math.min(keyLength === 16 ? 1024 : 1040, font.length);
    for (let i = 0; i < n; i++) font[i] ^= key[i % key.length];
  }
  if (flags & 1) {
    try {
      return await inflateZlib(font);
    } catch {
      // Keep the raw bytes; the browser ignores a font it cannot parse.
    }
  }
  return font;
}

function imageExtension(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (ascii(b, 1, 3) === 'PNG') return 'png';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (/^\s*(<\?xml|<svg)/.test(latin1.decode(b.subarray(0, 64)))) return 'svg';
  return null;
}

function fontExtension(b: Uint8Array): string {
  const magic = ascii(b, 0, 4);
  if (magic === 'OTTO') return 'otf';
  if (magic === 'wOFF') return 'woff';
  if (magic === 'wOF2') return 'woff2';
  return 'ttf';
}

function unescapeHtml(s: string | undefined): string {
  if (!s) return '';
  return (new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? '').trim();
}

// --- INDX tables ----------------------------------------------------------------------------------

interface IndexEntry {
  name: string;
  tags: Map<number, number[]>;
}

function readIndex(book: MobiBook, indexRecord: number): { entries: IndexEntry[]; cncx: Map<number, string> } {
  const first = book.record(indexRecord);
  if (ascii(first, 0, 4) !== 'INDX') throw new Error('Invalid INDX record');
  const headerLength = u32(first, 4);
  const numRecords = u32(first, 24);
  const decoder = textDecoder(u32(first, 28));
  const numCncx = u32(first, 52);

  const tagx = first.subarray(headerLength);
  if (ascii(tagx, 0, 4) !== 'TAGX') throw new Error('Invalid TAGX section');
  const tagxLength = u32(tagx, 4);
  const controlBytes = u32(tagx, 8);
  const tagTable: [tag: number, valuesPerEntry: number, mask: number, end: number][] = [];
  for (let at = 12; at + 4 <= tagxLength; at += 4) tagTable.push([tagx[at], tagx[at + 1], tagx[at + 2], tagx[at + 3]]);

  const cncx = new Map<number, string>();
  for (let i = 0; i < numCncx; i++) {
    const record = book.record(indexRecord + numRecords + 1 + i);
    for (let pos = 0; pos < record.length; ) {
      const start = pos;
      const { value, length } = varLen(record, pos);
      pos += length;
      if (length === 0) break;
      cncx.set(i * 0x10000 + start, decoder.decode(record.subarray(pos, pos + value)));
      pos += value;
    }
  }

  const entries: IndexEntry[] = [];
  for (let r = 0; r < numRecords; r++) {
    const record = book.record(indexRecord + 1 + r);
    if (ascii(record, 0, 4) !== 'INDX') throw new Error('Invalid INDX record');
    const idxt = u32(record, 20);
    const count = u32(record, 24);
    for (let j = 0; j < count; j++) {
      const offset = u16(record, idxt + 4 + 2 * j);
      const nameLength = record[offset];
      const name = latin1.decode(record.subarray(offset + 1, offset + 1 + nameLength));
      const start = offset + 1 + nameLength;
      let pos = start + controlBytes;
      let controlIndex = 0;
      const pending: [tag: number, count: number | null, bytes: number | null, perEntry: number][] = [];
      for (const [tag, perEntry, mask, end] of tagTable) {
        if (end & 1) {
          controlIndex++;
          continue;
        }
        const value = record[start + controlIndex] & mask;
        if (value === mask) {
          if (bitCount(mask) > 1) {
            const v = varLen(record, pos);
            pending.push([tag, null, v.value, perEntry]);
            pos += v.length;
          } else pending.push([tag, 1, null, perEntry]);
        } else if (value !== 0) {
          pending.push([tag, value >> trailingZeros(mask), null, perEntry]);
        }
      }
      const tags = new Map<number, number[]>();
      for (const [tag, n, bytes, perEntry] of pending) {
        const values: number[] = [];
        if (n !== null) {
          for (let k = 0; k < n * perEntry; k++) {
            const v = varLen(record, pos);
            values.push(v.value);
            pos += v.length;
          }
        } else {
          for (let consumed = 0; consumed < (bytes ?? 0); ) {
            const v = varLen(record, pos);
            values.push(v.value);
            pos += v.length;
            consumed += v.length;
          }
        }
        tags.set(tag, values);
      }
      entries.push({ name, tags });
    }
  }
  return { entries, cncx };
}

interface NcxEntry {
  label: string;
  /** MOBI 6: byte offset in the text. */
  offset?: number;
  /** KF8: [fragment id, offset in fragment]. */
  pos?: number[];
  children: NcxEntry[];
}

function readNcx(book: MobiBook): NcxEntry[] {
  if (book.header.ncx === NONE) return [];
  const { entries, cncx } = readIndex(book, book.header.ncx);
  const items = entries.map((e) => ({
    label: unescapeHtml(cncx.get(e.tags.get(3)?.[0] ?? -1)) || '…',
    offset: e.tags.get(1)?.[0],
    pos: e.tags.get(6),
    parent: e.tags.get(21)?.[0],
    children: [] as NcxEntry[],
  }));
  const roots: NcxEntry[] = [];
  for (const item of items) {
    const parent = item.parent !== undefined ? items[item.parent] : undefined;
    (parent && parent !== item ? parent.children : roots).push(item);
  }
  return roots;
}

// --- Output ---------------------------------------------------------------------------------------

const MOBI6_CSS = 'blockquote { margin: 0 0 0 1em; } img { max-width: 100%; }';

const partPath = (i: number) => `text/part${String(i).padStart(4, '0')}.html`;

class ResourceWriter {
  private written = new Map<number, string | null>();

  constructor(
    private fs: BookFs,
    private book: MobiBook,
  ) {}

  /** Writes resource `index` (0-based) once and returns its book-root-relative path. */
  async path(index: number): Promise<string | null> {
    if (this.written.has(index)) return this.written.get(index)!;
    const resource = await this.book.resource(index);
    let path: string | null = null;
    if (resource) {
      const isFont = ['ttf', 'otf', 'woff', 'woff2'].includes(resource.ext);
      path = `${isFont ? 'fonts' : 'images'}/res${String(index + 1).padStart(5, '0')}.${resource.ext}`;
      await this.fs.writeBinary(path, resource.data);
    }
    this.written.set(index, path);
    return path;
  }

  async cover(): Promise<string | null> {
    const { coverOffset, thumbnailOffset } = this.book.header.exth;
    for (const offset of [coverOffset, thumbnailOffset]) {
      if (offset === undefined || offset === NONE) continue;
      const path = await this.path(offset);
      if (path?.startsWith('images/')) return path;
    }
    return null;
  }
}

function metadata(book: MobiBook, fallbackTitle: string) {
  const { exth } = book.header;
  const title = book.title() || fallbackTitle;
  const authors = exth.creator.map(unescapeHtml).filter(Boolean);
  return {
    title,
    authors,
    language: exth.language || book.header.language,
    identifier: exth.asin || exth.isbn || `mobi:${book.header.uid}|${title}|${authors.join(',')}`,
  };
}

// --- MOBI 6 ---------------------------------------------------------------------------------------

const PAGEBREAK = /<\s*(?:mbp:)?pagebreak[^>]*>/gi;
const FILEPOS = /<[^<>]+filepos\s*=\s*['"]?0*(\d+)/gi;

async function convertMobi6(fs: BookFs, book: MobiBook, fallbackTitle: string): Promise<ParsedBook> {
  const raw = book.text();
  const str = latin1.decode(raw);
  const breaks = [0, ...Array.from(str.matchAll(PAGEBREAK), (m) => m.index)].filter((x, i, a) => i === 0 || x > a[i - 1]);
  const sections = breaks.map((start, i) => ({ start, end: breaks[i + 1] ?? raw.length }));

  const ncx = readNcx(book);
  const targets = new Set<number>(Array.from(str.matchAll(FILEPOS), (m) => Number(m[1])));
  const collect = (items: NcxEntry[]) => items.forEach((e) => (e.offset !== undefined && targets.add(e.offset), collect(e.children)));
  collect(ncx);
  const sorted = [...targets].filter((t) => t < raw.length).sort((a, b) => a - b);

  const resources = new ResourceWriter(fs, book);
  const docs: Document[] = [];
  let guideTocFilepos: number | null = null;
  for (const section of sections) {
    // Anchor elements make filepos targets addressable once the section is a document of its own.
    const parts: Uint8Array[] = [];
    let at = section.start;
    for (const target of sorted) {
      if (target < section.start || target >= section.end) continue;
      parts.push(raw.subarray(at, target), new TextEncoder().encode(`<a id="filepos${target}"></a>`));
      at = target;
    }
    parts.push(raw.subarray(at, section.end));
    const source = book.decoder.decode(concat(parts)).replace(PAGEBREAK, '');
    const doc = new DOMParser().parseFromString(source, 'text/html');
    for (const ref of Array.from(doc.querySelectorAll('guide reference[filepos]'))) {
      if (/\btoc\b/i.test(ref.getAttribute('type') ?? '')) guideTocFilepos ??= Number(ref.getAttribute('filepos'));
    }
    doc.querySelectorAll('guide').forEach((g) => g.remove());
    docs.push(doc);
  }

  const keep = docs.map((d) => (d.body?.textContent ?? '').trim() !== '' || d.querySelector('img, svg, hr, table') !== null);
  if (!keep.some(Boolean)) throw new Error('The book has no content');
  const outputIndex: number[] = [];
  let next = 0;
  for (const k of keep) outputIndex.push(k ? next++ : -1);

  /** Book-root-relative href for a text position. */
  const hrefFor = (filepos: number): string => {
    let s = sections.findIndex((sec) => filepos >= sec.start && filepos < sec.end);
    if (s < 0) s = sections.length - 1;
    if (keep[s]) return `${partPath(outputIndex[s])}#filepos${filepos}`;
    const later = keep.findIndex((k, i) => k && i > s);
    const target = later >= 0 ? later : keep.lastIndexOf(true);
    return partPath(outputIndex[target]);
  };

  const toNcxToc = (items: NcxEntry[]): TocItem[] =>
    items.map((e) => ({ label: e.label, href: e.offset !== undefined ? hrefFor(e.offset) : '', children: toNcxToc(e.children) }));
  // Without an NCX index, the links on the page the guide's "toc" reference points to are the TOC.
  // Read before the links are rewritten below.
  let toc = toNcxToc(ncx);
  if (toc.length === 0 && guideTocFilepos !== null) {
    const s = sections.findIndex((sec) => guideTocFilepos! >= sec.start && guideTocFilepos! < sec.end);
    toc = Array.from(docs[s]?.querySelectorAll('a[filepos]') ?? []).flatMap((a) => {
      const label = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
      return label ? [{ label, href: hrefFor(Number(a.getAttribute('filepos'))), children: [] }] : [];
    });
  }

  const spine: SpineItem[] = [];
  for (const [i, doc] of docs.entries()) {
    if (!keep[i]) continue;
    const path = partPath(outputIndex[i]);
    for (const img of Array.from(doc.querySelectorAll('[recindex], [mediarecindex]'))) {
      const media = img.getAttribute('mediarecindex');
      const poster = img.getAttribute('recindex');
      if (media) {
        const src = await resources.path(Number(media) - 1);
        if (src) img.setAttribute('src', `../${src}`);
        if (poster) {
          const p = await resources.path(Number(poster) - 1);
          if (p) img.setAttribute('poster', `../${p}`);
        }
      } else if (poster) {
        const src = await resources.path(Number(poster) - 1);
        if (src) img.setAttribute('src', `../${src}`);
      }
      img.removeAttribute('recindex');
      img.removeAttribute('mediarecindex');
    }
    // Kindle markup for first-line indent and space above a paragraph.
    for (const p of Array.from(doc.querySelectorAll('p[width], p[height]'))) {
      const indent = p.getAttribute('width');
      const above = p.getAttribute('height');
      if (indent && /^-?[\d.]+(em|pt|px|%)?$/.test(indent)) (p as HTMLElement).style.textIndent = /\d$/.test(indent) ? `${indent}px` : indent;
      if (above && /^[\d.]+(em|pt|px|%)?$/.test(above)) (p as HTMLElement).style.marginTop = /\d$/.test(above) ? `${above}px` : above;
      p.removeAttribute('width');
      p.removeAttribute('height');
    }
    for (const link of Array.from(doc.querySelectorAll('[filepos]'))) {
      const href = hrefFor(Number(link.getAttribute('filepos')));
      link.removeAttribute('filepos');
      if (link.localName === 'a') link.setAttribute('href', href.startsWith(`${path}#`) ? href.slice(path.length) : href.slice('text/'.length));
    }
    if (!doc.title) doc.title = `${i + 1}`;
    await fs.writeText(path, readerHtml(doc, MOBI6_CSS));
    spine.push({ href: path, linear: true });
  }

  return {
    ...metadata(book, fallbackTitle),
    cover: await resources.cover(),
    layout: 'reflowable',
    direction: 'ltr',
    spine,
    toc,
  };
}

// --- KF8 ------------------------------------------------------------------------------------------

const KINDLE_RESOURCE = /kindle:(flow|embed):([0-9A-Va-v]+)(?:\?mime=([\w+./-]+))?/g;
const KINDLE_POS = /^kindle:pos:fid:([0-9A-Va-v]+):off:([0-9A-Va-v]+)/;

interface Fragment {
  insertAt: number;
  id: number;
  offset: number;
  length: number;
}

interface Section {
  offset: number;
  skeletonLength: number;
  frags: Fragment[];
}

async function convertKf8(fs: BookFs, book: MobiBook, fallbackTitle: string): Promise<ParsedBook> {
  const { header } = book;
  const raw = book.text();

  const flows: [number, number][] = [];
  if (header.fdst !== NONE) {
    const fdst = book.record(header.fdst);
    if (ascii(fdst, 0, 4) === 'FDST') {
      const count = u32(fdst, 8);
      for (let i = 0; i < count; i++) flows.push([u32(fdst, 12 + i * 8), u32(fdst, 16 + i * 8)]);
    }
  }
  if (flows.length === 0) flows.push([0, raw.length]);

  const skeletons = readIndex(book, header.skel).entries.map((e) => ({
    numFrags: e.tags.get(1)?.[0] ?? 0,
    offset: e.tags.get(6)?.[0] ?? 0,
    length: e.tags.get(6)?.[1] ?? 0,
  }));
  const fragIndex = readIndex(book, header.frag);
  const frags: Fragment[] = fragIndex.entries.map((e) => ({
    insertAt: Number.parseInt(e.name, 10),
    id: e.tags.get(4)?.[0] ?? 0,
    offset: e.tags.get(6)?.[0] ?? 0,
    length: e.tags.get(6)?.[1] ?? 0,
  }));

  const sections: Section[] = [];
  let fragStart = 0;
  for (const skel of skeletons) {
    sections.push({ offset: skel.offset, skeletonLength: skel.length, frags: frags.slice(fragStart, fragStart + skel.numFrags) });
    fragStart += skel.numFrags;
  }

  const sectionBytes = (s: Section): Uint8Array => {
    let assembled: Uint8Array = raw.slice(s.offset, s.offset + s.skeletonLength);
    let fragAt = s.offset + s.skeletonLength;
    for (const frag of s.frags) {
      const data = raw.subarray(fragAt, fragAt + frag.length);
      fragAt += frag.length;
      const insert = Math.min(Math.max(0, frag.insertAt - s.offset), assembled.length);
      assembled = concat([assembled.subarray(0, insert), data, assembled.subarray(insert)]);
    }
    return assembled;
  };

  // Fragment id → section and the fragment's raw start, for kindle:pos links.
  const fragLocation = new Map<number, { section: number; start: number }>();
  for (const [i, s] of sections.entries()) {
    let at = s.offset + s.skeletonLength;
    for (const frag of s.frags) {
      fragLocation.set(frag.id, { section: i, start: at });
      at += frag.length;
    }
  }

  /** Ids (or aid values, which need an id assigned) that link targets point at, per section. */
  const neededAids = new Map<number, Set<string>>();
  const resolvePos = (fid: number, off: number): { section: number; attr: 'id' | 'name' | 'aid' | null; value: string } | null => {
    const location = fragLocation.get(fid);
    if (!location) return null;
    const window = raw.subarray(location.start + off, location.start + off + 2048);
    const tag = /^[^<]*<[^>]*>/.exec(book.decoder.decode(window))?.[0] ?? '';
    for (const attr of ['id', 'name', 'aid'] as const) {
      const value = new RegExp(`\\s${attr}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
      if (value) {
        if (attr === 'aid') {
          if (!neededAids.has(location.section)) neededAids.set(location.section, new Set());
          neededAids.get(location.section)!.add(value);
        }
        return { section: location.section, attr, value };
      }
    }
    return { section: location.section, attr: null, value: '' };
  };
  const parsePos = (href: string) => {
    const m = KINDLE_POS.exec(href);
    return m ? resolvePos(Number.parseInt(m[1], 32), Number.parseInt(m[2], 32)) : null;
  };

  const resources = new ResourceWriter(fs, book);
  const writtenFlows = new Map<number, string | null>();
  const svgFlows = new Map<string, string>();

  const flowPath = async (index: number, mime: string | undefined): Promise<string | null> => {
    if (writtenFlows.has(index)) return writtenFlows.get(index)!;
    const range = flows[index];
    let path: string | null = null;
    if (range) {
      const isSvg = mime === 'image/svg+xml';
      path = `styles/flow${String(index).padStart(4, '0')}.${isSvg ? 'svg' : 'css'}`;
      writtenFlows.set(index, path);
      const text = await replaceResources(book.decoder.decode(raw.subarray(range[0], range[1])));
      if (isSvg) svgFlows.set(`../${path}`, text);
      await fs.writeText(path, text);
    }
    writtenFlows.set(index, path);
    return path;
  };

  /** Replaces kindle:embed and kindle:flow URIs with paths relative to text/ and styles/ (same depth). */
  const replaceResources = async (text: string): Promise<string> => {
    const replacements = new Map<string, string>();
    for (const m of text.matchAll(KINDLE_RESOURCE)) {
      if (replacements.has(m[0])) continue;
      const id = Number.parseInt(m[2], 32);
      const path = m[1] === 'flow' ? await flowPath(id, m[3]) : await resources.path(id - 1);
      replacements.set(m[0], path ? `../${path}` : '');
    }
    return text.replace(KINDLE_RESOURCE, (m) => replacements.get(m) ?? '');
  };

  // Parse every section first: link targets in one section may need ids assigned in another.
  const docs: (Document | null)[] = [];
  const pendingLinks: { doc: number; el: Element; attr: string; target: NonNullable<ReturnType<typeof resolvePos>> }[] = [];
  for (const [i, s] of sections.entries()) {
    if (s.frags.length === 0) {
      docs.push(null);
      continue;
    }
    const source = await replaceResources(book.decoder.decode(sectionBytes(s)));
    let doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement?.namespaceURI) {
      doc = new DOMParser().parseFromString(source, 'text/html');
    }
    docs.push(doc);

    // SVG loaded through <img> cannot load its own images, so SVG flows are inlined.
    for (const img of Array.from(doc.getElementsByTagName('img'))) {
      const svg = svgFlows.get(img.getAttribute('src') ?? '');
      if (!svg) continue;
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
      if (parsed.getElementsByTagName('parsererror').length === 0) img.replaceWith(doc.importNode(parsed.documentElement, true));
    }

    for (const el of Array.from(doc.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (!attr.value.startsWith('kindle:pos:')) continue;
        const target = parsePos(attr.value);
        if (target) pendingLinks.push({ doc: i, el, attr: attr.name, target });
        else el.removeAttribute(attr.name);
      }
    }
  }

  const kept = docs.map((d) => d !== null);
  if (!kept.some(Boolean)) throw new Error('The book has no content');
  const outputIndex: number[] = [];
  let next = 0;
  for (const k of kept) outputIndex.push(k ? next++ : -1);

  // Resolved before ids are assigned, since TOC targets can need ids too.
  type TocTarget = { label: string; target: ReturnType<typeof resolvePos>; children: TocTarget[] };
  const tocTargets = (items: NcxEntry[]): TocTarget[] =>
    items.map((e) => ({
      label: e.label,
      target: e.pos && e.pos.length >= 2 ? resolvePos(e.pos[0], e.pos[1]) : null,
      children: tocTargets(e.children),
    }));
  const ncx = tocTargets(readNcx(book));

  // aid → element id, per section.
  const aidIds = new Map<number, Map<string, string>>();
  for (const [section, aids] of neededAids) {
    const doc = docs[section];
    if (!doc) continue;
    const map = new Map<string, string>();
    for (const el of Array.from(doc.querySelectorAll('[aid]'))) {
      const aid = el.getAttribute('aid')!;
      if (!aids.has(aid) || map.has(aid)) continue;
      if (!el.id) el.id = `aid-${aid}`;
      map.set(aid, el.id);
    }
    aidIds.set(section, map);
  }

  const hrefFor = (target: NonNullable<ReturnType<typeof resolvePos>>): string => {
    const s = outputIndex[target.section] >= 0 ? target.section : kept.findIndex((k, i) => k && i > target.section);
    if (s < 0) return '';
    const fragment = target.attr === 'aid' ? aidIds.get(target.section)?.get(target.value) : target.attr ? target.value : undefined;
    return partPath(outputIndex[s]) + (fragment && s === target.section ? `#${fragment}` : '');
  };

  for (const link of pendingLinks) {
    const href = hrefFor(link.target);
    const own = partPath(outputIndex[link.doc]);
    link.el.setAttribute(link.attr, href.startsWith(`${own}#`) ? href.slice(own.length) : href.slice('text/'.length));
  }

  const spine: SpineItem[] = [];
  for (const [i, doc] of docs.entries()) {
    if (!doc) continue;
    const path = partPath(outputIndex[i]);
    await fs.writeText(path, readerHtml(doc));
    spine.push({ href: path, linear: true });
  }

  const toToc = (items: TocTarget[]): TocItem[] =>
    items.map((e) => ({ label: e.label, href: e.target ? hrefFor(e.target) : '', children: toToc(e.children) }));

  return {
    ...metadata(book, fallbackTitle),
    cover: await resources.cover(),
    layout: header.exth.fixedLayout === 'true' ? 'pre-paginated' : 'reflowable',
    direction: header.exth.direction === 'rtl' ? 'rtl' : 'ltr',
    spine,
    toc: toToc(ncx),
  };
}

// --- Entry point ----------------------------------------------------------------------------------

/** Converts the MOBI/AZW/AZW3 file at `sourcePath` into HTML sections inside the book folder. */
export async function importMobi(fs: BookFs, sourcePath: string, fileName: string): Promise<{ format: 'mobi' | 'azw3'; parsed: ParsedBook }> {
  const pdb = new Pdb(await fs.readBinary(sourcePath));
  if (pdb.type === 'TEXtREAd') throw new Error('Plain PalmDOC files are not supported');
  if (pdb.type !== 'BOOKMOBI') throw new Error(`Not a MOBI file: ${fileName}`);
  const fallbackTitle = fileName.replace(/\.[^.]+$/, '');

  const header = parseHeader(pdb.record(0));
  const mobi6 = new MobiBook(pdb, header, 0, header.resourceStart);
  if (header.version >= 8) {
    return { format: 'azw3', parsed: await convertKf8(fs, mobi6.init(), fallbackTitle) };
  }
  const boundary = header.exth.boundary;
  if (boundary !== undefined && boundary !== NONE && boundary < pdb.count) {
    let kf8: MobiBook | null = null;
    try {
      kf8 = new MobiBook(pdb, parseHeader(pdb.record(boundary)), boundary, header.resourceStart).init();
    } catch (error) {
      if (error instanceof DrmError) throw error;
    }
    if (kf8) {
      try {
        return { format: 'azw3', parsed: await convertKf8(fs, kf8, fallbackTitle) };
      } catch (error) {
        console.warn('KF8 part could not be converted, falling back to MOBI 6:', error);
      }
    }
  }
  return { format: 'mobi', parsed: await convertMobi6(fs, mobi6.init(), fallbackTitle) };
}
