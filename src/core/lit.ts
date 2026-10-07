/**
 * Microsoft Reader LIT → HTML. A port of Calibre's LIT reader (src/calibre/ebooks/lit/reader.py,
 * GPL-3.0, Kovid Goyal and Marshall T. Vandegrift), which follows ConvertLIT by Dan A. Jackson.
 *
 * A LIT file is an ITSS-style container: a directory of named entries stored in sections that may be
 * LZX-compressed (vendor/chmlib-lzx). Documents are stored as "binary HTML": a token stream of tag and
 * attribute codes (src/core/lit-maps.ts), which is rebuilt here directly into DOM nodes.
 *
 * Nearly every LIT file is "sealed" (DRM level 1) or "inscribed" (level 3): DES-encrypted with a key derived
 * from the file itself, so that any copy of Microsoft Reader can open it. Those are decrypted, like EPUB
 * font obfuscation. "Owner exclusive" books (level 5), tied to the buyer's activated Reader, are refused.
 */
import { DECR_OK, LZXState, lzxDecompress } from '../../vendor/chmlib-lzx/lzx.js';
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { DrmError, sha256Hex } from './fonts';
import { readerHtml } from './html';
import { desDecrypt, msSha1 } from './lit-crypto';
import { HTML_MAP, OPF_MAP, type LitMap } from './lit-maps';
import { dirname, encodePath, extension, normalize, relativePath, resolveHref, splitFragment } from './paths';
import type { SpineItem, TocItem } from './types';

const LZXCOMPRESS_GUID = '{0A9007C6-4076-11D3-8789-0000F8105754}';
const DESENCRYPT_GUID = '{67F6E4A2-60BF-11D3-8540-00C04F58C3CF}';

const FLAG_OPENING = 1;
const FLAG_CLOSING = 2;
const FLAG_ATOM = 16;

class LitError extends Error {}

const u16 = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
const i32 = (b: Uint8Array, o: number) => u32(b, o) | 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const hex = (n: number, width: number) => n.toString(16).toUpperCase().padStart(width, '0');

function msguid(b: Uint8Array): string {
  const bytes = Array.from(b.subarray(8, 16), (x) => hex(x, 2));
  return `{${hex(u32(b, 0), 8)}-${hex(u16(b, 4), 4)}-${hex(u16(b, 6), 4)}-${bytes.slice(0, 2).join('')}-${bytes.slice(2).join('')}}`;
}

