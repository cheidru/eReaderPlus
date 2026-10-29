import { describe, expect, it } from 'vitest';
import { parseFrameMessage } from '../src/core/messages';

describe('parseFrameMessage', () => {
  it('accepts and sanitizes valid messages', () => {
    expect(parseFrameMessage({ tag: 'ereader', type: 'relocate', page: 2.7, pageCount: 0, fraction: 3 })).toEqual({
      type: 'relocate',
      page: 2,
      pageCount: 1,
      fraction: 1,
    });
    expect(parseFrameMessage({ tag: 'ereader', type: 'external', href: 'https://example.com', extra: 1 })).toEqual({
      type: 'external',
      href: 'https://example.com',
    });
    expect(parseFrameMessage({ tag: 'ereader', type: 'zoom', zoom: 100, panX: -1 })).toEqual({ type: 'zoom', zoom: 6, panX: 0 });
    expect(parseFrameMessage({ tag: 'ereader', type: 'zoom', zoom: 0.2, panX: 0.4 })).toEqual({ type: 'zoom', zoom: 1, panX: 0.4 });
    expect(parseFrameMessage({ tag: 'ereader', type: 'textzoom', dir: -1 })).toEqual({ type: 'textzoom', dir: -1 });
    expect(parseFrameMessage({ tag: 'ereader', type: 'djvuPage', page: 3 })).toEqual({ type: 'djvuPage', page: 3, full: false });
    expect(parseFrameMessage({ tag: 'ereader', type: 'djvuPage', page: 3, full: true })).toEqual({ type: 'djvuPage', page: 3, full: true });
    expect(parseFrameMessage({ tag: 'ereader', type: 'pdfPage', page: 2, scale: 2.5 })).toEqual({ type: 'pdfPage', page: 2, scale: 2.5 });
    expect(parseFrameMessage({ tag: 'ereader', type: 'image', src: 'book://abc/OEBPS/images/fig1.jpg' })).toEqual({
      type: 'image',
      src: 'book://abc/OEBPS/images/fig1.jpg',
    });
    expect(parseFrameMessage({ tag: 'ereader', type: 'passWheel', deltaX: 0, deltaY: 100, ctrlKey: 1, x: 5, y: 6, extra: 1 })).toEqual({
      type: 'passWheel',
      deltaX: 0,
      deltaY: 100,
      ctrlKey: false,
      x: 5,
      y: 6,
    });
  });

  it('rejects malformed or dangerous messages', () => {
    expect(parseFrameMessage(null)).toBeNull();
    expect(parseFrameMessage({ type: 'ready' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'eval', code: 'x' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'external', href: 'file:///etc/passwd' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'external', href: 'javascript:alert(1)' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'edge', dir: 5 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'key', key: 'F12' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'image', src: { toString: () => 'x' } })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'zoom', zoom: Number.NaN, panX: 0 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'textzoom', dir: 10 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'djvuPage', page: 0 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'djvuPage', page: 1.5 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'djvuPage', page: '2' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'pdfPage', page: 0, scale: 1 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'pdfPage', page: 1, scale: 0 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'pdfPage', page: 1, scale: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'passWheel', deltaX: 0, deltaY: '100', x: 0, y: 0 })).toBeNull();
  });
});
