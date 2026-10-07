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
  });

  it('rejects malformed or dangerous messages', () => {
    expect(parseFrameMessage(null)).toBeNull();
    expect(parseFrameMessage({ type: 'ready' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'eval', code: 'x' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'external', href: 'file:///etc/passwd' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'external', href: 'javascript:alert(1)' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'edge', dir: 5 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'key', key: 'F12' })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'zoom', zoom: Number.NaN, panX: 0 })).toBeNull();
    expect(parseFrameMessage({ tag: 'ereader', type: 'textzoom', dir: 10 })).toBeNull();
  });
});
