/** Comic book archives: one generated XHTML page per image, rendered as fixed layout. */
import type { BookFs } from './bookfs';
import type { ParsedBook } from './epub';
import { injectReader } from './inject';
import { encodePath, extension } from './paths';
import { comicSeries } from './series';
import { COMIC_PAGES_VERSION, type BookManifest, type OnPreview, type Series } from './types';
import { child, escapeXml, parseXml, text } from './xml';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']);

/**
 * A page is its image fitted to the screen. In a spread (the paginator sets data-ereader-spread) the next image is
 * shown beside it, the two meeting in the middle like the pages of an open book ('pair'), or the image is shown alone
 * in the middle, as large as a page of a pair ('single': the cover). In a right-to-left comic the first page is on
 * the right.
 */
const PAGE_CSS =
  'html,body{margin:0;height:100%;background:#000}' +
  'body{display:flex;align-items:center;justify-content:center}' +
  'img{max-width:100%;max-height:100%;object-fit:contain}' +
  '.next{display:none}' +
  'html[data-ereader-spread] body{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:center}' +
  'html[data-ereader-spread] img{max-height:100vh}' +
  'html[data-ereader-spread] .page{justify-self:end}' +
  "html[data-ereader-spread='pair'] .next{display:block;justify-self:start}" +
  "html[data-ereader-spread='single'] .page{grid-column:1/3;justify-self:center;max-width:50%}";

export function comicImages(files: string[]): string[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return files
    .filter((f) => IMAGE_EXTENSIONS.has(extension(f)) && !f.split('/').some((p) => p.startsWith('.') || p === '__MACOSX'))
    .sort(collator.compare);
}

/** URL of a book-root-relative image from a page document. */
const imageUrl = (image: string) => escapeXml(`../../${encodePath(image)}`);

/** The page document of image `i`, which also holds the next image for two-page spreads. */
function pageHtml(images: string[], i: number, direction: 'ltr' | 'rtl'): string {
  const next = images[i + 1];
  return injectReader(
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n' +
      `<html xmlns="http://www.w3.org/1999/xhtml" dir="${direction}"><head><meta charset="utf-8"/>` +
      `<title>${i + 1}</title><style>${PAGE_CSS}</style></head>` +
      `<body><img class="page" src="${imageUrl(images[i])}" alt=""/>` +
      (next ? `<img class="next" src="${imageUrl(next)}" alt=""/>` : '') +
      '</body></html>',
  );
}

/** Writes the page document of each image to its path in `paths`. */
async function writePages(fs: BookFs, paths: string[], images: string[], direction: 'ltr' | 'rtl'): Promise<void> {
  for (let i = 0; i < images.length; i++) await fs.writeText(paths[i], pageHtml(images, i, direction));
}

export async function importCbz(fs: BookFs, fileName: string, onPreview?: OnPreview): Promise<ParsedBook> {
  const images = comicImages(fs.files);
  if (images.length === 0) throw new Error('The archive contains no images');

  const meta = {
    title: fileName.replace(/\.[^.]+$/, ''),
    authors: [] as string[],
    language: '',
    series: undefined as Series | undefined,
    direction: 'ltr' as 'ltr' | 'rtl',
  };
  if (fs.files.includes('ComicInfo.xml')) {
    try {
      const info = parseXml(await fs.readText('ComicInfo.xml'), 'ComicInfo.xml').documentElement;
      const series = text(child(info, 'Series'));
      const number = text(child(info, 'Number'));
      meta.title = text(child(info, 'Title')) || [series, number && `#${number}`].filter(Boolean).join(' ') || meta.title;
      meta.authors = text(child(info, 'Writer')).split(',').map((s) => s.trim()).filter(Boolean);
      meta.language = text(child(info, 'LanguageISO'));
      meta.series = comicSeries(info);
      // Manga read from right to left.
      if (text(child(info, 'Manga')) === 'YesAndRightToLeft') meta.direction = 'rtl';
    } catch {
      // ComicInfo.xml is optional metadata; ignore it when malformed.
    }
  }

  onPreview?.({ title: meta.title, authors: meta.authors, cover: images[0] });
  const paths = images.map((_, i) => `.ereader/pages/${String(i + 1).padStart(4, '0')}.xhtml`);
  await writePages(fs, paths, images, meta.direction);

  return {
    identifier: `cbz|${meta.title}|${images.length}`,
    title: meta.title,
    authors: meta.authors,
    language: meta.language,
    cover: images[0],
    series: meta.series,
    layout: 'pre-paginated',
    direction: meta.direction,
    spine: paths.map((href) => ({ href, linear: true })),
    toc: [],
    pagesVersion: COMIC_PAGES_VERSION,
  };
}

/**
 * Writes the page documents of a comic imported with older ones again (see COMIC_PAGES_VERSION), finding its images
 * in them. Returns the updated manifest, or null when the book needs nothing (or its pages can't be read).
 */
export async function upgradeComicPages(fs: BookFs, manifest: BookManifest): Promise<BookManifest | null> {
  if (manifest.format !== 'cbz' || (manifest.pagesVersion ?? 1) >= COMIC_PAGES_VERSION) return null;
  const images: string[] = [];
  for (const item of manifest.spine) {
    const src = parseXml(await fs.readText(item.href), item.href).querySelector('img')?.getAttribute('src');
    if (!src?.startsWith('../../')) return null;
    images.push(decodeURIComponent(src.slice('../../'.length)));
  }
  await writePages(fs, manifest.spine.map((item) => item.href), images, manifest.direction);
  return { ...manifest, pagesVersion: COMIC_PAGES_VERSION };
}
