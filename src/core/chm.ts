/**
 * CHM (Microsoft Compiled HTML Help). The archive's files are extracted into the book folder as they are,
 * scripts included. Text files are transcoded to UTF-8 (old help files rely on the Windows code page of
 * their locale), links are made to work outside Windows (ms-its: URLs, case-insensitive paths), and the
 * .hhc sitemap becomes the TOC. Archive reading and LZX decompression: chmlib-ts (LGPL-2.1).
 */
import { ChmEnumerateFlags, ChmFile, chmReaderFromBuffer } from 'chmlib-ts';
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { sha256Hex } from './fonts';
import { INJECTED_TAGS, injectReader } from './inject';
import { encodePath, extension, relativePath, resolveHref, splitFragment } from './paths';
import type { SpineItem, TocItem } from './types';

export const CHM_SOURCE = 'source.chm';

const HTML_EXTENSIONS = new Set(['htm', 'html']);
const TEXT_EXTENSIONS = new Set(['css', 'js', 'txt']);

/** Windows ANSI code page for an LCID, by primary language. */
export function lcidEncoding(lcid: number): string {
  const language = lcid & 0x3ff;
  const sublanguage = lcid >> 10;
  if ([0x19, 0x22, 0x02, 0x23, 0x2f, 0x40, 0x3f, 0x44].includes(language)) return 'windows-1251';
  if (language === 0x1a) return [0x03, 0x07].includes(sublanguage) ? 'windows-1251' : 'windows-1250';
  if ([0x05, 0x15, 0x0e, 0x1b, 0x24, 0x18, 0x1c].includes(language)) return 'windows-1250';
  if (language === 0x08) return 'windows-1253';
  if ([0x1f, 0x2c, 0x43].includes(language)) return 'windows-1254';
  if (language === 0x0d) return 'windows-1255';
  if ([0x01, 0x29, 0x20].includes(language)) return 'windows-1256';
  if ([0x25, 0x26, 0x27].includes(language)) return 'windows-1257';
  if (language === 0x2a) return 'windows-1258';
  if (language === 0x1e) return 'windows-874';
  if (language === 0x11) return 'shift_jis';
  if (language === 0x12) return 'euc-kr';
  if (language === 0x04) return [0x02, 0x04].includes(sublanguage) ? 'gbk' : 'big5';
  return 'windows-1252';
}

function supported(encoding: string): boolean {
  try {
    new TextDecoder(encoding);
    return true;
  } catch {
    return false;
  }
}

/** Decodes an HTML/text file: BOM, then a charset declaration, then the archive's code page. */
export function decodeChmText(bytes: Uint8Array, fallback: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const declared = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1] ?? /@charset\s+["']([\w.:-]+)/i.exec(head)?.[1];
  const encoding = declared && supported(declared) ? declared : fallback;
  return new TextDecoder(encoding).decode(bytes);
}

