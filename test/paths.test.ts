import { describe, expect, it } from 'vitest';
import { encodePath, normalize, resolveHref } from '../src/core/paths';

describe('paths', () => {
  it('resolves relative hrefs against the document path', () => {
    expect(resolveHref('OEBPS/text/ch1.xhtml', '../images/a.png')).toBe('OEBPS/images/a.png');
    expect(resolveHref('OEBPS/content.opf', 'text/ch1.xhtml#x')).toBe('OEBPS/text/ch1.xhtml#x');
    expect(resolveHref('OEBPS/text/ch1.xhtml', '#note')).toBe('OEBPS/text/ch1.xhtml#note');
    expect(resolveHref('OEBPS/content.opf', 'images/cover%20art.jpg')).toBe('OEBPS/images/cover art.jpg');
  });

  it('rejects paths escaping the book root and external URLs', () => {
    expect(resolveHref('a.xhtml', '../../etc/passwd')).toBeNull();
    expect(normalize('../x')).toBeNull();
    expect(resolveHref('a.xhtml', 'https://example.com/')).toBeNull();
    expect(resolveHref('a.xhtml', 'javascript:alert(1)')).toBeNull();
  });

  it('encodes path segments for URLs', () => {
    expect(encodePath('OEBPS/cover art#1.jpg')).toBe('OEBPS/cover%20art%231.jpg');
  });
});
