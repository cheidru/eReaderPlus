import { describe, expect, it } from 'vitest';
import { comicSeries, epubSeries, fb2Series, parseSeriesIndex } from '../src/core/series';
import { first, parseXml } from '../src/core/xml';

const opf = (metadata: string) =>
  parseXml(
    `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
      <metadata>${metadata}</metadata><manifest/><spine/></package>`,
    'opf',
  );

describe('series metadata', () => {
  it('reads Calibre series tags from EPUB 2 books', () => {
    const doc = opf('<meta name="calibre:series" content="Harry Potter"/><meta name="calibre:series_index" content="3.0"/>');
    expect(epubSeries(doc)).toEqual({ name: 'Harry Potter', index: 3 });
  });

  it('reads an EPUB 3 collection of type series, with its position', () => {
    const doc = opf(
      `<meta property="belongs-to-collection" id="c1">The Expanse</meta>
       <meta refines="#c1" property="collection-type">series</meta>
       <meta refines="#c1" property="group-position">2.5</meta>
       <meta name="calibre:series" content="Ignored"/>`,
    );
    expect(epubSeries(doc)).toEqual({ name: 'The Expanse', index: 2.5 });
  });

  it('skips EPUB 3 collections that are sets, not series', () => {
    const doc = opf(
      `<meta property="belongs-to-collection" id="c1">Box set</meta>
       <meta refines="#c1" property="collection-type">set</meta>
       <meta property="belongs-to-collection" id="c2">Discworld</meta>`,
    );
    expect(epubSeries(doc)).toEqual({ name: 'Discworld' });
  });

  it('finds no series in an EPUB without one', () => {
    expect(epubSeries(opf('<dc:title>Alone</dc:title>'))).toBeUndefined();
  });

  it('reads the FB2 sequence', () => {
    const doc = parseXml(
      `<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info>
        <book-title>Book</book-title><sequence name=" Мир Полудня " number="4"/>
      </title-info></description></FictionBook>`,
      'fb2',
    );
    expect(fb2Series(first(doc, 'title-info'))).toEqual({ name: 'Мир Полудня', index: 4 });
    expect(fb2Series(null)).toBeUndefined();
  });

  it('reads the series of a comic from ComicInfo.xml', () => {
    const info = parseXml('<ComicInfo><Series>Saga</Series><Number>12</Number></ComicInfo>', 'ComicInfo.xml').documentElement;
    expect(comicSeries(info)).toEqual({ name: 'Saga', index: 12 });
  });

  it('keeps only plain numbers as series positions', () => {
    expect([parseSeriesIndex('02'), parseSeriesIndex(' 1.5 '), parseSeriesIndex('II'), parseSeriesIndex('1-2'), parseSeriesIndex('')]).toEqual([
      2,
      1.5,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
