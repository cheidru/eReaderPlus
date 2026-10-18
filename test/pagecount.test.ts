import { describe, expect, it } from 'vitest';
import { estimatePageCounts } from '../src/core/pagecount';

describe('page counts across a book', () => {
  it('estimates the documents not laid out from their text, at the pages per character measured', () => {
    const measured = new Map([[1, 10]]);
    expect(estimatePageCounts(4, [0, 5000, 2500, 12000], measured)).toEqual([1, 10, 5, 24]);
  });

  it('counts every document as long as the average one measured until the text lengths are known', () => {
    expect(estimatePageCounts(4, null, new Map([[0, 4], [1, 8]]))).toEqual([4, 8, 6, 6]);
  });

  it('gives each document at least a page, also before any is measured', () => {
    expect(estimatePageCounts(3, [100, 0, 300], new Map())).toEqual([1, 1, 1]);
  });

  it('leaves documents without text out of the pages per character', () => {
    expect(estimatePageCounts(3, [0, 1000, 1000], new Map([[0, 3], [1, 2]]))).toEqual([3, 2, 2]);
  });
});
