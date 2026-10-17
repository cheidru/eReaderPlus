import { describe, expect, it } from 'vitest';
import { loadBookView, loadLibraryPrefs, removeBook, saveBookView } from '../src/core/library';
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

describe('book view', () => {
  /** A platform with a working key-value store, and books that can be deleted. */
  function platformWithStore(): Platform {
    const kv = new Map<string, unknown>();
    return {
      kvGet: async (key: string) => (kv.has(key) ? structuredClone(kv.get(key)) : null),
      kvSet: async (key: string, value: unknown) => void (value === null ? kv.delete(key) : kv.set(key, structuredClone(value))),
      deleteBook: async () => {},
    } as unknown as Platform;
  }

  it('is kept for each book separately, and goes with the book', async () => {
    const platform = platformWithStore();
    expect(await loadBookView(platform, 'a')).toBeNull();
    await saveBookView(platform, 'a', { spread: true, spreadCover: true });
    await saveBookView(platform, 'b', { spread: false, spreadCover: false });
    expect(await loadBookView(platform, 'a')).toEqual({ spread: true, spreadCover: true });
    expect(await loadBookView(platform, 'b')).toEqual({ spread: false, spreadCover: false });
    await removeBook(platform, 'a');
    expect(await loadBookView(platform, 'a')).toBeNull();
    expect(await loadBookView(platform, 'b')).toEqual({ spread: false, spreadCover: false });
  });
});
