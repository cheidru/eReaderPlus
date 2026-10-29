import { formatLabel, NO_AUTHOR, type LibraryLocation, type Shelf } from '../../core/shelves';
import type { BookFormat, LibraryEntry, Series, SortKey } from '../../core/types';
import type { IconName } from '../icons';

export const SHELVES: Record<Shelf, { label: string; icon: IconName }> = {
  reading: { label: 'Reading now', icon: 'readingNow' },
  all: { label: 'Books', icon: 'books' },
  favorites: { label: 'Favorites', icon: 'star' },
  toRead: { label: 'To read', icon: 'toRead' },
  finished: { label: 'Finished', icon: 'finished' },
  authors: { label: 'Authors', icon: 'person' },
  series: { label: 'Series', icon: 'series' },
  collections: { label: 'Collections', icon: 'collections' },
  formats: { label: 'Formats', icon: 'formats' },
  folders: { label: 'Folders', icon: 'folder' },
};

export const DRAWER_SHELVES: Shelf[] = ['reading', 'all', 'favorites', 'toRead', 'finished', 'authors', 'series', 'collections', 'formats', 'folders'];

export const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title',
  author: 'Author',
  series: 'Series',
  format: 'Format',
  added: 'Date added',
  read: 'Date read',
};

export function locationTitle(location: LibraryLocation): string {
  const { shelf, group } = location;
  // A folder's path is shown under the title, not as it.
  if (group === undefined || shelf === 'folders') return SHELVES[shelf].label;
  if (shelf === 'formats') return formatLabel(group as BookFormat);
  if (shelf === 'authors' && group === NO_AUTHOR) return 'Unknown author';
  return group;
}

/** "Harry Potter #1", or just the name when the position is unknown. */
export function seriesLabel(series: Series): string {
  return series.index === undefined ? series.name : `${series.name} #${series.index}`;
}

/**
 * Where the book's file is: its path, or on Android the place in the device's storage that a picked file's address
 * names. Null when it isn't known (books imported before it was kept, or an address that names no place).
 */
export function fileLocation(entry: LibraryEntry): string | null {
  const source = entry.source;
  if (!source) return null;
  if (!source.startsWith('content://')) return source;
  // A document address ends in the document's id, such as "primary:Books/Dune.epub" (encoded).
  let id: string;
  try {
    id = decodeURIComponent(source.slice(source.lastIndexOf('/') + 1));
  } catch {
    return null;
  }
  const [, volume, path] = /^([^:/]+):(.+\/.+)$/.exec(id) ?? [];
  if (!path) return null;
  return volume === 'primary' ? `Internal storage/${path}` : `${volume}/${path}`;
}

export function percentRead(entry: LibraryEntry): number {
  return Math.round(entry.progress * 100);
}

/** The flags a reader toggles with one tap. */
export type ToggleFlag = 'favorite' | 'reading' | 'toRead' | 'finished';

/** What can be done to a book from anywhere in the library or its details page. */
export interface BookHandlers {
  onOpen: (bookId: string) => void;
  onDetails: (bookId: string) => void;
  onToggle: (bookId: string, flag: ToggleFlag) => void;
  onCollections: (bookId: string) => void;
  onRemove: (bookId: string) => void;
}
