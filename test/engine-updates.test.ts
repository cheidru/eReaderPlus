import { describe, expect, it } from 'vitest';
import { compareVersions, engineUpdate, newestStableEngine } from '../src/core/engine-updates';

const feed = [
  { version: '46.0.0-nightly.20261014', chrome: '157.0.8103.0' },
  { version: '45.0.0-beta.3', chrome: '156.0.8078.13' },
  { version: '44.7.2', chrome: '152.0.7977.149' },
  { version: '44.7.1', chrome: '152.0.7977.149' },
  { version: '43.9.4', chrome: '150.0.7871.212' },
  { version: '44.7.0', chrome: '152.0.7977.130' },
];

describe('engine updates', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('152.0.7977.149', '152.0.7977.130')).toBeGreaterThan(0);
    expect(compareVersions('99.1', '100.0')).toBeLessThan(0);
    expect(compareVersions('44.7', '44.7.0')).toBe(0);
  });

  it('finds the stable release with the newest Chromium, skipping pre-releases', () => {
    expect(newestStableEngine(feed)).toEqual({ electron: '44.7.2', chrome: '152.0.7977.149' });
  });

  it('ignores feeds and entries it does not understand', () => {
    expect(newestStableEngine({ releases: feed })).toBeNull();
    expect(newestStableEngine([null, 'x', { version: 44, chrome: '1' }, { version: '1.0.0', chrome: '<script>' }])).toBeNull();
  });

  it('offers an update only for a newer Chromium', () => {
    const latest = newestStableEngine(feed);
    expect(engineUpdate('152.0.7977.130', latest)).toEqual(latest);
    expect(engineUpdate('152.0.7977.149', latest)).toBeNull();
    expect(engineUpdate('153.0.0.1', latest)).toBeNull();
    expect(engineUpdate('152.0.7977.130', null)).toBeNull();
  });
});
