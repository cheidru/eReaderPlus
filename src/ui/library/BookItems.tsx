import { useState, type MouseEvent } from 'react';
import type { ImportPreview } from '../../core/import';
import { formatLabel, isReading } from '../../core/shelves';
import type { LibraryEntry, LibraryLayout } from '../../core/types';
import type { MenuAnchor } from '../Dialogs';
import { bookUrl, type Platform } from '../../platform';
import { Icon } from '../icons';
import { percentRead, seriesLabel, type BookHandlers } from './shelfInfo';

/** Muted cover colors for books without a cover image, picked from the title so a book keeps its color. */
const PLACEHOLDER_COLORS = ['#5d4037', '#455a64', '#6a1b9a', '#2e7d32', '#ad1457', '#00695c', '#4527a0', '#8d6e63', '#37474f', '#9e3d22'];

function placeholderColor(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length];
}

/** A book file being imported, shown as a card until its book replaces it. */
export interface ImportingBook {
  key: string;
  fileName: string;
  /** Its title and cover, as soon as the importer knows them. */
  preview: ImportPreview | null;
}

function CoverPlaceholder({ title, author, drawing }: { title: string; author?: string; drawing: boolean }) {
  return (
    <span className={drawing ? 'cover-placeholder cover-drawing' : 'cover-placeholder'} style={{ background: placeholderColor(title) }}>
      <span className="cover-placeholder-title">{title}</span>
      {author && <span className="cover-placeholder-author">{author}</span>}
    </span>
  );
}

export function Cover({ platform, entry }: { platform: Platform; entry: LibraryEntry }) {
  /** The cover that could not be shown (not a picture after all, or missing): the placeholder shows instead. */
  const [failed, setFailed] = useState<string | null>(null);
  if (entry.cover && entry.cover !== failed) {
    return <img className="cover-img" src={bookUrl(platform, entry.id, entry.cover)} alt="" loading="lazy" draggable={false} onError={() => setFailed(entry.cover)} />;
  }
  return <CoverPlaceholder title={entry.title} author={entry.authors[0]} drawing={false} />;
}

/** Star, glasses, bookmark, double check and collections: the toggles ReadEra puts on every book. */
export function BookToggles({ entry, books }: { entry: LibraryEntry; books: BookHandlers }) {
  const inCollection = (entry.collections?.length ?? 0) > 0;
  return (
    <>
      <button type="button" className="icon-button toggle" aria-pressed={!!entry.favorite} aria-label="Favorite" title="Favorite" onClick={() => books.onToggle(entry.id, 'favorite')}>
        <Icon name={entry.favorite ? 'star' : 'starOutline'} />
      </button>
      <button type="button" className="icon-button toggle" aria-pressed={isReading(entry)} aria-label="Reading now" title="Reading now" onClick={() => books.onToggle(entry.id, 'reading')}>
        <Icon name="readingNow" />
      </button>
      <button type="button" className="icon-button toggle" aria-pressed={!!entry.toRead} aria-label="To read" title="To read" onClick={() => books.onToggle(entry.id, 'toRead')}>
        <Icon name="toRead" />
      </button>
      <button type="button" className="icon-button toggle" aria-pressed={!!entry.finished} aria-label="Finished" title="Finished" onClick={() => books.onToggle(entry.id, 'finished')}>
        <Icon name="finished" />
      </button>
      <button type="button" className="icon-button toggle" aria-pressed={inCollection} aria-label="Collections" title="Collections" onClick={() => books.onCollections(entry.id)}>
        <Icon name="collections" />
      </button>
    </>
  );
}

interface ItemProps {
  platform: Platform;
  entry: LibraryEntry;
  books: BookHandlers;
  /** Opens the book's menu: from its menu button, or where the card was right-clicked. */
  onMenu: (anchor: MenuAnchor, entry: LibraryEntry) => void;
}

/** A right click on a book opens its menu where it was clicked. */
function openContextMenu(event: MouseEvent, entry: LibraryEntry, onMenu: ItemProps['onMenu']) {
  event.preventDefault();
  onMenu({ x: event.clientX, y: event.clientY }, entry);
}