/** #SYSTEM: a version, then (code, length, data) records. */
function systemRecords(system: Uint8Array | null): Map<number, Uint8Array> {
  const records = new Map<number, Uint8Array>();
  if (!system) return records;
  const view = new DataView(system.buffer, system.byteOffset, system.byteLength);
  for (let at = 4; at + 4 <= system.length; ) {
    const code = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (at + 4 + length > system.length) break;
    if (!records.has(code)) records.set(code, system.subarray(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return records;
}

interface SystemInfo {
  tocFile?: string;
  defaultTopic?: string;
  title?: string;
  encoding: string;
}

/** Strings in #SYSTEM use the archive's code page: its LCID is in record 4, or else in the ITSF header. */
function readSystem(source: Uint8Array, system: Uint8Array | null): SystemInfo {
  const records = systemRecords(system);
  const lcidRecord = records.get(4);
  const lcid =
    lcidRecord && lcidRecord.length >= 4
      ? new DataView(lcidRecord.buffer, lcidRecord.byteOffset, 4).getUint32(0, true)
      : source.length >= 24
        ? new DataView(source.buffer, source.byteOffset, 24).getUint32(20, true)
        : 0;
  const encoding = lcidEncoding(lcid);
  const text = (code: number) => {
    const data = records.get(code);
    if (!data) return undefined;
    const end = data.indexOf(0);
    return new TextDecoder(encoding).decode(end < 0 ? data : data.subarray(0, end)).trim() || undefined;
  };
  return { tocFile: text(0), defaultTopic: text(2), title: text(3), encoding };
}

/** Book-root-relative path for a path as written inside the archive ("/a/b.htm", "\\a\\b.htm", "a/b.htm"). */
const archivePath = (path: string) => path.replace(/\\/g, '/').replace(/^\/+/, '');

class LinkFixer {
  private readonly byLowerCase = new Map<string, string>();

  constructor(private readonly files: Set<string>) {
    for (const file of files) this.byLowerCase.set(file.toLowerCase(), file);
  }

  /** The existing file a path refers to, matching case-insensitively like Windows does. */
  find(path: string): string | null {
    return this.files.has(path) ? path : (this.byLowerCase.get(path.toLowerCase()) ?? null);
  }

  /** Rewrites a reference found in the document at `from`, or returns null to leave it unchanged. */
  fix(from: string, raw: string): string | null {
    let ref = raw.trim().replace(/\\/g, '/');
    const its = /^(?:mk:@MSITStore:|ms-its:|its:)[^:]*::(.*)$/i.exec(ref);
    if (its) ref = `/${its[1].replace(/^\/+/, '')}`;
    else if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('#') || ref === '') return null;
    const [pathAndQuery, fragment] = splitFragment(ref);
    const path = pathAndQuery.split('?')[0];
    const resolved = resolveHref(from, path);
    if (resolved === null) return null;
    const target = this.find(resolved);
    if (!target || (target === resolved && !its)) return null;
    return encodePath(relativePath(from, target)) + (fragment ? `#${fragment}` : '');
  }

  html(from: string, source: string): string {
    return source.replace(/<[a-z][^<>]*>/gi, (tag) =>
      tag.replace(/(\s(?:href|src|background)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi, (attr, prefix: string, dq?: string, sq?: string, bare?: string) => {
        const fixed = this.fix(from, dq ?? sq ?? bare ?? '');
        return fixed === null ? attr : `${prefix}"${fixed.replace(/"/g, '%22')}"`;
      }),
    );
  }

  css(from: string, source: string): string {
    return source.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, url: string) => {
      const fixed = this.fix(from, url);
      return fixed === null ? match : `url(${quote}${fixed}${quote})`;
    });
  }
}

/** UTF-8 page with the reader injected; any other charset declaration is dropped. */
function pageSource(html: string): string {
  const cleaned = html.replace(/<meta\b[^>]*charset[^>]*>/gi, '');
  return injectReader(cleaned).replace(INJECTED_TAGS, `<meta charset="utf-8">${INJECTED_TAGS}`);
}

/** Parses an .hhc sitemap: nested <ul>s of <li><object type="text/sitemap"> with Name and Local params. */
export function parseSitemap(html: string, resolve: (local: string) => string): TocItem[] {
  const isList = (el: Element) => el.localName === 'ul' || el.localName === 'ol';
  const items = (nodes: Element[]): TocItem[] =>
    nodes.flatMap((node): TocItem[] => {
      if (isList(node)) return items(Array.from(node.children));
      if (node.localName !== 'li') return [];
      const kids = Array.from(node.children);
      const object = kids.find((c) => c.localName === 'object' && /sitemap/i.test(c.getAttribute('type') ?? ''));
      const children = items(kids.filter(isList));
      if (!object) return children;
      const params = new Map(
        Array.from(object.getElementsByTagName('param'), (p) => [(p.getAttribute('name') ?? '').toLowerCase(), p.getAttribute('value') ?? '']),
      );
      const local = params.get('local');
      return [{ label: params.get('name')?.trim() || '…', href: local ? resolve(local) : '', children }];
    });
  const top = new DOMParser().parseFromString(html, 'text/html').body.querySelector('ul, ol');
  return top ? items([top]) : [];
}

/** Extracts the CHM at `sourcePath` into the book folder. */
export async function importChm(fs: BookFs, sourcePath: string, fileName: string): Promise<ParsedBook> {
  const source = await fs.readBinary(sourcePath);
  let chm: ChmFile;
  try {
    chm = await ChmFile.open(chmReaderFromBuffer(source));
  } catch {
    throw new Error(`Not a CHM file, or the file is damaged: ${fileName}`);
  }
  try {
    const system = readSystem(source, await chm.getSystemRaw());
    const { encoding } = system;

    const entries = [];
    for await (const entry of chm.enumerate(ChmEnumerateFlags.Normal | ChmEnumerateFlags.Files)) {
      const path = archivePath(entry.path);
      // Internal files: #SYSTEM, #TOPICS, $FIftiMain (search index), $WWKeywordLinks, ...
      if (!path || path.startsWith('#') || path.startsWith('$') || path.startsWith(':')) continue;
      entries.push({ entry, path });
    }
    const files = new Set(entries.map((e) => e.path));
    const links = new LinkFixer(files);

    const html: string[] = [];
    let sitemapSource: { path: string; text: string } | null = null;
    const tocPath = system.tocFile ? links.find(archivePath(system.tocFile)) : null;
    for (const { entry, path } of entries) {
      const data = await chm.retrieve(entry);
      const ext = extension(path);
      if (HTML_EXTENSIONS.has(ext)) {
        await fs.writeText(path, pageSource(links.html(path, decodeChmText(data, encoding))));
        html.push(path);
      } else if (ext === 'css') {
        await fs.writeText(path, links.css(path, decodeChmText(data, encoding)));
      } else if (TEXT_EXTENSIONS.has(ext)) {
        await fs.writeText(path, decodeChmText(data, encoding));
      } else {
        await fs.writeBinary(path, data);
      }
      if (ext === 'hhc' && (path === tocPath || (!tocPath && !sitemapSource))) sitemapSource = { path, text: decodeChmText(data, encoding) };
    }
    if (html.length === 0) throw new Error('The CHM file contains no pages');

    const resolveLocal = (from: string) => (local: string) => {
      const fixed = links.fix(from, local);
      const href = fixed !== null ? resolveHref(from, fixed) : resolveHref(from, local.replace(/\\/g, '/'));
      if (!href) return '';
      const [path, fragment] = splitFragment(href);
      const target = links.find(path);
      return target ? target + (fragment ? `#${fragment}` : '') : '';
    };
    const toc = sitemapSource ? parseSitemap(sitemapSource.text, resolveLocal(sitemapSource.path)) : [];

    // Reading order: the default topic, then pages in TOC order, then the remaining pages (non-linear).
    const order: string[] = [];
    const add = (path: string | null) => {
      if (path && HTML_EXTENSIONS.has(extension(path)) && !order.includes(path)) order.push(path);
    };
    add(system.defaultTopic ? links.find(splitFragment(archivePath(system.defaultTopic))[0]) : null);
    const walk = (items: TocItem[]) => items.forEach((item) => (add(item.href ? splitFragment(item.href)[0] : null), walk(item.children)));
    walk(toc);
    const linearCount = order.length;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    [...html].sort(collator.compare).forEach(add);
    const spine: SpineItem[] = order.map((href, i) => ({ href, linear: linearCount === 0 || i < linearCount }));

    return {
      identifier: `chm:${await sha256Hex(source)}`,
      title: system.title || fileName.replace(/\.[^.]+$/, ''),
      authors: [],
      language: '',
      cover: null,
      layout: 'reflowable',
      direction: 'ltr',
      spine,
      toc,
    };
  } finally {
    chm.close();
  }
}
