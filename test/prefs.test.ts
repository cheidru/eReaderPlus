import { describe, expect, it } from 'vitest';
import { loadLibraryPrefs } from '../src/core/library';
import type { Platform } from '../src/platform/platform';

/** A platform whose key-value store holds `stored` as the library preferences. */
function platformWith(stored: unknown): Platform {
  return { kvGet: async () => structuredClone(stored) } as unknown as Platform;
}

describe('library preferences', () => {
  it('start in the Dusk color theme', async () => {
    expect((await loadLibraryPrefs(platformWith(null))).colorTheme).toBe('dusk');
    // Saved before color themes existed: the new default too.
    expect((await loadLibraryPrefs(platformWith({ layout: 'shelf', appTheme: 'light' }))).colorTheme).toBe('dusk');
  });

  it('keep the color theme chosen, and fall back to the default for one that no longer exists', async () => {
    expect((await loadLibraryPrefs(platformWith({ colorTheme: 'readera' }))).colorTheme).toBe('readera');
    expect((await loadLibraryPrefs(platformWith({ colorTheme: 'neon' }))).colorTheme).toBe('dusk');
  });
});
