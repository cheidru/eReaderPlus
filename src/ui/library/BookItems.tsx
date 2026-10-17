import { createContext, useContext } from 'react';
import { formatLabel } from '../../core/shelves';
import type { LibraryEntry, LibraryLayout } from '../../core/types';
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

/** Ids of books whose cover is still being drawn: their placeholder shimmers until the cover arrives. */
export const DrawingCovers = createContext<ReadonlySet<string>>(new Set());

/** A book file being imported, shown as a card until its book replaces it. */
export interface ImportingBook {
  key: string;
  fileName: string;
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
  const drawing = useContext(DrawingCovers).has(entry.id);
  if (entry.cover) return <img className="cover-img" src={bookUrl(platform, entry.id, entry.cover)} alt="" loading="lazy" draggable={false} />;
  return <CoverPlaceholder title={entry.title} author={entry.authors[0]} drawing={drawing} />;
}

/** Star, clock, double check and collections: the toggles ReadEra puts on every book. */
export function BookToggles({ entry, books }: { entry: LibraryEntry; books: BookHandlers }) {
  const inCollection = (entry.collections?.length ?? 0) > 0;
  return (
    <>
      <button type="button" className="icon-button toggle" aria-pressed={!!entry.favorite} aria-label="Favorite" title="Favorite" onClick={() => books.onToggle(entry.id, 'favorite')}>
        <Icon name={entry.favorite ? 'star' : 'starOutline'} />
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
  onMenu: (anchor: HTMLElement, entry: LibraryEntry) => void;
}

/** ReadEra-style card: cover on the left, title and details on the right, toggles along the bottom. */
export function BookCard({ platform, entry, books, onMenu }: ItemProps) {
  const percent = percentRead(entry);
  return (
    <li className="book-card">
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
    <li className="book-card shelf-tile">
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

/** A book file still being imported: its name on a shimmering placeholder, in the card or shelf layout. */
export function ImportingItem({ book, layout }: { book: ImportingBook; layout: LibraryLayout }) {
  const title = book.fileName.replace(/\.[^.]+$/, '');
  const cover = <CoverPlaceholder title={title} drawing />;
  if (layout === 'shelf') {
    return (
      <li className="book-card shelf-tile book-importing" aria-busy="true" title={book.fileName}>
        <div className="book-open">
          <span className="tile-cover">{cover}</span>
        </div>
        <div className="tile-footer">
          <span className="tile-status">Importing…</span>
        </div>
      </li>
    );
  }
  return (
    <li className="book-card book-importing" aria-busy="true">
      <div className="book-open" title={book.fileName}>
        <span className="book-cover">{cover}</span>
        <span className="book-text">
          <span className="book-title">{title}</span>
          <span className="book-meta">Importing…</span>
        </span>
      </div>
    </li>
  );
}
