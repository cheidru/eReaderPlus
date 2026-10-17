import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { comicImages, importCbz } from '../src/core/cbz';

describe('CBZ', () => {
  it('orders pages naturally and skips hidden files', () => {
    expect(comicImages(['p10.jpg', 'p2.jpg', 'p1.png', '__MACOSX/p1.jpg', '.thumb.jpg', 'info.txt'])).toEqual([
      'p1.png',
      'p2.jpg',
      'p10.jpg',
    ]);
  });

  it('builds one fixed-layout page per image', async () => {
    const fs = memoryBookFs({ 'b/2.jpg': new Uint8Array(1), 'b/1 a.jpg': new Uint8Array(1) });
    const previews: unknown[] = [];
    const book = await importCbz(fs, 'My Comic.cbz', (preview) => previews.push(preview));
    expect(previews).toEqual([{ title: 'My Comic', authors: [], cover: 'b/1 a.jpg' }]);
    expect(book.title).toBe('My Comic');
    expect(book.layout).toBe('pre-paginated');
    expect(book.cover).toBe('b/1 a.jpg');
    expect(book.spine.map((s) => s.href)).toEqual(['.ereader/pages/0001.xhtml', '.ereader/pages/0002.xhtml']);
    expect(await fs.readText('.ereader/pages/0001.xhtml')).toContain('src="../../b/1%20a.jpg"');
  });
});
