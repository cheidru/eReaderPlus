/**
 * The reader keeps the spine documents next to the one shown loaded in hidden frames, so a page turn into them
 * shows them at once instead of loading them then. Each of a fixed number of frames (slots) holds one document; a
 * slot keeps its document until another one needs the slot, and the frames never move in the page (moving an
 * iframe reloads it).
 */

/** The document shown, the next one and the previous one. */
export const FRAME_SLOTS = 3;

/** The spine documents to keep loaded, most wanted first: the one shown, then the next and the previous one. */
export function wantedDocuments(current: number, next: number, previous: number, count: number): number[] {
  return [current, next, previous].filter((index, i, all) => index >= 0 && index < count && all.indexOf(index) === i);
}

/**
 * Gives each wanted document a slot, keeping the documents already loaded where they are. A wanted document goes
 * into an empty slot, or else the slot of a document no longer wanted; the `kept` slot (the frame still on screen
 * while the next one loads) is never taken. Returns `slots` itself when nothing changes.
 */
export function assignSlots(slots: readonly (number | null)[], wanted: readonly number[], kept: number | null): readonly (number | null)[] {
  let next: (number | null)[] | null = null;
  for (const index of wanted) {
    if ((next ?? slots).includes(index)) continue;
    const current = next ?? slots;
    let free = current.indexOf(null);
    if (free < 0) free = current.findIndex((held, slot) => slot !== kept && !wanted.includes(held!));
    if (free < 0 || free === kept) continue;
    next ??= [...slots];
    next[free] = index;
  }
  return next ?? slots;
}
