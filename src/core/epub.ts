import type { BookFs } from './bookfs';
import { deobfuscateFonts } from './fonts';
import { xhtmlToHtml } from './html';
import { injectReader, isHtmlMediaType } from './inject';
import { resolveHref, splitFragment } from './paths';
import { epubSeries } from './series';
import type { BookManifest, OnPreview, SpineItem, TocItem } from './types';
import { all, attr, child, children, first, parseXml, text } from './xml';

export const CONTAINER_PATH = 'META-INF/container.xml';

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

export type ParsedBook = Omit<BookManifest, 'version' | 'id' | 'format'>;

export async function findPackagePath(fs: BookFs): Promise<string> {
  const container = parseXml(await fs.readText(CONTAINER_PATH), CONTAINER_PATH);
  const rootfiles = all(container, 'rootfile');
  const rootfile = rootfiles.find((r) => attr(r, 'media-type') === 'application/oebps-package+xml') ?? rootfiles[0];
  const fullPath = rootfile && attr(rootfile, 'full-path');
  if (!fullPath) throw new Error('EPUB container has no package document');
  return decodeURIComponent(fullPath);
}

/** Parses an extracted EPUB, de-obfuscates fonts and injects the reader into spine documents. */
export async function importEpub(fs: BookFs, onPreview?: OnPreview): Promise<ParsedBook> {
  const opfPath = await findPackagePath(fs);
  const opf = parseXml(await fs.readText(opfPath), opfPath);
  const book = parsePackage(opf, opfPath);
  const { title, authors, cover } = book.parsed;
  onPreview?.({ title, authors, cover });

  const identifiers = all(opf, 'identifier').map(text);
  await deobfuscateFonts(fs, book.uniqueIdentifier, identifiers);

  const aliases: Record<string, string> = {};
  const files = new Set(fs.files);
  // A few documents at a time: a book of a thousand small documents goes several times faster than one by one.
  await forEachAtOnce([...book.spineItems.entries()], SPINE_CONCURRENCY, async ([index, item]) => {
    if (!isHtmlMediaType(item.mediaType) || !files.has(item.href)) return;
    let source = await fs.readText(item.href);
    let target = item.href;
    if (item.mediaType === 'application/xhtml+xml' && /<script[\s>]/i.test(source)) {
      const html = xhtmlToHtml(source);
      if (html !== null) {
        // Same folder, so relative URLs inside the document keep working.
        source = html;
        target = `${item.href}.html`;
        aliases[item.href] = target;
        book.parsed.spine[index].href = target;
      }
    }
    await fs.writeText(target, injectReader(source));
  });

  book.parsed.toc = applyAliases(await readToc(fs, book), aliases);
  book.parsed.aliases = aliases;
  return book.parsed;
}

/** Spine documents read and written at once while importing. */
const SPINE_CONCURRENCY = 8;

/**
 * Runs `task` on every item, `limit` at a time. After a failure no more tasks start, and once the ones running have
 * ended, it rejects with that failure.
 */
