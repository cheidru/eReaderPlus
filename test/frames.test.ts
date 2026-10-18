import { describe, expect, it } from 'vitest';
import { assignSlots, wantedDocuments } from '../src/core/frames';

describe('frames loaded ahead', () => {
  it('wants the document shown, then the next and the previous, inside the book', () => {
    expect(wantedDocuments(5, 6, 4, 10)).toEqual([5, 6, 4]);
    expect(wantedDocuments(0, 1, -1, 10)).toEqual([0, 1]);
    expect(wantedDocuments(9, 10, 8, 10)).toEqual([9, 8]);
    expect(wantedDocuments(0, 1, 0, 1)).toEqual([0]);
  });

  it('keeps loaded documents in their frames and fills empty frames first', () => {
    const slots = [5, null, null];
    expect(assignSlots(slots, [5], [0])).toBe(slots);
    expect(assignSlots(slots, [5, 6, 4], [0])).toEqual([5, 6, 4]);
  });

  it('turning a page reuses the frame of the document left behind', () => {
    expect(assignSlots([5, 6, 4], [6, 7, 5], [1])).toEqual([5, 6, 7]);
    expect(assignSlots([5, 6, 7], [5, 6, 4], [0])).toEqual([5, 6, 4]);
  });

  it('never takes the frame still on screen while the next document loads', () => {
    expect(assignSlots([5, 6, 4], [20], [0])).toEqual([5, 20, 4]);
    expect(assignSlots([5, 20, 4], [20, 21, 19], [0])).toEqual([5, 20, 21]);
    // Once the new document is on screen, the old one's frame is free.
    expect(assignSlots([5, 20, 21], [20, 21, 19], [1])).toEqual([19, 20, 21]);
  });

  it('keeps the document of the frame a wheel spin goes to', () => {
    // Spinning on from document 4 (slot 0) into 6: the frame of 4 is out of sight, yet still gets the spin.
    expect(assignSlots([4, 5, 6, 7], [7, 8, 6], [3, 0])).toEqual([4, 8, 6, 7]);
    expect(assignSlots([4, 8, 6, 7], [8, 9, 7], [1, 0])).toEqual([4, 8, 9, 7]);
    // Once the spin ends, its frame is free.
    expect(assignSlots([4, 8, 9, 7], [9, 10, 8], [2])).toEqual([10, 8, 9, 7]);
  });
});
