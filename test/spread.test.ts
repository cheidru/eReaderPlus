import { describe, expect, it } from 'vitest';
import { spreadEnd, spreadFits, spreadStart } from '../src/core/spread';

describe('spreads', () => {
  it('pairs pages 1–2, 3–4, …', () => {
    expect([0, 1, 2, 3, 4].map((i) => spreadStart(i, false))).toEqual([0, 0, 2, 2, 4]);
    expect([0, 2, 4].map((i) => spreadEnd(i, 5, false))).toEqual([1, 3, 4]);
  });

  it('shows the cover alone, then pairs pages 2–3, 4–5, …', () => {
    expect([0, 1, 2, 3, 4].map((i) => spreadStart(i, true))).toEqual([0, 1, 1, 3, 3]);
    expect([0, 1, 3].map((i) => spreadEnd(i, 4, true))).toEqual([0, 2, 3]);
  });

  it('needs a landscape frame wide enough for two pages', () => {
    expect(spreadFits(1000, 760)).toBe(true);
    expect(spreadFits(600, 400)).toBe(false);
    expect(spreadFits(760, 1000)).toBe(false);
  });
});