/** Big-endian 7-bit variable-length integer (directory entries). */
function encint(b: Uint8Array, pos: number): [value: number, pos: number] {
  let value = 0;
  while (pos < b.length) {
    const byte = b[pos++];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return [value, pos];
}

/** One UTF-8 encoded value. Token streams use the encoding for numbers (tag and attribute codes) as well as text. */
function readChar(b: Uint8Array, pos: number): [code: number, pos: number] {
  let c = b[pos];
  if (c === undefined) throw new LitError('Unexpected end of data');
  if ((c & 0x80) === 0) return [c, pos + 1];
  let mask = 0x80;
  let size = 0;
  while (c & mask) {
    mask >>= 1;
    size++;
  }
  if (mask <= 1 || mask === 0x40 || pos + size > b.length) throw new LitError('Invalid UTF-8 character');
  c &= mask - 1;
  for (let i = 1; i < size; i++) {
    const next = b[pos + i];
    if ((next & 0xc0) !== 0x80) throw new LitError('Invalid UTF-8 character');
    c = c * 64 + (next & 0x3f);
  }
  return [c, pos + size];
}

/** A string prefixed by its length in characters (itself one UTF-8 character). */
function sizedString(b: Uint8Array, pos: number, zeroPadded = false): [string, number] {
  let [length, at] = readChar(b, pos);
  let out = '';
  for (let i = 0; i < length; i++) {
    const [c, next] = readChar(b, at);
    out += String.fromCodePoint(c);
    at = next;
  }
  if (zeroPadded && b[at] === 0) at++;
  return [out, at];
}

interface ManifestItem {
  internal: string;
  path: string;
  mimeType: string;
  state: 'spine' | 'not spine' | 'css' | 'images';
}

class LitFile {
  private readonly entries = new Map<string, { section: number; offset: number; size: number }>();
  private readonly sections: (Uint8Array | null)[] = [];
  private sectionNames: string[] = [];
  private contentOffset = 0;
  /** Key of DES-encrypted sections, for sealed and inscribed books. */
  private bookKey: Uint8Array | null = null;
  readonly manifest = new Map<string, ManifestItem>();

  constructor(private readonly data: Uint8Array) {
    if (ascii(data, 0, 8) !== 'ITOLITLS') throw new LitError('Not a LIT file');
    if (u32(data, 8) !== 1) throw new LitError(`Unknown LIT version ${u32(data, 8)}`);
    const headerLength = i32(data, 12);
    const pieces = i32(data, 16);
    const secondaryLength = i32(data, 20);
    this.readSecondaryHeader(data.subarray(headerLength + pieces * 16, headerLength + pieces * 16 + secondaryLength));
    for (let i = 0; i < pieces; i++) {
      const at = headerLength + i * 16;
      if (u32(data, at + 4) !== 0 || u32(data, at + 12) !== 0) throw new LitError('64-bit LIT files are not supported');
      if (i === 1) this.readDirectory(data.subarray(u32(data, at), u32(data, at) + i32(data, at + 8)));
    }
    this.readSectionNames();
    this.readDrm();
    this.readManifest();
  }

  private readDrm() {
    if (this.entries.has('/DRMStorage/Licenses/EUL')) throw new DrmError();
    const level = this.entries.has('/DRMStorage/DRMBookplate') ? 3 : this.entries.has('/DRMStorage/DRMSealed') ? 1 : 0;
    if (level === 0) return;
    // The title key is sealed with a key hashed from the book's metadata (and bookplate, when inscribed).
    const sources = ['/meta', '/DRMStorage/DRMSource', ...(level === 3 ? ['/DRMStorage/DRMBookplate'] : [])].map((name, i) => {
      const data = this.file(name);
      const prefix = i === 0 ? 2 : 0;
      const padded = new Uint8Array(Math.ceil((data.length + prefix) / 64) * 64);
      padded.set(data, prefix);
      return padded;
    });
    const hashed = new Uint8Array(sources.reduce((n, s) => n + s.length, 0));
    let at = 0;
    for (const s of sources) {
      hashed.set(s, at);
      at += s.length;
    }
    const key = new Uint8Array(8);
    msSha1(hashed).forEach((byte, i) => (key[i % 8] ^= byte));
    const sealed = desDecrypt(key, this.file('/DRMStorage/DRMSealed'));
    if (sealed[0] !== 0) throw new LitError('Unable to unseal the title key');
    this.bookKey = sealed.slice(1, 9);
  }

  private readSecondaryHeader(b: Uint8Array) {
    let at = i32(b, 4);
    let found = false;
    while (at + 8 <= b.length) {
      const type = ascii(b, at, 4);
      if (type === 'CAOL') at += 48;
      else if (type === 'ITSF') {
        if (u32(b, at + 20) !== 0) throw new LitError('64-bit LIT files are not supported');
        this.contentOffset = u32(b, at + 16);
        found = true;
        at += 48;
      } else break;
    }
    if (!found) throw new LitError('LIT file has no content offset');
  }

  private readDirectory(piece: Uint8Array) {
    if (ascii(piece, 0, 4) !== 'IFCM') throw new LitError('LIT directory is missing');
    const chunkSize = i32(piece, 8);
    const chunks = i32(piece, 24);
    for (let i = 0; i < chunks; i++) {
      const chunk = piece.subarray(32 + i * chunkSize, 32 + (i + 1) * chunkSize);
      if (ascii(chunk, 0, 4) !== 'AOLL') continue;
      const free = i32(chunk, 4);
      if (free >= chunkSize) throw new LitError('Damaged LIT directory');
      const end = chunkSize - free;
      let count = u16(chunk, chunkSize - 2) || 0xffff;
      let pos = 48;
      while (count-- > 0 && pos < end) {
        let nameLength: number;
        [nameLength, pos] = encint(chunk, pos);
        if (nameLength === 0 || pos + nameLength > end) break;
        const name = new TextDecoder('utf-8', { fatal: false }).decode(chunk.subarray(pos, pos + nameLength));
        pos += nameLength;
        let section: number, offset: number, size: number;
        [section, pos] = encint(chunk, pos);
        [offset, pos] = encint(chunk, pos);
        [size, pos] = encint(chunk, pos);
        this.entries.set(name, { section, offset, size });
      }
    }
  }

  private readSectionNames() {
    const raw = this.file('::DataSpace/NameList');
    const count = u16(raw, 2);
    let pos = 4;
    for (let i = 0; i < count; i++) {
      const size = u16(raw, pos) * 2 + 2;
      pos += 2;
      this.sectionNames.push(new TextDecoder('utf-16le').decode(raw.subarray(pos, pos + size)).replace(/\0+$/, ''));
      pos += size;
      this.sections.push(null);
    }
  }

  private readManifest() {
    const raw = this.file('/manifest');
    let pos = 0;
    while (pos < raw.length) {
      const rootLength = raw[pos++];
      if (!rootLength) break;
      pos += rootLength;
      for (const state of ['spine', 'not spine', 'css', 'images'] as const) {
        const count = i32(raw, pos);
        pos += 4;
        for (let i = 0; i < count; i++) {
          pos += 4; // offset
          let internal: string, original: string, mimeType: string;
          [internal, pos] = sizedString(raw, pos);
          [original, pos] = sizedString(raw, pos);
          [mimeType, pos] = sizedString(raw, pos, true);
          this.manifest.set(internal, { internal, path: cleanPath(original), mimeType: mimeType.toLowerCase(), state });
        }
      }
    }
    // Drop a directory prefix shared by every item; absolute leftovers keep only their file name.
    const items = [...this.manifest.values()];
    let shared = items.length > 1 ? dirname(items[0].path) : '';
    for (const item of items) while (shared && !item.path.startsWith(`${shared}/`)) shared = dirname(shared);
    for (const item of items) {
      if (shared) item.path = item.path.slice(shared.length + 1);
      if (item.path.startsWith('/')) item.path = item.path.slice(item.path.lastIndexOf('/') + 1);
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  file(name: string): Uint8Array {
    const entry = this.entries.get(name);
    if (!entry) throw new LitError(`LIT entry missing: ${name}`);
    if (entry.section === 0) {
      const start = this.contentOffset + entry.offset;
      return this.data.subarray(start, start + entry.size);
    }
    return this.section(entry.section).subarray(entry.offset, entry.offset + entry.size);
  }

  private section(index: number): Uint8Array {
    const cached = this.sections[index];
    if (cached) return cached;
    const name = this.sectionNames[index];
    if (name === undefined) throw new LitError(`Unknown LIT section ${index}`);
    const base = `::DataSpace/Storage/${name}`;
    let transforms = this.file(`${base}/Transform/List`);
    let content = this.file(`${base}/Content`);
    let control = this.file(`${base}/ControlData`);
    while (transforms.length >= 16) {
      const size = (i32(control, 0) + 1) * 4;
      if (size <= 0 || size > control.length) throw new LitError('LIT control data is too short');
      const guid = msguid(transforms);
      if (guid === DESENCRYPT_GUID) {
        if (!this.bookKey) throw new DrmError();
        content = desDecrypt(this.bookKey, content);
      } else if (guid !== LZXCOMPRESS_GUID) throw new LitError(`Unknown LIT transform ${guid}`);
      else content = decompressLzx(content, control, this.file(`${base}/Transform/${LZXCOMPRESS_GUID}/InstanceData/ResetTable`));
      control = control.subarray(size);
      transforms = transforms.subarray(16);
    }
    this.sections[index] = content;
    return content;
  }

  /** Tag and attribute names a document defines for itself ("atoms"). */
  atoms(item: ManifestItem): Atoms {
    const name = `/data/${item.internal}/atom`;
    const atoms: Atoms = { tags: new Map(), attrs: new Map() };
    if (!this.entries.has(name)) return atoms;
    const raw = this.file(name);
    const decoder = new TextDecoder('latin1');
    let pos = 4;
    for (let i = 1, n = u32(raw, 0); i <= n && pos < raw.length; i++) {
      const size = raw[pos++];
      if (!size || pos + size > raw.length) break;
      atoms.tags.set(i, decoder.decode(raw.subarray(pos, pos + size)));
      pos += size;
    }
    if (pos + 4 > raw.length) return atoms;
    const n = u32(raw, pos);
    pos += 4;
    for (let i = 1; i <= n && pos + 4 <= raw.length; i++) {
      const size = u32(raw, pos);
      pos += 4;
      if (!size || pos + size > raw.length) break;
      atoms.attrs.set(i, decoder.decode(raw.subarray(pos, pos + size)));
      pos += size;
    }
    return atoms;
  }
}

function cleanPath(original: string): string {
  let path = original.replace(/\\/g, '/');
  try {
    path = decodeURIComponent(path);
  } catch {
    // Stored unquoted already.
  }
  if (/^[a-z]:\//i.test(path)) path = path.slice(2);
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

/** A copy of a decoder state, so a frame can be decoded a second way. */
function cloneLzxState(state: LZXState): LZXState {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(state)), state) as LZXState;
  for (const [key, value] of Object.entries(state)) {
    if (ArrayBuffer.isView(value)) (copy as unknown as Record<string, unknown>)[key] = (value as Uint8Array).slice();
  }
  return copy;
}

/**
 * Decompresses an LZX section block by block (the reset table lists each block's compressed offset),
 * resetting the decoder at every window boundary, the way chmlib reads CHM sections.
 *
 * Every block is decoded as a whole frame: chmlib's decoder misplaces its output when asked for fewer
 * bytes than the frame holds, which happens with a padded final frame (as Calibre writes them). Streams
 * whose final frame really is short fail the whole-frame decode and are decoded again to the exact length.
 */
function decompressLzx(content: Uint8Array, control: Uint8Array, resetTable: Uint8Array): Uint8Array {
  if (control.length < 32 || ascii(control, 4, 4) !== 'LZXC') throw new LitError('Invalid LZX control data');
  let windowBits = 14;
  for (let u = u32(control, 12); u > 0; u >>>= 1) windowBits++;
  if (windowBits < 15 || windowBits > 21) throw new LitError('Invalid LZX window size');
  if (u32(resetTable, 20) !== 0) throw new LitError('64-bit LZX sections are not supported');

  const tableOffset = i32(resetTable, 12);
  const total = i32(resetTable, 16);
  const blockLength = i32(resetTable, 32);
  if (blockLength <= 0 || total < 0) throw new LitError('Invalid LZX reset table');
  const blocks = Math.ceil(total / blockLength);
  const blockStart = (k: number) =>
    k === 0 ? 0 : k < blocks && tableOffset + 8 * k + 4 <= resetTable.length ? u32(resetTable, tableOffset + 8 * k) : content.length;
  const resetEvery = Math.max(1, Math.floor((1 << windowBits) / blockLength));

  let state = new LZXState(windowBits);
  const out = new Uint8Array(total);
  const frame = new Uint8Array(blockLength);
  for (let k = 0; k < blocks; k++) {
    if (k % resetEvery === 0) state.reset();
    const input = content.subarray(blockStart(k), blockStart(k + 1));
    const length = Math.min(blockLength, total - k * blockLength);
    const before = length < blockLength ? cloneLzxState(state) : null;
    if (lzxDecompress(state, input, frame, input.length, blockLength) === DECR_OK) {
      out.set(frame.subarray(0, length), k * blockLength);
      continue;
    }
    if (!before) throw new LitError(`LZX decompression failed in block ${k}`);
    state = before;
    const exact = out.subarray(k * blockLength, k * blockLength + length);
    if (lzxDecompress(state, input, exact, input.length, length) !== DECR_OK) throw new LitError(`LZX decompression failed in block ${k}`);
  }
  return out;
}

interface Atoms {
  tags: Map<number, string>;
  attrs: Map<number, string>;
}

/**
 * Rebuilds a binary HTML/OPF token stream as DOM nodes appended to `root`.
 * `resolveHref` turns an href/src value (an internal manifest id, optionally with a fragment) into a URL.
 */
function unbinary(bin: Uint8Array, map: LitMap, atoms: Atoms, root: ParentNode & Node, resolveHrefValue: (value: string) => string) {
  const doc = root.ownerDocument ?? (root as Document);
  const create = (name: string): Element => {
    try {
      return doc.createElement(name);
    } catch {
      return doc.createElement('span');
    }
  };

  const parents: (ParentNode & Node)[] = [root];
  let state = 'text';
  let flags = 0;
  let element: Element | null = null;
  let goingDown = false;
  let tagAttrs: Record<number, string> | Map<number, string> | null = null;
  let attrName = '';
  let censored = false;
  let count = 0;
  let buffer = '';
  let text = '';

  const flushText = () => {
    if (text) parents[parents.length - 1].appendChild(doc.createTextNode(text));
    text = '';
  };
  const setAttr = (value: string) => {
    if (element && !censored) {
      try {
        element.setAttribute(attrName, value);
      } catch {
        // Not a valid attribute name in the DOM; drop it.
      }
    }
    censored = false;
    state = 'attr';
  };
  const startTag = (name: string) => {
    element = create(name);
    parents[parents.length - 1].appendChild(element);
  };

  for (let pos = 0; pos < bin.length; ) {
    const [code, next] = readChar(bin, pos);
    pos = next;
    const c = code <= 0x10ffff ? String.fromCodePoint(code) : '�';
    switch (state) {
      case 'text':
        if (code === 0) state = 'flags';
        else text += c === '\v' ? '\n' : c;
        break;
      case 'flags':
        if (code === 0) state = 'text';
        else {
          flags = code;
          state = 'tag';
        }
        break;
      case 'tag':
        state = code === 0 ? 'text' : 'attr';
        if (flags & FLAG_OPENING) {
          flushText();
          goingDown = (flags & FLAG_CLOSING) === 0;
          if (code === 0x8000) {
            state = 'custom length';
            break;
          }
          if (flags & FLAG_ATOM) {
            const name = atoms.tags.get(code);
            if (!name) throw new LitError(`Unknown atom tag ${code}`);
            startTag(name);
            tagAttrs = atoms.attrs;
          } else {
            startTag(map.tags[code] ?? 'span');
            tagAttrs = map.tagAttrs[code] ?? null;
          }
        } else if (flags & FLAG_CLOSING) {
          flushText();
          if (parents.length === 1) throw new LitError('Closing tag without an open tag');
          parents.pop();
          state = 'text';
        }
        break;
      case 'attr':
        if (code === 0) {
          if (goingDown && element) parents.push(element);
          element = null;
          state = 'text';
        } else if (code === 0x8000) state = 'attr length';
        else {
          const name = (tagAttrs instanceof Map ? tagAttrs.get(code) : tagAttrs?.[code]) || map.attrs[code];
          if (!name) throw new LitError(`Unknown attribute ${code}`);
          if (name.startsWith('%')) {
            censored = true;
            state = 'value length';
          } else {
            attrName = name;
            state = name === 'href' || name === 'src' ? 'href length' : 'value length';
          }
        }
        break;
      case 'value length':
        count = code - 1;
        buffer = '';
        if (count === 0) setAttr('');
        else {
          state = 'value';
          if (code !== 0xffff && (count < 0 || count > bin.length - pos)) throw new LitError('Invalid attribute length');
        }
        break;
      case 'value':
        if (count === 0xfffe) setAttr(String(code - 1));
        else {
          buffer += c;
          if (--count === 0) setAttr(buffer);
        }
        break;
      case 'custom length':
        count = code - 1;
        if (count <= 0 || count > bin.length - pos) throw new LitError('Invalid tag name length');
        buffer = '';
        state = 'custom';
        break;
      case 'custom':
        buffer += c;
        if (--count === 0) {
          startTag(buffer);
          tagAttrs = null;
          state = 'attr';
        }
        break;
      case 'attr length':
        count = code - 1;
        if (count <= 0 || count > bin.length - pos) throw new LitError('Invalid attribute name length');
        buffer = '';
        state = 'custom attr';
        break;
      case 'custom attr':
        buffer += c;
        if (--count === 0) {
          attrName = buffer;
          state = 'value length';
        }
        break;
      case 'href length':
        count = code - 1;
        if (count <= 0 || count > bin.length - pos) throw new LitError('Invalid link length');
        buffer = '';
        state = 'href';
        break;
      case 'href':
        buffer += c;
        if (--count === 0) setAttr(resolveHrefValue(buffer.slice(1)));
        break;
    }
  }
  flushText();
}

const HTML_EXTENSIONS = new Set(['htm', 'html']);

/** Where an item is written: HTML documents always get an .html name so they are served as HTML. */
function outputPath(item: ManifestItem): string {
  const isDocument = item.state === 'spine' || item.state === 'not spine';
  return isDocument && !HTML_EXTENSIONS.has(extension(item.path)) ? `${item.path}.html` : item.path;
}

function opfDocument(lit: LitFile, link: (from: string, value: string) => string): Document {
  // Built under a wrapper element: a Document node itself cannot hold the stream's whitespace text.
  const opf = document.implementation.createDocument(null, 'opf', null);
  unbinary(lit.file('/meta'), OPF_MAP, { tags: new Map(), attrs: new Map() }, opf.documentElement, (value) => link('content.opf', value));
  return opf;
}

const byName = (root: Document | Element, name: string) =>
  Array.from(root.getElementsByTagName('*')).filter((el) => el.tagName.toLowerCase() === name.toLowerCase());
const textOf = (el: Element | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Converts the LIT file at `sourcePath` into HTML documents and resources in the book folder. */
export async function importLit(fs: BookFs, sourcePath: string, fileName: string): Promise<ParsedBook> {
  const bytes = await fs.readBinary(sourcePath);
  let lit: LitFile;
  try {
    lit = new LitFile(bytes);
  } catch (error) {
    if (error instanceof DrmError) throw error;
    throw new Error(`Not a LIT file, or the file is damaged: ${fileName} (${(error as Error).message})`);
  }

  const items = [...lit.manifest.values()];
  const byInternal = lit.manifest;
  const written = new Map(items.map((item) => [item.path, outputPath(item)]));

  /** href/src values are internal manifest ids (plus fragment); anything else is kept as is. */
  const link = (from: string, value: string): string => {
    const [id, fragment] = splitFragment(value);
    const item = byInternal.get(id);
    if (!item) return value;
    const target = written.get(item.path)!;
    const relative = target === from ? '' : encodePath(relativePath(from, target));
    return relative + (fragment ? `#${fragment}` : '') || '#';
  };

  const spine: SpineItem[] = [];
  const titles = new Map<string, string>();
  for (const item of items) {
    const target = written.get(item.path)!;
    if (item.state === 'spine' || item.state === 'not spine') {
      const doc = document.implementation.createHTMLDocument('');
      const fragment = doc.createDocumentFragment();
      unbinary(lit.file(`/data/${item.internal}/content`), HTML_MAP, lit.atoms(item), fragment, (value) => link(target, value));
      const html = fragment.firstElementChild?.localName === 'html' ? fragment.firstElementChild : null;
      if (html) doc.replaceChild(html, doc.documentElement);
      else doc.body.append(fragment);
      // Word's smart tags (<st1:place> and friends) wrap plain text; forms cannot submit anywhere.
      for (const el of Array.from(doc.querySelectorAll('*'))) {
        if (el.tagName.toLowerCase().startsWith('st1:')) el.replaceWith(...Array.from(el.childNodes));
      }
      for (const form of Array.from(doc.querySelectorAll('form'))) {
        const div = doc.createElement('div');
        div.append(...Array.from(form.childNodes));
        form.replaceWith(div);
      }
      titles.set(target, doc.title.trim() || textOf(doc.querySelector('h1, h2, h3') ?? undefined));
      await fs.writeText(target, readerHtml(doc));
    } else {
      await fs.writeBinary(target, lit.file(`/data/${item.internal}`));
    }
  }

  const opf = opfDocument(lit, link);
  const resolveOpfHref = (href: string | null): string | null => {
    if (!href) return null;
    const [path, fragment] = splitFragment(resolveHref('content.opf', href) ?? '');
    const target = normalize(path);
    return target && [...written.values()].includes(target) ? target + (fragment ? `#${fragment}` : '') : null;
  };

  const manifestIds = new Map(byName(opf, 'item').map((el) => [el.getAttribute('id') ?? '', resolveOpfHref(el.getAttribute('href'))]));
  for (const ref of byName(opf, 'itemref')) {
    const href = manifestIds.get(ref.getAttribute('idref') ?? '');
    if (href && !spine.some((s) => s.href === href)) spine.push({ href, linear: ref.getAttribute('linear') !== 'no' });
  }
  if (spine.length === 0) {
    for (const item of items) if (item.state === 'spine') spine.push({ href: written.get(item.path)!, linear: true });
  }
  if (spine.length === 0) throw new Error('The LIT book has no content');

  const guide = byName(opf, 'reference').map((el) => ({ type: (el.getAttribute('type') ?? '').toLowerCase(), href: resolveOpfHref(el.getAttribute('href')) }));
  const toc = await guideToc(fs, guide.find((g) => g.type === 'toc')?.href ?? null, spine, titles);
  const coverRef = guide.find((g) => /coverimage|thumbimage/.test(g.type) && g.href)?.href;
  const coverItem = items.find((i) => i.state === 'images' && /cover/i.test(i.path));
  const cover = coverRef ?? (coverItem ? written.get(coverItem.path)! : null);

  const title = textOf(byName(opf, 'dc:Title')[0]) || fileName.replace(/\.[^.]+$/, '');
  const authors = byName(opf, 'dc:Creator').map(textOf).filter(Boolean);
  const identifier = textOf(byName(opf, 'dc:Identifier')[0]);
  return {
    identifier: identifier ? `lit:${identifier}` : `lit:${await sha256Hex(bytes)}`,
    title,
    authors,
    language: textOf(byName(opf, 'dc:Language')[0]),
    cover,
    layout: 'reflowable',
    direction: 'ltr',
    spine,
    toc,
  };
}

/** The links on the guide's "toc" page, or else one entry per spine document. */
async function guideToc(fs: BookFs, tocHref: string | null, spine: SpineItem[], titles: Map<string, string>): Promise<TocItem[]> {
  if (tocHref) {
    const page = splitFragment(tocHref)[0];
    const doc = new DOMParser().parseFromString(await fs.readText(page), 'text/html');
    const entries = Array.from(doc.querySelectorAll('a[href]')).flatMap((a): TocItem[] => {
      const href = resolveHref(page, a.getAttribute('href') ?? '');
      const label = textOf(a);
      return href && label && splitFragment(href)[0] !== page ? [{ label, href, children: [] }] : [];
    });
    if (entries.length > 0) return entries;
  }
  return spine.filter((s) => s.linear).map((s, i) => ({ label: titles.get(s.href) || `Section ${i + 1}`, href: s.href, children: [] }));
}
