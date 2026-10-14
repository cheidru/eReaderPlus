/**
 * FictionBook 2 → XHTML conversion. Each top-level <section> of the main body becomes one chapter
 * file under text/, binaries become files under images/, and note bodies become separate files.
 */
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { injectReader } from './inject';
import { fb2Series } from './series';
import type { SpineItem, TocItem } from './types';
import { all, attr, child, children, escapeXml, first, parseXml, text } from './xml';

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const FB2_CSS = `
body { font-family: serif; line-height: 1.5; }
h1, h2, h3, h4, h5, h6 { text-align: center; break-after: avoid; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p.subtitle { text-align: center; font-weight: bold; text-indent: 0; margin: 1em 0; }
.empty-line { height: 1em; }
.epigraph { margin: 1em 0 1em 30%; font-style: italic; }
.text-author { text-align: right; font-style: italic; text-indent: 0; }
.poem { margin: 1em 2em; }
.stanza { margin: 0 0 1em; }
.v { text-indent: 0; }
blockquote { margin: 1em 2em; }
.image { text-align: center; text-indent: 0; margin: 1em 0; }
.image img { max-width: 100%; }
a.note { vertical-align: super; font-size: 0.75em; text-decoration: none; }
table { border-collapse: collapse; margin: 1em auto; }
td, th { border: 1px solid currentColor; padding: 0.2em 0.5em; }
`;

