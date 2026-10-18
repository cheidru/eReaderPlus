/**
 * Markdown: a .md file, or a ZIP archive of .md files and the images they show. Converted to HTML with marked (MIT),
 * GitHub-flavored. Each file is a chapter, and a long one is split into chapters at its top headings; the contents
 * list the headings. Chapters are written next to their file, so the file's relative links and images keep working.
 */
import { Marked } from 'marked';
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { sha256Hex } from './fonts';
import { readerHtml } from './html';
import { extension, relativePath, resolveHref, splitFragment } from './paths';
import type { OnPreview, SpineItem, TocItem } from './types';

export const MARKDOWN_EXTENSIONS = ['md', 'markdown'];
export const MARKDOWN_SOURCE = 'source.md';

/** A file longer than this (in characters) is split into chapters at its top headings; a shorter one reads as one. */
const SPLIT_LENGTH = 30_000;
/** Headings down to this level are listed in the contents. */
const TOC_DEPTH = 3;

const MARKDOWN_CSS = `
body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.5em; }
h1, h2 { border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); padding-bottom: 0.25em; }
img { max-width: 100%; }
code, pre { font-family: ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace; font-size: 0.9em; }
code { background: color-mix(in srgb, currentColor 10%, transparent); border-radius: 4px; padding: 0.1em 0.3em; }
pre { background: color-mix(in srgb, currentColor 7%, transparent); border-radius: 6px; padding: 0.8em 1em; white-space: pre-wrap; overflow-wrap: anywhere; }
pre code { background: none; padding: 0; font-size: inherit; }
blockquote { margin: 1em 0; padding: 0 1em; border-left: 0.25em solid color-mix(in srgb, currentColor 30%, transparent); opacity: 0.85; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); padding: 0.3em 0.7em; }
hr { border: none; border-top: 1px solid color-mix(in srgb, currentColor 30%, transparent); margin: 1.5em 0; }
li > input[type='checkbox'] { margin: 0 0.4em 0 0; }
`;

/**
 * Decodes a text file: UTF-8 or UTF-16 with a byte order mark, else UTF-8, else (not valid UTF-8) a legacy code page,
 * guessed: Cyrillic Windows-1251 when most letters are outside ASCII, else Western Windows-1252.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    // Drops a UTF-8 byte order mark.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let high = 0;
    let letters = 0;
    for (const byte of bytes) {
      if (byte >= 0xc0) high++;
      if (byte >= 0xc0 || ((byte | 0x20) >= 0x61 && (byte | 0x20) <= 0x7a)) letters++;
    }
    return new TextDecoder(high > letters / 2 ? 'windows-1251' : 'windows-1252').decode(bytes);
  }
}

interface FrontMatter {
  title?: string;
  authors: string[];
  language?: string;
}

/** Splits YAML front matter (title, author or authors, lang or language) off the text. Only these simple keys are read. */
export function frontMatter(source: string): { meta: FrontMatter; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source);
  const meta: FrontMatter = { authors: [] };
  if (!match) return { meta, body: source };
  const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  const list = (value: string) => (/^\[.*\]$/.test(value.trim()) ? value.trim().slice(1, -1).split(',') : [value]).map(unquote).filter(Boolean);
  let listKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      meta.authors.push(unquote(item[1]));
      continue;
    }
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    listKey = null;
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2];
    if (key === 'title') meta.title = unquote(value);
    else if (key === 'lang' || key === 'language') meta.language = unquote(value);
    else if (key === 'author' || key === 'authors') {
      if (value.trim()) meta.authors.push(...list(value));
      else listKey = key;
    }
  }
  return { meta, body: source.slice(match[0].length) };
}

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces as hyphens, repeats numbered. */
function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-') || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

const headingLevel = (node: Node) => (node instanceof Element && /^h[1-6]$/i.test(node.tagName) ? Number(node.tagName[1]) : 0);

/** The level the file's top-level headings split it at (1 or 2: the one used more than once), or 0 to keep it whole. */
function splitLevel(body: HTMLElement, length: number): number {
  if (length <= SPLIT_LENGTH) return 0;
  for (const level of [1, 2]) {
    if (Array.from(body.children).filter((el) => headingLevel(el) === level).length > 1) return level;
  }
  return 0;
}

interface Chapter {
  path: string;
  /** The Markdown file it comes from. */
  source: string;
  nodes: Node[];
}

/**
 * Converts the Markdown files `sources` (book-root-relative) into a book. `copyResource`, where the platform can, brings
 * an image the text shows from beside the file opened (a single .md file) into the book at the same relative path.
 */