export async function forEachAtOnce<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async () => {
    while (failures.length === 0 && next < items.length) {
      try {
        await task(items[next++]);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failures.length > 0) throw failures[0];
}

function applyAliases(items: TocItem[], aliases: Record<string, string>): TocItem[] {
  return items.map((item) => {
    const [path, fragment] = splitFragment(item.href);
    const alias = aliases[path];
    return {
      ...item,
      href: alias ? alias + (fragment ? `#${fragment}` : '') : item.href,
      children: applyAliases(item.children, aliases),
    };
  });
}

interface PackageInfo {
  parsed: ParsedBook;
  uniqueIdentifier: string;
  manifest: Map<string, ManifestItem>;
  spineItems: ManifestItem[];
  navItem: ManifestItem | null;
  ncxItem: ManifestItem | null;
}

export function parsePackage(opf: Document, opfPath: string): PackageInfo {
  const pkg = opf.documentElement;
  const metadata = first(opf, 'metadata');
  if (!metadata) throw new Error('EPUB package has no metadata');

  const manifest = new Map<string, ManifestItem>();
  for (const el of all(opf, 'item')) {
    const id = attr(el, 'id');
    const rawHref = attr(el, 'href');
    const href = rawHref ? resolveHref(opfPath, rawHref) : null;
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: attr(el, 'media-type') ?? '',
      properties: (attr(el, 'properties') ?? '').split(/\s+/).filter(Boolean),
    });
  }

  const spineEl = first(opf, 'spine');
  const spineItems: ManifestItem[] = [];
  const spine: SpineItem[] = [];
  for (const ref of spineEl ? children(spineEl, 'itemref') : []) {
    const item = manifest.get(attr(ref, 'idref') ?? '');
    if (!item) continue;
    spineItems.push(item);
    spine.push({ href: item.href, linear: attr(ref, 'linear') !== 'no' });
  }
  if (spine.length === 0) throw new Error('EPUB has an empty reading order');

  const uniqueIdAttr = attr(pkg, 'unique-identifier');
  const identifierEls = all(metadata, 'identifier');
  const uniqueEl = identifierEls.find((el) => attr(el, 'id') === uniqueIdAttr) ?? identifierEls[0];
  const uniqueIdentifier = text(uniqueEl);

  const metas = all(metadata, 'meta');
  const metaProperty = (property: string) => text(metas.find((m) => attr(m, 'property') === property));
  const coverMetaId = metas.find((m) => attr(m, 'name') === 'cover')?.getAttribute('content') ?? '';
  const items = [...manifest.values()];
  const cover =
    items.find((i) => i.properties.includes('cover-image')) ??
    manifest.get(coverMetaId) ??
    items.find((i) => i.mediaType.startsWith('image/') && /cover/i.test(i.id + i.href));

  const title = text(first(metadata, 'title'));
  const parsed: ParsedBook = {
    identifier: uniqueIdentifier || title,
    title: title || opfPath,
    authors: all(metadata, 'creator').map(text).filter(Boolean),
    language: text(first(metadata, 'language')),
    cover: cover?.mediaType.startsWith('image/') ? cover.href : null,
    series: epubSeries(opf),
    layout: metaProperty('rendition:layout') === 'pre-paginated' ? 'pre-paginated' : 'reflowable',
    direction: spineEl && attr(spineEl, 'page-progression-direction') === 'rtl' ? 'rtl' : 'ltr',
    spine,
    toc: [],
  };

  const navItem = items.find((i) => i.properties.includes('nav')) ?? null;
  const ncxItem = manifest.get(spineEl ? (attr(spineEl, 'toc') ?? '') : '') ?? items.find((i) => i.mediaType === 'application/x-dtbncx+xml') ?? null;
  return { parsed, uniqueIdentifier, manifest, spineItems, navItem, ncxItem };
}

async function readToc(fs: BookFs, book: PackageInfo): Promise<TocItem[]> {
  if (book.navItem && fs.files.includes(book.navItem.href)) {
    const toc = parseNavToc(await fs.readText(book.navItem.href), book.navItem.href);
    if (toc.length > 0) return toc;
  }
  if (book.ncxItem && fs.files.includes(book.ncxItem.href)) {
    return parseNcxToc(await fs.readText(book.ncxItem.href), book.ncxItem.href);
  }
  return [];
}

export function parseNavToc(source: string, navPath: string): TocItem[] {
  const doc = parseNavDocument(source);
  const navs = all(doc, 'nav');
  const nav = navs.find((n) => (attr(n, 'type') ?? '').split(/\s+/).includes('toc')) ?? navs[0];
  const ol = nav && first(nav, 'ol');
  return ol ? parseNavList(ol, navPath) : [];
}

function parseNavDocument(source: string): Document {
  try {
    return parseXml(source, 'navigation document');
  } catch {
    return new DOMParser().parseFromString(source, 'text/html');
  }
}

function parseNavList(ol: Element, navPath: string): TocItem[] {
  return children(ol, 'li').map((li) => {
    const label = child(li, 'a') ?? child(li, 'span');
    const href = label?.localName === 'a' ? attr(label, 'href') : null;
    const sub = child(li, 'ol');
    return {
      label: text(label) || attr(label ?? li, 'title') || '…',
      href: (href && resolveHref(navPath, href)) || '',
      children: sub ? parseNavList(sub, navPath) : [],
    };
  });
}

export function parseNcxToc(source: string, ncxPath: string): TocItem[] {
  const doc = parseXml(source, 'NCX');
  const navMap = first(doc, 'navMap');
  return navMap ? parseNavPoints(navMap, ncxPath) : [];
}

function parseNavPoints(parent: Element, ncxPath: string): TocItem[] {
  return children(parent, 'navPoint').map((point) => {
    const src = attr(first(point, 'content') ?? point, 'src');
    return {
      label: text(first(first(point, 'navLabel') ?? point, 'text')) || '…',
      href: (src && resolveHref(ncxPath, src)) || '',
      children: parseNavPoints(point, ncxPath),
    };
  });
}

export function isEpubContainer(files: string[]): boolean {
  return files.includes(CONTAINER_PATH);
}
