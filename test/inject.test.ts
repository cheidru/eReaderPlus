import { describe, expect, it } from 'vitest';
import { INJECTED_TAGS, injectReader } from '../src/core/inject';

describe('injectReader', () => {
  it('inserts at the start of <head> and not into <header>', () => {
    const out = injectReader('<html><head><title>x</title></head><body><header>h</header></body></html>');
    expect(out).toBe(`<html><head>${INJECTED_TAGS}<title>x</title></head><body><header>h</header></body></html>`);
  });

  it('creates a head when missing', () => {
    expect(injectReader('<html lang="en"><body/></html>')).toBe(`<html lang="en"><head>${INJECTED_TAGS}</head><body/></html>`);
  });

  it('keeps XHTML well-formed', () => {
    const source = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>x</p></body></html>';
    const doc = new DOMParser().parseFromString(injectReader(source), 'application/xhtml+xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.querySelector('script')?.getAttribute('src')).toBe('/__ereader__/paginator.js');
  });

  it('is idempotent', () => {
    const once = injectReader('<html><head></head></html>');
    expect(injectReader(once)).toBe(once);
  });
});