export async function importMarkdown(
  fs: BookFs,
  sources: string[],
  fileName: string,
  onPreview?: OnPreview,
  copyResource?: (path: string) => Promise<void>,
): Promise<ParsedBook> {
  const marked = new Marked({ gfm: true });
  const chapters: Chapter[] = [];
  /** Per Markdown file: element id → the chapter holding it, and its first chapter. */
  const ids = new Map<string, Map<string, string>>();
  const firstChapter = new Map<string, string>();
  const hashes: string[] = [];
  let meta: FrontMatter | null = null;

  for (const source of sources) {
    const bytes = await fs.readBinary(source);
    hashes.push(await sha256Hex(bytes));
    const { meta: fileMeta, body: text } = frontMatter(decodeText(bytes));
    meta ??= fileMeta;
    const doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = await marked.parse(text);
    const slug = slugger();
    const fileIds = new Map<string, string>();
    ids.set(source, fileIds);

    const level = splitLevel(doc.body, text.length);
    let chapter: Chapter | null = null;
    for (const node of Array.from(doc.body.childNodes)) {
      const nodeLevel = headingLevel(node);
      // A new chapter at each heading of the split level, unless the chapter so far is only headings (the book's title).
      if (!chapter || (level && nodeLevel === level && chapter.nodes.some((n) => n instanceof Element && !headingLevel(n)))) {
        chapter = { path: `${source}.${String(chapters.length + 1).padStart(4, '0')}.html`, source, nodes: [] };
        chapters.push(chapter);
      }
      chapter.nodes.push(node);
      if (node instanceof Element) {
        for (const el of [node, ...Array.from(node.querySelectorAll('[id], h1, h2, h3, h4, h5, h6'))]) {
          if (headingLevel(el) && !el.id) el.id = slug(el.textContent ?? '');
          if (el.id) fileIds.set(el.id, chapter.path);
        }
      }
    }
    firstChapter.set(source, chapters.find((c) => c.source === source)?.path ?? '');
  }
  if (chapters.length === 0) throw new Error('The file contains no text');

  const firstHeading = chapters[0].nodes.find((n): n is Element => headingLevel(n) === 1)?.textContent?.trim();
  const title = meta?.title || firstHeading || fileName.replace(/\.[^.]+$/, '');
  const authors = meta?.authors ?? [];
  const language = meta?.language ?? '';
  onPreview?.({ title, authors, cover: null });

  /** Where a link from a chapter goes: a heading in another chapter, or another Markdown file of the book. */
  const relink = (chapter: Chapter, href: string): string | null => {
    const resolved = resolveHref(chapter.source, href);
    if (resolved === null) return null;
    const [path, fragment] = splitFragment(resolved);
    const fileIds = ids.get(path);
    if (!fileIds) return null;
    const target = (fragment && fileIds.get(fragment)) || firstChapter.get(path)!;
    return relativePath(chapter.path, target) + (fragment ? `#${fragment}` : '');
  };

  const toc: TocItem[] = [];
  /** Images brought in by copyResource (tried once each, found or not). */
  const copied = new Set<string>();
  const open: { level: number; item: TocItem }[] = [];
  const spine: SpineItem[] = [];
  for (const chapter of chapters) {
    const doc = document.implementation.createHTMLDocument(title);
    if (language) doc.documentElement.lang = language;
    for (const node of chapter.nodes) doc.body.append(doc.importNode(node, true));
    if (copyResource) {
      for (const image of Array.from(doc.querySelectorAll('img[src]'))) {
        const path = resolveHref(chapter.source, image.getAttribute('src') ?? '');
        const file = path && splitFragment(path)[0];
        if (!file || fs.files.includes(file) || copied.has(file)) continue;
        copied.add(file);
        await copyResource(file).catch(() => {});
      }
    }
    for (const link of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const href = relink(chapter, link.getAttribute('href') ?? '');
      if (href !== null) link.setAttribute('href', href);
    }
    for (const heading of Array.from(doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
      const level = headingLevel(heading);
      const label = heading.textContent?.trim();
      if (level > TOC_DEPTH || !label) continue;
      // A chapter starting with its heading opens at its start.
      const href = doc.body.firstElementChild === heading ? chapter.path : `${chapter.path}#${heading.id}`;
      const item: TocItem = { label, href, children: [] };
      while (open.length && open[open.length - 1].level >= level) open.pop();
      (open.length ? open[open.length - 1].item.children : toc).push(item);
      open.push({ level, item });
    }
    await fs.writeText(chapter.path, readerHtml(doc, MARKDOWN_CSS));
    spine.push({ href: chapter.path, linear: true });
  }

  return {
    identifier: `md:${hashes.length === 1 ? hashes[0] : await sha256Hex(new TextEncoder().encode(hashes.join()))}`,
    title,
    authors,
    language,
    cover: null,
    layout: 'reflowable',
    direction: 'ltr',
    spine,
    toc,
  };
}

/** The Markdown files of an archive, in reading order: a README or index first, then the others in natural order. */
export function markdownFiles(files: string[]): string[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const first = (f: string) => (/^(readme|index)\.(md|markdown)$/i.test(f) ? 0 : 1);
  return files
    .filter((f) => MARKDOWN_EXTENSIONS.includes(extension(f)) && !f.split('/').some((p) => p.startsWith('.') || p === '__MACOSX'))
    .sort((a, b) => first(a) - first(b) || a.split('/').length - b.split('/').length || collator.compare(a, b));
}