/** Decodes FB2 bytes honoring the encoding in the XML declaration (often windows-1251). */
export function decodeFb2(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const encoding = /encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

interface Chapter {
  path: string;
  title: string;
  html: string;
}

class Converter {
  /** Element id → chapter path, for resolving internal links. */
  private idToFile = new Map<string, string>();
  private images = new Map<string, string>();
  private generatedIds = 0;
  toc: TocItem[] = [];

  registerImages(images: Map<string, string>) {
    this.images = images;
  }

  plan(bodies: Element[]): { el: Element[]; path: string; title: string; isNotes: boolean }[] {
    const parts: { el: Element[]; path: string; title: string; isNotes: boolean }[] = [];
    let n = 0;
    const next = () => `text/ch${String(++n).padStart(3, '0')}.xhtml`;
    for (const body of bodies) {
      const isNotes = /notes|comments/i.test(attr(body, 'name') ?? '');
      if (isNotes) {
        parts.push({ el: [body], path: next(), title: text(child(body, 'title')) || 'Notes', isNotes });
        continue;
      }
      const sections = children(body, 'section');
      const intro = children(body).filter((c) => c.localName !== 'section');
      if (intro.length > 0 || sections.length === 0) {
        parts.push({ el: intro.length > 0 ? intro : [body], path: next(), title: text(child(body, 'title')), isNotes });
      }
      for (const section of sections) {
        parts.push({ el: [section], path: next(), title: text(child(section, 'title')), isNotes });
      }
    }
    for (const part of parts) {
      for (const el of part.el) {
        for (const withId of [el, ...Array.from(el.querySelectorAll('[id]'))]) {
          const id = withId.getAttribute('id');
          if (id && !this.idToFile.has(id)) this.idToFile.set(id, part.path);
        }
      }
    }
    return parts;
  }

  chapter(part: { el: Element[]; path: string; title: string; isNotes: boolean }): Chapter {
    const tocEntries: TocItem[] = [];
    const body = part.el.map((el) => this.block(el, 1, part.path, tocEntries)).join('');
    // Note bodies get a single TOC entry rather than one per note.
    if (part.isNotes) this.toc.push({ label: part.title, href: part.path, children: [] });
    else this.toc.push(...tocEntries);
    return { path: part.path, title: part.title, html: page(part.title, body) };
  }

  private sectionId(el: Element): string {
    let id = el.getAttribute('id');
    if (!id) {
      id = `fb2-s${++this.generatedIds}`;
      el.setAttribute('id', id);
    }
    return id;
  }

  private block(el: Element, depth: number, path: string, toc: TocItem[]): string {
    const id = el.getAttribute('id');
    const idAttr = id ? ` id="${escapeXml(id)}"` : '';
    const inner = (d = depth, t = toc) => children(el).map((c) => this.block(c, d, path, t)).join('');
    switch (el.localName) {
      case 'body':
        return `<div class="body"${idAttr}>${inner()}</div>`;
      case 'section': {
        const title = child(el, 'title');
        const entry: TocItem | null = title ? { label: text(title), href: `${path}#${this.sectionId(el)}`, children: [] } : null;
        if (entry) toc.push(entry);
        const sid = el.getAttribute('id');
        const content = children(el).map((c) => this.block(c, depth + 1, path, entry ? entry.children : toc)).join('');
        return `<section${sid ? ` id="${escapeXml(sid)}"` : ''}>${content}</section>`;
      }
      case 'title': {
        const level = Math.min(depth, 6);
        const lines = children(el, 'p').map((p) => this.inline(p, path));
        return `<h${level}${idAttr}>${lines.join('<br/>') || escapeXml(text(el))}</h${level}>`;
      }
      case 'subtitle':
        return `<p class="subtitle"${idAttr}>${this.inline(el, path)}</p>`;
      case 'p':
        return `<p${idAttr}>${this.inline(el, path)}</p>`;
      case 'empty-line':
        return '<div class="empty-line"></div>';
      case 'epigraph':
        return `<div class="epigraph"${idAttr}>${inner()}</div>`;
      case 'cite':
        return `<blockquote${idAttr}>${inner()}</blockquote>`;
      case 'poem':
        return `<div class="poem"${idAttr}>${inner()}</div>`;
      case 'stanza':
        return `<div class="stanza">${inner()}</div>`;
      case 'v':
        return `<p class="v"${idAttr}>${this.inline(el, path)}</p>`;
      case 'text-author':
        return `<p class="text-author">${this.inline(el, path)}</p>`;
      case 'date':
        return `<p class="text-author">${this.inline(el, path)}</p>`;
      case 'image':
        return `<div class="image"${idAttr}>${this.image(el)}</div>`;
      case 'table':
        return `<table${idAttr}>${inner()}</table>`;
      case 'tr':
        return `<tr>${children(el).map((c) => this.cell(c, path)).join('')}</tr>`;
      case 'annotation':
        return `<div class="annotation">${inner()}</div>`;
      default:
        return this.inline(el, path) ? `<p>${this.inline(el, path)}</p>` : '';
    }
  }

  private cell(el: Element, path: string): string {
    const tag = el.localName === 'th' ? 'th' : 'td';
    const span = ['colspan', 'rowspan']
      .map((a) => (el.getAttribute(a) ? ` ${a}="${escapeXml(el.getAttribute(a)!)}"` : ''))
      .join('');
    return `<${tag}${span}>${this.inline(el, path)}</${tag}>`;
  }

  private image(el: Element): string {
    const ref = (attr(el, 'href') ?? '').replace(/^#/, '');
    const src = this.images.get(ref);
    if (!src) return '';
    const alt = attr(el, 'alt') ?? '';
    return `<img src="../${escapeXml(src)}" alt="${escapeXml(alt)}"/>`;
  }

  private inline(el: Element, path: string): string {
    let out = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === node.TEXT_NODE) {
        out += escapeXml(node.textContent ?? '');
        continue;
      }
      if (node.nodeType !== node.ELEMENT_NODE) continue;
      const c = node as Element;
      const content = () => this.inline(c, path);
      switch (c.localName) {
        case 'strong':
          out += `<strong>${content()}</strong>`;
          break;
        case 'emphasis':
          out += `<em>${content()}</em>`;
          break;
        case 'strikethrough':
          out += `<s>${content()}</s>`;
          break;
        case 'sub':
        case 'sup':
        case 'code':
          out += `<${c.localName}>${content()}</${c.localName}>`;
          break;
        case 'a':
          out += this.link(c, content(), path);
          break;
        case 'image':
          out += this.image(c);
          break;
        default:
          out += content();
      }
    }
    return out;
  }

  private link(el: Element, content: string, path: string): string {
    const href = attr(el, 'href') ?? '';
    const isNote = attr(el, 'type') === 'note';
    const cls = isNote ? ' class="note"' : '';
    if (href.startsWith('#')) {
      const file = this.idToFile.get(href.slice(1));
      if (!file) return content;
      const target = file === path ? href : `${file.replace(/^text\//, '')}${href}`;
      return `<a href="${escapeXml(target)}"${cls}>${content}</a>`;
    }
    if (/^(https?:|mailto:)/i.test(href)) return `<a href="${escapeXml(href)}">${content}</a>`;
    return content;
  }
}

