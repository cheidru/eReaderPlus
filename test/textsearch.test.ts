import { describe, expect, it } from 'vitest';
import { findInTexts, htmlText, MAX_HITS } from '../src/core/booksearch';
import { collectChunks, findOccurrences, findRange, indexText, normalizeQuery } from '../src/core/textsearch';

const body = (html: string) => new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body;
const textOf = (html: string) => indexText(collectChunks(body(html)), false).text;

describe('text extraction for search', () => {
  it('separates blocks, skips scripts and styles, and collapses whitespace', () => {
    expect(textOf('<h1>Title</h1><p>One\n   two</p><script>var x = 1</script><style>p{}</style><p>Three<br>four</p>')).toBe('title one two three four ');
  });

  it('folds case, ё, quotes and dashes, and drops soft hyphens and zero-width spaces', () => {
    expect(textOf('<p>ЁЛКА don’t «так» a—b pagi­nation zero​width</p>')).toBe('елка don\'t "так" a-b pagination zerowidth ');
    expect(normalizeQuery('  Don’t   Stop ')).toBe("don't stop");
  });

  it('keeps the text as written alongside, aligned character for character', () => {
    const index = indexText(collectChunks(body('<p>Mr.  Dur­sley</p>')), false);
    expect(index.display.trim()).toBe('Mr. Dursley');
    expect(index.display.length).toBe(index.text.length);
  });

  it('finds non-overlapping occurrences', () => {
    expect(findOccurrences('aaaa', 'aa')).toEqual([0, 2]);
    expect(findOccurrences('abc', '')).toEqual([]);
  });
});

describe('finding a match in the shown document', () => {
  it('returns the range of the n-th match, across element boundaries', () => {
    const root = body('<p>Hello <b>wor</b>ld.</p><p>Another <i>World</i>!</p>');
    expect(findRange(root, 'world', 0)?.toString()).toBe('world');
    expect(findRange(root, 'WORLD', 1)?.toString()).toBe('World');
    expect(findRange(root, 'world', 2)).toBeNull();
  });

  it('matches a phrase across a soft hyphen and a block break', () => {
    const root = body('<p>end of a para­graph</p><p>Next one</p>');
    expect(findRange(root, 'paragraph next', 0)?.toString()).toBe('para­graphNext');
  });

  it('counts matches in the same order as the app, for every occurrence', () => {
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Pagination</title></head><body><p>Pagination, <em>pagination</em>.</p><div>PAGINATION</div></body></html>';
    const appText = htmlText(new DOMParser(), 'chapter.xhtml', source);
    const shown = new DOMParser().parseFromString(source, 'application/xhtml+xml').getElementsByTagNameNS('*', 'body')[0];
    const count = findOccurrences(appText.text, 'pagination').length;
    expect(count).toBe(3);
    for (let n = 0; n < count; n++) expect(findRange(shown, 'pagination', n)?.toString().toLowerCase()).toBe('pagination');
    expect(findRange(shown, 'pagination', count)).toBeNull();
  });

  it('sees a PDF text layer (a span per item, <br> at line ends) as the app sees the items', () => {
    const items = [
      { str: 'First', hasEOL: false },
      { str: ' line', hasEOL: true },
      { str: '', hasEOL: true },
      { str: 'Second', hasEOL: false },
    ];
    const app = indexText(
      items.flatMap((item) => [...(item.str ? [{ node: null, text: item.str }] : []), ...(item.hasEOL ? [{ node: null, text: ' ' }] : [])]),
      false,
    ).text;
    const layer = body(`<div class="textLayer">${items.map((i) => (i.str ? `<span>${i.str}</span>` : '') + (i.hasEOL ? '<br>' : '')).join('')}</div>`);
    expect(indexText(collectChunks(layer), false).text.trim()).toBe(app.trim());
    expect(findRange(layer, 'line second', 0)?.toString()).toBe('lineSecond');
  });
});

describe('search results', () => {
  it('lists matches with context as written, in reading order', () => {
    const texts = [htmlText(new DOMParser(), 'a.html', '<p>Nothing here.</p>'), htmlText(new DOMParser(), 'b.html', '<p>Mr. and Mrs. Dursley, of number four.</p>')];
    expect(findInTexts(texts, 'dursley')).toEqual([{ spineIndex: 1, occurrence: 0, before: 'Mr. and Mrs. ', match: 'Dursley', after: ', of number four. ' }]);
    expect(findInTexts(texts, ' ')).toEqual([]);
  });

  it('cuts long context at word boundaries and stops at the result limit', () => {
    const long = htmlText(new DOMParser(), 'c.html', `<p>${'word '.repeat(40)}target ${'word '.repeat(40)}</p>`);
    const [hit] = findInTexts([long], 'target');
    expect(hit.before.startsWith('…word')).toBe(true);
    expect(hit.after.endsWith('word…')).toBe(true);
    const many = htmlText(new DOMParser(), 'd.html', `<p>${'x '.repeat(MAX_HITS + 50)}</p>`);
    expect(findInTexts([many], 'x')).toHaveLength(MAX_HITS);
  });
});
