import { describe, expect, it } from 'vitest';
import { applyFilter, booksAt, groupsOf, isFilterActive, isFormatShown, isReading, NO_AUTHOR, shownExtensions, sortAt, sortEntries, toggleAllFormats, toggleFormat } from '../src/core/shelves';
import { ALL_FORMATS } from '../src/core/types';
import type { LibraryEntry } from '../src/core/types';

function entry(id: string, patch: Partial<LibraryEntry> = {}): LibraryEntry {
  return { id, identifier: id, format: 'epub', title: id, authors: [], cover: null, addedAt: 0, lastOpenedAt: 0, progress: 0, ...patch };
}

const books = [
  entry('Dune', { authors: ['Frank Herbert'], series: { name: 'Dune', index: 1 }, favorite: true, collections: ['SF'], lastOpenedAt: 3, addedAt: 1 }),
  entry('Emma', { authors: ['Jane Austen'], finished: true, format: 'fb2', lastOpenedAt: 1, addedAt: 3 }),
  entry('anonymous', { toRead: true, format: 'pdf', fileName: 'scan-2024.pdf', lastOpenedAt: 2, addedAt: 2 }),
  entry('Children of Dune', { authors: ['Frank Herbert'], series: { name: 'Dune', index: 3 }, collections: ['SF', 'Gift'] }),
];
const ids = (list: LibraryEntry[]) => list.map((e) => e.id);

