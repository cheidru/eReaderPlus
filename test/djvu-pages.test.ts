import { describe, expect, it } from 'vitest';
import { DjvuPageStore, type DjvuPageDecoder } from '../src/core/djvu-pages';
import type { DjvuPageData } from '../src/core/messages';

/** A page of `bytes` bytes, tagged with its number and whether it was scaled down. */
const fakePage = (n: number, bytes: number, reduced = false): DjvuPageData => ({
  width: 1000,
  height: 1000,
  image: { data: new Uint8ClampedArray(bytes), width: n, height: reduced ? 1 : 2 } as unknown as ImageData,
  zones: null,
});

/** A decoder of `count` pages of 100 bytes that records which pages it decoded; `fail` pages throw. */
function fakeDecoder(count: number, fail: number[] = [], parallel = 1) {
  const decoded: number[] = [];
  let closed = false;
  const decoder: DjvuPageDecoder = {
    count,
    parallel,
    async decode(n) {
      decoded.push(n);
      if (fail.includes(n)) throw new Error(`bad page ${n}`);
      return fakePage(n, 100);
    },
    close: () => (closed = true),
  };
  return { decoder, decoded, isClosed: () => closed };
}

/** Halves a page's bytes, as scaling to the screen would. */
const reduce = async (page: DjvuPageData) => fakePage(page.image.width, page.image.data.byteLength / 2, true);

/** Lets the store's background decoding run until it has nothing left to do. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('DjvuPageStore', () => {
  it('decodes the page asked for, then the whole book in the background when it fits the budget', async () => {
    const { decoder, decoded } = fakeDecoder(10);
    const store = new DjvuPageStore(async () => decoder, 10_000, reduce);
    const page = await store.page(5);
    expect(page?.image.width).toBe(5);
    expect(page?.image.height).toBe(1);
    expect(store.count).toBe(10);
    await settle();
    // Outward from the reader: three pages forward for each one back.
    expect(decoded).toEqual([5, 6, 7, 8, 4, 9, 10, 3, 2, 1]);
    decoded.length = 0;
    expect((await store.page(1))?.image.width).toBe(1);
    expect((await store.page(10))?.image.width).toBe(10);
    expect(decoded).toEqual([]);
  });

  it('keeps as many pages as fit the budget, around the reader', async () => {
    const { decoder, decoded } = fakeDecoder(100);
    // Pages are kept at 50 bytes: 4 fit.
    const store = new DjvuPageStore(async () => decoder, 200, reduce);
    await store.page(10);
    await settle();
    expect(decoded).toEqual([10, 11, 12, 13]);
    decoded.length = 0;
    await store.page(50);
    await settle();
    expect(decoded).toEqual([50, 51, 52, 53]);
    decoded.length = 0;
    // Page 10 was dropped to make room.
    await store.page(10);
    expect(decoded[0]).toBe(10);
  });

  it('answers pages asked for before the background decoding', async () => {
    const { decoder, decoded } = fakeDecoder(100);
    const store = new DjvuPageStore(async () => decoder, 10_000, reduce);
    await store.page(1);
    await store.page(80);
    expect(decoded.indexOf(80)).toBeLessThanOrEqual(2);
    store.close();
  });

  it('decodes a page at full resolution when asked, and keeps it scaled down too', async () => {
    const { decoder, decoded } = fakeDecoder(3);
    const store = new DjvuPageStore(async () => decoder, 10_000, reduce);
    const full = await store.page(2, true);
    expect(full?.image.height).toBe(2);
    await settle();
    decoded.length = 0;
    expect((await store.page(2))?.image.height).toBe(1);
    expect((await store.page(2, true))?.image.height).toBe(2);
    expect(decoded).not.toContain(2);
  });

  it('answers null past the last page, and fails pages that cannot be decoded without stopping', async () => {
    const { decoder, decoded } = fakeDecoder(4, [2]);
    const store = new DjvuPageStore(async () => decoder, 10_000, reduce);
    expect(await store.page(5)).toBeNull();
    await expect(store.page(2)).rejects.toThrow('bad page 2');
    await settle();
    expect(decoded.filter((n) => n === 2)).toHaveLength(1);
    expect(new Set(decoded)).toEqual(new Set([1, 2, 3, 4]));
  });

  it('decodes as many pages at once as the decoder can, the pages asked for first', async () => {
    const { decoder } = fakeDecoder(20, [], 3);
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const slow: DjvuPageDecoder = {
      ...decoder,
      async decode(n) {
        order.push(n);
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return decoder.decode(n);
      },
    };
    const store = new DjvuPageStore(async () => slow, 10_000, reduce);
    await Promise.all([store.page(10), store.page(11)]);
    await settle();
    await settle();
    expect(order.slice(0, 2)).toEqual([10, 11]);
    expect(most).toBe(3);
    expect(new Set(order).size).toBe(order.length);
    store.close();
  });

  it('stops decoding and fails waiting pages when closed', async () => {
    const { decoder, isClosed } = fakeDecoder(3);
    let open!: (decoder: DjvuPageDecoder) => void;
    const store = new DjvuPageStore(() => new Promise((resolve) => (open = resolve)), 10_000, reduce);
    const waiting = store.page(1);
    store.close();
    open(decoder);
    await expect(waiting).rejects.toThrow('closed');
    expect(isClosed()).toBe(true);
  });

  it('fails pages when the book cannot be opened', async () => {
    const store = new DjvuPageStore(async () => {
      throw new Error('Not a DjVu file');
    }, 10_000, reduce);
    await expect(store.page(1)).rejects.toThrow('Not a DjVu file');
    expect(store.count).toBe(0);
  });
});
