import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addBook, bookFromFile, loadLibrary } from '../src/core/library';
import type { BookManifest } from '../src/core/types';
import type { FileRef, FileStat, Platform } from '../src/platform/platform';

/** What the next import of a file reads it as: books with the same identifier are the same book. */
let identifier = 'md:one';
let imports = 0;
vi.mock('../src/core/import', () => ({
  importBook: async (): Promise<BookManifest> =>
    ({ id: `book${++imports}`, format: 'md', identifier, title: 'Notes', authors: [], cover: null }) as unknown as BookManifest,
}));

/** A platform with a key-value store and files whose size and modification time the test sets (none: Android). */
function fakePlatform(stats: Map<string, FileStat> | null): Platform {
  const kv = new Map<string, unknown>();
  return {
    kvGet: async (key: string) => (kv.has(key) ? structuredClone(kv.get(key)) : null),
    kvSet: async (key: string, value: unknown) => void kv.set(key, structuredClone(value)),
    deleteBook: async () => {},
    ...(stats && { fileStat: async (file: FileRef) => stats.get(file.ref) ?? null }),
  } as unknown as Platform;
}

const file: FileRef = { ref: 'G:\\notes.md', name: 'notes.md' };

beforeEach(() => {
  identifier = 'md:one';
  imports = 0;
});

describe('opening a file already in the library', () => {
  it('opens its book while the file is unchanged, and imports it again once it changes', async () => {
    const stats = new Map([[file.ref, { size: 10, modified: 1 }]]);
    const platform = fakePlatform(stats);
    expect(await bookFromFile(platform, file, { unchecked: false })).toBeNull();
    const { entry } = await addBook(platform, file);
    expect((await bookFromFile(platform, file, { unchecked: false }))?.id).toBe(entry.id);

    stats.set(file.ref, { size: 12, modified: 2 });
    expect(await bookFromFile(platform, file, { unchecked: false })).toBeNull();
    // The changed file is another book; the file now opens that one.
    identifier = 'md:two';
    const changed = await addBook(platform, file);
    expect(changed.isNew).toBe(true);
    expect((await bookFromFile(platform, file, { unchecked: false }))?.id).toBe(changed.entry.id);
  });

  it('records the file of a book imported again, so the next open needs no import', async () => {
    const stats = new Map([[file.ref, { size: 10, modified: 1 }]]);
    const platform = fakePlatform(stats);
    const { entry } = await addBook(platform, file);
    // Touched without changing the book (or a copy elsewhere): imported again, found to be the same book.
    stats.set(file.ref, { size: 10, modified: 5 });
    const copy = { ref: 'D:\\copy of notes.md', name: 'copy of notes.md' };
    stats.set(copy.ref, { size: 10, modified: 7 });
    expect((await addBook(platform, file)).isNew).toBe(false);
    expect((await addBook(platform, copy)).isNew).toBe(false);
    expect(await loadLibrary(platform)).toHaveLength(1);
    expect((await bookFromFile(platform, copy, { unchecked: false }))?.id).toBe(entry.id);
  });

  it('opens the book of the same file reached by another path, while it is unchanged', async () => {
    const stats = new Map([[file.ref, { size: 10, modified: 1 }]]);
    const platform = fakePlatform(stats);
    const { entry } = await addBook(platform, file);
    const spelled = { ref: 'G:/notes.md', name: 'notes.md' };
    const moved = { ref: 'E:\\books\\notes.md', name: 'notes.md' };
    stats.set(spelled.ref, { size: 10, modified: 1 });
    stats.set(moved.ref, { size: 10, modified: 1 });
    expect((await bookFromFile(platform, spelled, { unchecked: false }))?.id).toBe(entry.id);
    expect((await bookFromFile(platform, moved, { unchecked: false }))?.id).toBe(entry.id);
    // Without the file's name, size and time all the same, it is another file.
    stats.set(moved.ref, { size: 10, modified: 2 });
    expect(await bookFromFile(platform, moved, { unchecked: false })).toBeNull();
    expect(await bookFromFile(platform, { ref: 'E:\\books\\other.md', name: 'other.md' }, { unchecked: false })).toBeNull();
  });

  it('trusts the file only when asked to where the platform cannot tell whether it changed', async () => {
    const platform = fakePlatform(null);
    const { entry } = await addBook(platform, file);
    expect(await bookFromFile(platform, file, { unchecked: false })).toBeNull();
    expect((await bookFromFile(platform, file, { unchecked: true }))?.id).toBe(entry.id);
  });

  it('imports a file again that can no longer be read', async () => {
    const stats = new Map([[file.ref, { size: 10, modified: 1 }]]);
    const platform = fakePlatform(stats);
    await addBook(platform, file);
    stats.delete(file.ref);
    expect(await bookFromFile(platform, file, { unchecked: false })).toBeNull();
  });
});
