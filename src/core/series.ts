/** Reads a book's series from the metadata each format uses for it. */
import type { Series } from './types';
import { all, attr, child, first, text } from './xml';

/** "2", "2.5" or "02" become numbers; anything else (empty, "II", "1-2") leaves the position unknown. */
export function parseSeriesIndex(value: string | null | undefined): number | undefined {
  const trimmed = value?.trim() ?? '';
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

function series(name: string, index: string | null | undefined): Series | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const position = parseSeriesIndex(index);
  return position === undefined ? { name: trimmed } : { name: trimmed, index: position };
}

/**
 * EPUB: the EPUB 3 `belongs-to-collection` property (a collection of type "series", or of no stated type),
 * else Calibre's `calibre:series` / `calibre:series_index`, which most EPUB 2 books in the wild carry.
 */
export function epubSeries(opf: Document): Series | undefined {
  const metadata = first(opf, 'metadata');
  if (!metadata) return undefined;
  const metas = all(metadata, 'meta');
  const refining = (id: string, property: string) => metas.find((m) => attr(m, 'refines') === `#${id}` && attr(m, 'property') === property);

  for (const collection of metas.filter((m) => attr(m, 'property') === 'belongs-to-collection')) {
    const id = attr(collection, 'id');
    const type = id ? text(refining(id, 'collection-type')) : '';
    if (type && type !== 'series') continue;
    const found = series(text(collection), id ? text(refining(id, 'group-position')) : null);
    if (found) return found;
  }

  const named = (name: string) => {
    const meta = metas.find((m) => attr(m, 'name') === name);
    return meta ? attr(meta, 'content') : null;
  };
  return series(named('calibre:series') ?? '', named('calibre:series_index'));
}

/** FB2: `<sequence name="…" number="…"/>` in title-info. */
export function fb2Series(titleInfo: Element | null): Series | undefined {
  const sequence = titleInfo ? child(titleInfo, 'sequence') : null;
  return sequence ? series(attr(sequence, 'name') ?? '', attr(sequence, 'number')) : undefined;
}

/** Comic archives: `<Series>` and `<Number>` in ComicInfo.xml. */
export function comicSeries(info: Element): Series | undefined {
  return series(text(child(info, 'Series')), text(child(info, 'Number')));
}