function page(title: string, body: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/>' +
    `<title>${escapeXml(title)}</title><style>${FB2_CSS}</style></head><body>${body}</body></html>`
  );
}

function authorName(el: Element): string {
  const nick = text(child(el, 'nickname'));
  const name = ['first-name', 'middle-name', 'last-name'].map((n) => text(child(el, n))).filter(Boolean).join(' ');
  return name || nick;
}

/** Converts the FB2 file at `sourcePath` into XHTML chapters inside the book folder. */
export async function importFb2(fs: BookFs, sourcePath: string): Promise<ParsedBook> {
  const doc = parseXml(decodeFb2(await fs.readBinary(sourcePath)), 'FB2');
  const titleInfo = first(doc, 'title-info');
  const documentInfo = first(doc, 'document-info');

  const images = new Map<string, string>();
  for (const bin of all(doc, 'binary')) {
    const id = bin.getAttribute('id');
    const ext = IMAGE_EXT[(bin.getAttribute('content-type') ?? '').toLowerCase()];
    if (!id || !ext) continue;
    const file = `images/${id.replace(/[^\w.-]/g, '_')}${id.toLowerCase().endsWith(`.${ext}`) ? '' : `.${ext}`}`;
    const data = Uint8Array.from(atob((bin.textContent ?? '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    await fs.writeBinary(file, data);
    images.set(id, file);
  }

  const converter = new Converter();
  converter.registerImages(images);

  const spine: SpineItem[] = [];
  const coverImage = titleInfo && first(first(titleInfo, 'coverpage') ?? titleInfo, 'image');
  const coverRef = coverImage ? (attr(coverImage, 'href') ?? '').replace(/^#/, '') : '';
  const cover = (first(titleInfo ?? doc, 'coverpage') && images.get(coverRef)) || null;
  if (cover) {
    const coverPage = page('Cover', `<div class="image"><img src="../${escapeXml(cover)}" alt=""/></div>`);
    await fs.writeText('text/cover.xhtml', injectReader(coverPage));
    spine.push({ href: 'text/cover.xhtml', linear: true });
  }

  const bodies = all(doc, 'body').filter((b) => b.parentElement === doc.documentElement);
  for (const part of converter.plan(bodies)) {
    const chapter = converter.chapter(part);
    await fs.writeText(chapter.path, injectReader(chapter.html));
    spine.push({ href: chapter.path, linear: !part.isNotes });
  }
  if (spine.length === 0) throw new Error('FB2 book has no content');

  const title = text(child(titleInfo ?? doc.documentElement, 'book-title'));
  const authors = titleInfo ? children(titleInfo, 'author').map(authorName).filter(Boolean) : [];
  const docId = documentInfo ? text(child(documentInfo, 'id')) : '';
  return {
    identifier: docId || `${title}|${authors.join(',')}`,
    title: title || sourcePath,
    authors,
    language: titleInfo ? text(child(titleInfo, 'lang')) : '',
    cover,
    series: fb2Series(titleInfo),
    layout: 'reflowable',
    direction: 'ltr',
    spine,
    toc: converter.toc,
  };
}
