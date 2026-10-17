/** Comic book archives: one generated XHTML page per image, rendered as fixed layout. */
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { injectReader } from './inject';
import { encodePath, extension } from './paths';
import { comicSeries } from './series';
import type { Series } from './types';
import { child, escapeXml, parseXml, text } from './xml';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']);

const PAGE_CSS =
  'html,body{margin:0;height:100%;background:#000}' +
  'body{display:flex;align-items:center;justify-content:center}' +
  'img{max-width:100%;max-height:100%;object-fit:contain}';

export function comicImages(files: string[]): string[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return files
    .filter((f) => IMAGE_EXTENSIONS.has(extension(f)) && !f.split('/').some((p) => p.startsWith('.') || p === '__MACOSX'))
    .sort(collator.compare);
}

export async function importCbz(fs: BookFs, fileName: string): Promise<ParsedBook> {
  const images = comicImages(fs.files);
  if (images.length === 0) throw new Error('The archive contains no images');

  const meta = { title: fileName.replace(/\.[^.]+$/, ''), authors: [] as string[], language: '', series: undefined as Series | undefined };
  if (fs.files.includes('ComicInfo.xml')) {
    try {
      const info = parseXml(await fs.readText('ComicInfo.xml'), 'ComicInfo.xml').documentElement;
      const series = text(child(info, 'Series'));
      const number = text(child(info, 'Number'));
      meta.title = text(child(info, 'Title')) || [series, number && `#${number}`].filter(Boolean).join(' ') || meta.title;
      meta.authors = text(child(info, 'Writer')).split(',').map((s) => s.trim()).filter(Boolean);
      meta.language = text(child(info, 'LanguageISO'));
      meta.series = comicSeries(info);
    } catch {
      // ComicInfo.xml is optional metadata; ignore it when malformed.
    }
  }

  const spine = [];
  for (let i = 0; i < images.length; i++) {
    const path = `.ereader/pages/${String(i + 1).padStart(4, '0')}.xhtml`;
    const html =
      '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/>' +
      `<title>${i + 1}</title><style>${PAGE_CSS}</style></head>` +
      `<body><img src="../../${escapeXml(encodePath(images[i]))}" alt=""/></body></html>`;
    await fs.writeText(path, injectReader(html));
    spine.push({ href: path, linear: true });
  }

  return {
    identifier: `cbz|${meta.title}|${images.length}`,
    title: meta.title,
    authors: meta.authors,
    language: meta.language,
    cover: images[0],
    series: meta.series,
    layout: 'pre-paginated',
    direction: 'ltr',
    spine,
    toc: [],
  };
}