/** ReadEra-style card: cover on the left, title and details on the right, toggles along the bottom. */
export function BookCard({ platform, entry, books, onMenu }: ItemProps) {
  const percent = percentRead(entry);
  return (
    <li className="book-card" onContextMenu={(e) => openContextMenu(e, entry, onMenu)}>
      <button type="button" className="book-open" onClick={() => books.onOpen(entry.id)} title={entry.title}>
        <span className="book-cover">
          <Cover platform={platform} entry={entry} />
        </span>
        <span className="book-text">
          <span className="book-title">{entry.title}</span>
          {entry.authors.length > 0 && <span className="book-author">{entry.authors.join(', ')}</span>}
          {entry.series && <span className="book-author">{seriesLabel(entry.series)}</span>}
          <span className="book-meta">
            {formatLabel(entry.format)}
            {entry.finished ? ' · Finished' : percent > 0 ? ` · ${percent}%` : ''}
          </span>
        </span>
      </button>
      <div className="book-card-bottom">
        <div className="book-progress" role="progressbar" aria-label="Read" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="book-progress-fill" style={{ width: `${entry.finished ? 100 : percent}%` }} />
        </div>
        <div className="book-actions">
          <BookToggles entry={entry} books={books} />
          <button type="button" className="icon-button" aria-label={`More actions for ${entry.title}`} onClick={(e) => onMenu(e.currentTarget, entry)}>
            <Icon name="moreVert" />
          </button>
        </div>
      </div>
    </li>
  );
}

/** Plain cover tile, like the iPad Books library: the cover, its file format (checked when finished, NEW when unopened), and a "…" button. */
export function ShelfTile({ platform, entry, books, onMenu }: ItemProps) {
  return (
    <li className="book-card shelf-tile" onContextMenu={(e) => openContextMenu(e, entry, onMenu)}>
      <button type="button" className="book-open" onClick={() => books.onOpen(entry.id)} title={entry.title}>
        <span className="tile-cover">
          <Cover platform={platform} entry={entry} />
        </span>
      </button>
      <div className="tile-footer">
        <span className="tile-status" title={entry.finished ? 'Finished' : undefined}>
          {entry.finished && <Icon name="check" className="tile-check" />}
          {formatLabel(entry.format)}
          {!entry.finished && entry.lastOpenedAt === 0 && <span className="tile-badge">New</span>}
        </span>
        <button type="button" className="icon-button tile-more" aria-label={`More actions for ${entry.title}`} onClick={(e) => onMenu(e.currentTarget, entry)}>
          <Icon name="moreHoriz" />
        </button>
      </div>
    </li>
  );
}

/** The title shown for a book being imported: its own once known, its file name until then. */
export const importingTitle = (book: ImportingBook) => book.preview?.title || book.fileName.replace(/\.[^.]+$/, '');

interface ImportingItemProps {
  platform: Platform;
  book: ImportingBook;
  layout: LibraryLayout;
  /** Opens the book once it is imported (showing a wait until then). */
  onOpen: () => void;
}

/**
 * A book file still being imported, in the card or shelf layout: its cover and title as soon as the importer knows
 * them, its file name on a shimmering placeholder until then.
 */
export function ImportingItem({ platform, book, layout, onOpen }: ImportingItemProps) {
  const title = importingTitle(book);
  const { preview } = book;
  const cover = preview?.cover ? (
    <img className="cover-img" src={bookUrl(platform, preview.bookId, preview.cover)} alt="" draggable={false} />
  ) : (
    <CoverPlaceholder title={title} author={preview?.authors[0]} drawing />
  );
  if (layout === 'shelf') {
    return (
      <li className="book-card shelf-tile book-importing" aria-busy="true">
        <button type="button" className="book-open" onClick={onOpen} title={title}>
          <span className="tile-cover">{cover}</span>
        </button>
        <div className="tile-footer">
          <span className="tile-status">Importing…</span>
        </div>
      </li>
    );
  }
  return (
    <li className="book-card book-importing" aria-busy="true">
      <button type="button" className="book-open" onClick={onOpen} title={title}>
        <span className="book-cover">{cover}</span>
        <span className="book-text">
          <span className="book-title">{title}</span>
          {preview && preview.authors.length > 0 && <span className="book-author">{preview.authors.join(', ')}</span>}
          <span className="book-meta">Importing…</span>
        </span>
      </button>
    </li>
  );
}
