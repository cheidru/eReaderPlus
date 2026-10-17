import { describe, expect, it } from 'vitest';
import type { PdfPageData, PdfPageInfo, PdfPageRenderer } from '../src/core/pdf-common';
import { PdfPageStore } from '../src/core/pdf-pages';

const info: PdfPageInfo = {
  width: 100,
  height: 100,
  viewport: { scale: 1, rotation: 0, rawDims: { pageWidth: 100, pageHeight: 100, pageX: 0, pageY: 0 } },
  text: { items: [], styles: {}, lang: null },
  links: [],
};

/** A renderer of `count` pages, each 5×5 px (100 bytes), that records what it drew; `hold('n@scale')` keeps that drawing waiting until it is cancelled. */
function fakeRenderer(count: number) {
  const drawn: string[] = [];
  const closedImages: number[] = [];
  const held = new Set<string>();
  const renderer: PdfPageRenderer = {
    count,
    rtl: false,
    async page(n, scale, signal) {
      drawn.push(`${n}@${scale}`);
      if (held.delete(`${n}@${scale}`)) {
        // Held until cancelled.
        await new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('cancelled'))));
      }
      const image = { width: 5, height: 5, page: n, close: () => closedImages.push(n) } as unknown as ImageBitmap;
      return { info, image } satisfies PdfPageData;
    },
    close: () => {},
  };
  return { renderer, drawn, closedImages, hold: (key: string) => held.add(key) };
}

/** Lets the store's drawing ahead run until it has nothing left to do. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const pageOf = (data: PdfPageData | null) => (data?.image as unknown as { page: number } | undefined)?.page;

describe('PdfPageStore', () => {
  it('draws the page asked for, then the pages around it at the same scale, three forward for each one back', async () => {
    const { renderer, drawn } = fakeRenderer(10);
    const store = new PdfPageStore(async () => renderer, 10_000);
    expect(pageOf(await store.page(5, 2))).toBe(5);
    expect(await store.book()).toEqual({ count: 10, rtl: false });
    await settle();
    expect(drawn).toEqual(['5@2', '6@2', '7@2', '8@2', '4@2', '9@2', '10@2', '3@2', '2@2', '1@2']);
    drawn.length = 0;
    // Kept: served at once, also at a scale within 1%.
    expect(pageOf(await store.page(9, 2.01))).toBe(9);
    expect(drawn).toEqual([]);
    expect(await store.page(11, 2)).toBeNull();
  });

  it('keeps as many pages as fit the budget, and frees the images it drops', async () => {
    const { renderer, drawn, closedImages } = fakeRenderer(100);
    const store = new PdfPageStore(async () => renderer, 400);
    await store.page(10, 1);
    await settle();
    expect(drawn).toEqual(['10@1', '11@1', '12@1', '13@1']);
    drawn.length = 0;
    await store.page(50, 1);
    await settle();
    expect(drawn).toEqual(['50@1', '51@1', '52@1', '53@1']);
    expect(closedImages.sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
  });

  it('draws a page again at a new scale (zooming), answering an older request for it with null', async () => {
    const { renderer, drawn, hold } = fakeRenderer(3);
    const store = new PdfPageStore(async () => renderer, 0);
    await store.page(1, 1);
    await settle();
    drawn.length = 0;
    hold('1@2');
    const older = store.page(1, 2);
    await settle();
    const newer = store.page(1, 3);
    expect(await older).toBeNull();
    expect(pageOf(await newer)).toBe(1);
    // The next page follows at the new scale.
    expect(drawn).toEqual(['1@2', '1@3', '2@3']);
  });

  it('stops drawing a page ahead when the reader asks for another', async () => {
    const { renderer, drawn, hold } = fakeRenderer(10);
    const store = new PdfPageStore(async () => renderer, 0);
    hold('2@1');
    await store.page(1, 1);
    await settle();
    // Page 2 is being drawn ahead (and held); page 5 is asked for meanwhile.
    expect(drawn).toEqual(['1@1', '2@1']);
    expect(pageOf(await store.page(5, 1))).toBe(5);
    expect(drawn.slice(2, 3)).toEqual(['5@1']);
  });

  it('rejects requests once closed', async () => {
    const { renderer } = fakeRenderer(3);
    const store = new PdfPageStore(async () => renderer, 1000);
    await store.page(1, 1);
    store.close();
    await expect(store.page(2, 1)).rejects.toThrow('closed');
  });
});