describe('shelves', () => {
  it('puts books on shelves by their flags', () => {
    // Children of Dune was never opened (found by a folder scan), Emma is finished, anonymous waits under To read.
    expect(ids(booksAt(books, { shelf: 'reading' }))).toEqual(['Dune']);
    expect(ids(booksAt(books, { shelf: 'favorites' }))).toEqual(['Dune']);
    expect(ids(booksAt(books, { shelf: 'toRead' }))).toEqual(['anonymous']);
    expect(ids(booksAt(books, { shelf: 'finished' }))).toEqual(['Emma']);
    expect(booksAt(books, { shelf: 'all' })).toHaveLength(4);
  });

  it('keeps a book on Reading now as the reader chose, never together with To read or finished', () => {
    expect(isReading(entry('opened', { lastOpenedAt: 1 }))).toBe(true);
    expect(isReading(entry('taken off', { lastOpenedAt: 1, reading: false }))).toBe(false);
    expect(isReading(entry('put on before opening', { reading: true }))).toBe(true);
    expect(isReading(entry('to read', { reading: true, toRead: true }))).toBe(false);
    expect(isReading(entry('finished', { reading: true, finished: true }))).toBe(false);
  });

  it('lists the books of a group, and none for a group shelf without a group', () => {
    expect(booksAt(books, { shelf: 'authors' })).toEqual([]);
    expect(ids(booksAt(books, { shelf: 'authors', group: 'Frank Herbert' }))).toEqual(['Dune', 'Children of Dune']);
    expect(ids(booksAt(books, { shelf: 'authors', group: NO_AUTHOR }))).toEqual(['anonymous']);
    expect(ids(booksAt(books, { shelf: 'collections', group: 'Gift' }))).toEqual(['Children of Dune']);
    expect(ids(booksAt(books, { shelf: 'formats', group: 'pdf' }))).toEqual(['anonymous']);
  });

  it('counts groups, keeps empty collections and labels books without an author', () => {
    expect(groupsOf(books, 'authors')).toEqual([
      { key: 'Frank Herbert', label: 'Frank Herbert', count: 2 },
      { key: 'Jane Austen', label: 'Jane Austen', count: 1 },
      { key: NO_AUTHOR, label: 'Unknown author', count: 1 },
    ]);
    expect(groupsOf(books, 'collections', ['Empty', 'SF'])).toEqual([
      { key: 'Empty', label: 'Empty', count: 0 },
      { key: 'Gift', label: 'Gift', count: 1 },
      { key: 'SF', label: 'SF', count: 2 },
    ]);
    expect(groupsOf(books, 'formats').map((g) => `${g.label}:${g.count}`)).toEqual(['EPUB:2', 'FB2:1', 'PDF:1']);
  });

  it('filters by format, finished state and a search over title, author and file name', () => {
    expect(ids(applyFilter(books, { formats: ['fb2', 'pdf'], hideFinished: false }))).toEqual(['Emma', 'anonymous']);
    expect(ids(applyFilter(books, { formats: [], hideFinished: true }))).toEqual(['Dune', 'anonymous', 'Children of Dune']);
    const none = { formats: [], hideFinished: false };
    expect(ids(applyFilter(books, none, 'herbert'))).toEqual(['Dune', 'Children of Dune']);
    expect(ids(applyFilter(books, none, 'SCAN'))).toEqual(['anonymous']);
  });

  it('sorts text A to Z (case-insensitively) and dates newest first', () => {
    expect(ids(sortEntries(books, 'title'))).toEqual(['anonymous', 'Children of Dune', 'Dune', 'Emma']);
    expect(ids(sortEntries(books, 'author'))).toEqual(['Children of Dune', 'Dune', 'Emma', 'anonymous']);
    expect(ids(sortEntries(books, 'read'))).toEqual(['Dune', 'anonymous', 'Emma', 'Children of Dune']);
    expect(ids(sortEntries(books, 'added'))).toEqual(['Emma', 'anonymous', 'Dune', 'Children of Dune']);
  });

  it('groups books by series, in series order inside a series whatever the chosen sort', () => {
    const extra = [...books, entry('Dune Messiah', { series: { name: 'Dune', index: 2 }, lastOpenedAt: 9 }), entry('Prequel', { series: { name: 'Dune' } })];
    expect(groupsOf(extra, 'series')).toEqual([{ key: 'Dune', label: 'Dune', count: 4 }]);
    const location = { shelf: 'series' as const, group: 'Dune' };
    expect(ids(sortAt(booksAt(extra, location), location, 'read'))).toEqual(['Dune', 'Dune Messiah', 'Children of Dune', 'Prequel']);
    // Elsewhere the chosen sort applies; sorting by series puts books outside any series last.
    expect(ids(sortAt(extra, { shelf: 'all' }, 'read'))[0]).toBe('Dune Messiah');
    expect(ids(sortEntries(extra, 'series')).slice(-2)).toEqual(['anonymous', 'Emma']);
    expect(ids(applyFilter(extra, { formats: [], hideFinished: false }, 'dune'))).toHaveLength(4);
  });

  it('turns formats on and off, and stores all formats as no selection', () => {
    const none = { formats: [], hideFinished: false };
    const noEpub = toggleFormat(none, 'epub');
    expect(noEpub.formats).toEqual(ALL_FORMATS.filter((f) => f !== 'epub'));
    expect(isFormatShown(noEpub, 'epub')).toBe(false);
    expect(isFormatShown(noEpub, 'pdf')).toBe(true);
    expect(toggleFormat(noEpub, 'epub')).toEqual(none);
    const onlyPdf = { formats: ['pdf' as const], hideFinished: true };
    expect(toggleFormat(onlyPdf, 'fb2')).toEqual({ formats: ['pdf', 'fb2'], hideFinished: true });
    // Turning off the last format shows nothing, until a format is turned on again.
    const nothing = toggleFormat(onlyPdf, 'pdf');
    expect(nothing).toEqual({ formats: [], hideFinished: true, noFormats: true });
    expect(applyFilter(books, nothing)).toEqual([]);
    expect(isFilterActive(nothing)).toBe(true);
    expect(toggleFormat(nothing, 'fb2')).toEqual({ formats: ['fb2'], hideFinished: true });
  });

  it('turns all formats off when all are on, and all on otherwise', () => {
    const all = { formats: [], hideFinished: false };
    const nothing = toggleAllFormats(all);
    expect(ALL_FORMATS.some((f) => isFormatShown(nothing, f))).toBe(false);
    expect(shownExtensions(nothing, ['epub', 'pdf'])).toEqual([]);
    expect(toggleAllFormats(nothing)).toEqual(all);
    expect(toggleAllFormats({ formats: ['pdf'], hideFinished: true })).toEqual({ formats: [], hideFinished: true });
  });

  it('maps file extensions to the formats shown, a .mobi file counting as MOBI or AZW3', () => {
    const extensions = ['epub', 'kepub', 'mobi', 'azw3', 'pdf', 'djv'];
    expect(shownExtensions({ formats: [], hideFinished: false }, extensions)).toEqual(extensions);
    expect(shownExtensions({ formats: ['epub', 'azw3'], hideFinished: false }, extensions)).toEqual(['epub', 'kepub', 'mobi', 'azw3']);
    expect(shownExtensions({ formats: ['djvu'], hideFinished: false }, extensions)).toEqual(['djv']);
  });

  it('lists nothing directly on the Folders shelf', () => {
    expect(booksAt(books, { shelf: 'folders', group: '/books' })).toEqual([]);
  });
});
