import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isInside, saveWatchedFolders, scanWatchedFolders, SCAN_EXTENSIONS, withFolder } from '../src/core/folders';
import type { FoundBookFile, Platform } from '../src/platform/platform';

const addBook = vi.fn();
vi.mock('../src/core/library', () => ({ addBook: (...args: unknown[]) => addBook(...args) }));

/** A platform with a key-value store and a fixed set of files per folder. */
function fakePlatform(files: Record<string, FoundBookFile[]>): Platform {
  const kv = new Map<string, unknown>();
  return {
    kvGet: async (key: string) => (kv.has(key) ? structuredClone(kv.get(key)) : null),
    kvSet: async (key: string, value: unknown) => void kv.set(key, structuredClone(value)),
    findBookFiles: async (folder: string, extensions: string[]) => {
      expect(extensions).toEqual(SCAN_EXTENSIONS);
      return files[folder] ?? [];
    },
  } as unknown as Platform;
}

const book = (path: string, size = 100, modified = 1): FoundBookFile => ({ file: { ref: path, name: path.split('/').pop()! }, path, size, modified });

beforeEach(() => {
  addBook.mockReset();
  addBook.mockImplementation(async (_platform: Platform, file: { ref: string }) => {
    if (file.ref.endsWith('broken.epub')) throw new Error('damaged');
    return { entry: { id: `id:${file.ref}` }, isNew: !file.ref.includes('duplicate') };
  });
});

describe('watched folder scans', () => {
  it('imports every book file once, as not yet opened, and counts what happened', async () => {
    const platform = fakePlatform({ '/books': [book('/books/a.epub'), book('/books/sub/b.fb2'), book('/books/duplicate.pdf'), book('/books/broken.epub')] });
    await saveWatchedFolders(platform, ['/books']);
    expect(await scanWatchedFolders(platform)).toEqual({ found: 4, added: 2, failed: 1 });
    expect(addBook).toHaveBeenCalledTimes(4);
    expect(addBook.mock.calls.every((call) => call[2]?.opened === false)).toBe(true);

    // Nothing changed: nothing is imported again, not even the file that failed.
    addBook.mockClear();
    expect(await scanWatchedFolders(platform)).toEqual({ found: 4, added: 0, failed: 0 });
    expect(addBook).not.toHaveBeenCalled();
  });

  it('imports a file again only when it changes', async () => {
    const files = { '/books': [book('/books/a.epub', 100, 1)] };
    const platform = fakePlatform(files);
    await saveWatchedFolders(platform, ['/books']);
    await scanWatchedFolders(platform);
    files['/books'] = [book('/books/a.epub', 100, 1), book('/books/new.epub')];
    await scanWatchedFolders(platform);
    files['/books'] = [book('/books/a.epub', 120, 2), book('/books/new.epub')];
    await scanWatchedFolders(platform);
    expect(addBook.mock.calls.map((call) => call[1].ref)).toEqual(['/books/a.epub', '/books/new.epub', '/books/a.epub']);
  });

  it('runs one scan at a time and reports progress', async () => {
    const platform = fakePlatform({ '/b': [book('/b/1.epub'), book('/b/2.epub')] });
    await saveWatchedFolders(platform, ['/b']);
    const progress: string[] = [];
    const onProgress = (done: number, total: number) => progress.push(`${done}/${total}`);
    const [first, second] = await Promise.all([scanWatchedFolders(platform, { onProgress }), scanWatchedFolders(platform)]);
    expect(first).toBe(second);
    expect(addBook).toHaveBeenCalledTimes(2);
    expect(progress).toEqual(['0/2', '1/2', '2/2']);
  });

  it('reports each file as it is imported: its preview, then its book', async () => {
    const platform = fakePlatform({ '/b': [book('/b/1.pdf'), book('/b/2.pdf'), book('/b/3.pdf')] });
    await saveWatchedFolders(platform, ['/b']);
    const log: string[] = [];
    addBook.mockImplementation(async (_platform: Platform, file: { ref: string }, { onPreview }: { onPreview: (p: unknown) => void }) => {
      log.push(`import ${file.ref}`);
      onPreview({ bookId: `id:${file.ref}`, title: file.ref, authors: [], cover: null });
      if (file.ref === '/b/2.pdf') throw new Error('damaged');
      return { entry: { id: `id:${file.ref}` }, isNew: file.ref !== '/b/3.pdf' };
    });
    const result = await scanWatchedFolders(platform, {
      onImporting: (file) => log.push(`importing ${file.ref}`),
      onPreview: (preview) => log.push(`preview ${preview.title}`),
      onImported: (entry, isNew) => log.push(`imported ${entry?.id ?? 'nothing'}${isNew ? ' (new)' : ''}`),
    });
    expect(result).toEqual({ found: 3, added: 1, failed: 1 });
    expect(log).toEqual([
      'importing /b/1.pdf',
      'import /b/1.pdf',
      'preview /b/1.pdf',
      'imported id:/b/1.pdf (new)',
      'importing /b/2.pdf',
      'import /b/2.pdf',
      'preview /b/2.pdf',
      'imported nothing',
      'importing /b/3.pdf',
      'import /b/3.pdf',
      'preview /b/3.pdf',
      'imported id:/b/3.pdf',
    ]);
  });
});

describe('choosing folders', () => {
  it('knows when a path is inside a folder, for either separator and Windows drive letters in any case', () => {
    expect(isInside('/books/sf', '/books')).toBe(true);
    expect(isInside('/books', '/books/')).toBe(true);
    expect(isInside('/bookshelf', '/books')).toBe(false);
    expect(isInside('c:\\Users\\Me\\Books\\SF', 'C:\\Users\\Me\\Books')).toBe(true);
    expect(isInside('/Books', '/books')).toBe(false);
  });

  it('ignores a folder already covered, and replaces folders the new one contains', () => {
    expect(withFolder(['/books'], '/books/sf')).toEqual(['/books']);
    expect(withFolder(['/books/sf', '/books/history', '/music'], '/books')).toEqual(['/music', '/books']);
    expect(withFolder([], '/books')).toEqual(['/books']);
  });

  it('does not scan plain zip archives', () => {
    expect(SCAN_EXTENSIONS).not.toContain('zip');
    expect(SCAN_EXTENSIONS).toEqual(expect.arrayContaining(['epub', 'pdf', 'fb2', 'cbz', 'djvu']));
  });
});
