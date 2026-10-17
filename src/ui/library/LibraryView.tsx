import { useEffect, useMemo, useState } from 'react';
import { SCAN_EXTENSIONS } from '../../core/folders';
import {
  applyFilter,
  booksAt,
  formatLabel,
  groupsOf,
  isFilterActive,
  isFormatShown,
  isGroupShelf,
  shownExtensions,
  sortAt,
  toggleFormat,
  type LibraryLocation,
  type Shelf,
} from '../../core/shelves';
import { ALL_FORMATS, type BookFormat, type LibraryEntry, type LibraryPrefs, type SortKey } from '../../core/types';
import type { FileRef, FolderListing, Platform } from '../../platform';
import { FilterDialog, PopupMenu, type MenuItem } from '../Dialogs';
import { Icon, type IconName } from '../icons';
import { FolderAccessPrompt } from '../pages/FolderPicker';
import { BookCard, ImportingItem, ShelfTile, type ImportingBook } from './BookItems';
import { DRAWER_SHELVES, locationTitle, percentRead, SHELVES, SORT_LABELS, type BookHandlers } from './shelfInfo';
import './LibraryView.css';

interface Props {
  platform: Platform;
  entries: LibraryEntry[];
  /** Book files being imported, shown first on the shelves new books go to. */
  importing: ImportingBook[];
  /** Every collection name, including empty collections. */
  collections: string[];
  prefs: LibraryPrefs;
  location: LibraryLocation;
  onLocationChange: (location: LibraryLocation) => void;
  onPrefsChange: (prefs: LibraryPrefs) => void;
  books: BookHandlers;
  /** A book file picked in Folders: opens its book, importing it first if it isn't in the library yet. */
  onOpenFile: (file: FileRef) => void;
  onAdd: () => void;
  onCreateCollection: () => void;
  onDeleteCollection: (name: string) => void;
  onSettings: () => void;
  onAbout: () => void;
}

type Menu = { kind: 'main' | 'sort'; anchor: HTMLElement } | { kind: 'book'; anchor: HTMLElement; entry: LibraryEntry };

/** The three shelves on the iPad-style tab bar; the drawer reaches the rest. */
const SHELF_TABS: Shelf[] = ['reading', 'all', 'collections'];
const SHELF_TAB_LABELS: Partial<Record<Shelf, string>> = { all: 'Library' };

export function LibraryView(props: Props) {
  const { platform, entries, collections, prefs, location, onLocationChange, onPrefsChange, books } = props;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  /** null when the search field is closed. */
  const [search, setSearch] = useState<string | null>(null);
  const layout = prefs.layout;

  useEffect(() => setSearch(null), [location]);

  // Folders: the device's folders, and the book files in them in the formats shown.
  const inFolders = location.shelf === 'folders';
  const [folderAccess, setFolderAccess] = useState<boolean | null>(null);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const folderExtensions = shownExtensions(prefs.filter, SCAN_EXTENSIONS).join(',');
  useEffect(() => {
    if (!inFolders) return;
    let current = true;
    void platform.hasFolderAccess().then(async (granted) => {
      if (!current) return;
      setFolderAccess(granted);
      if (granted) {
        const result = await platform.listFolder(location.group ?? '', folderExtensions.split(',').filter(Boolean));
        if (current) setListing(result);
      }
    });
    return () => {
      current = false;
    };
  }, [platform, inFolders, location.group, folderExtensions, folderAccess]);

  const listsFormats = location.shelf === 'formats' && location.group === undefined;
  const listsGroups = isGroupShelf(location.shelf) && location.group === undefined && !listsFormats;
  const shelfBooks = useMemo(() => booksAt(entries, location), [entries, location]);
  const visible = useMemo(() => sortAt(applyFilter(shelfBooks, prefs.filter, search ?? ''), location, prefs.sort), [shelfBooks, location, prefs.filter, prefs.sort, search]);
  // Authors, series and collections count only books in the formats shown.
  const groups = useMemo(
    () => (isGroupShelf(location.shelf) ? groupsOf(applyFilter(entries, { ...prefs.filter, hideFinished: false }), location.shelf, collections) : []),
    [entries, location.shelf, collections, prefs.filter],
  );
  const title = locationTitle(location);
  const inGroup = location.group !== undefined;
  const shownImports = (location.shelf === 'reading' || location.shelf === 'all') && !inGroup && search === null ? props.importing : [];

  const goTo = (next: LibraryLocation) => {
    setDrawerOpen(false);
    onLocationChange(next);
  };
  const back = () => (search !== null ? setSearch(null) : onLocationChange({ shelf: location.shelf }));

  const mainItems: MenuItem[] = [
    { label: 'Open book', onSelect: props.onAdd },
    { label: 'Sort by', submenu: true, onSelect: () => setMenu((m) => m && { kind: 'sort', anchor: m.anchor }) },
    { label: 'Filter', onSelect: () => setFilterOpen(true) },
    ...(location.shelf === 'collections' && location.group !== undefined
      ? [{ label: 'Delete collection', danger: true, onSelect: () => props.onDeleteCollection(location.group!) }]
      : []),
    { label: 'Settings', onSelect: props.onSettings },
    { label: 'About', onSelect: props.onAbout },
  ];
  const sortItems: MenuItem[] = (Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({
    label: SORT_LABELS[key],
    checked: prefs.sort === key,
    onSelect: () => onPrefsChange({ ...prefs, sort: key }),
  }));
  const bookItems = (entry: LibraryEntry): MenuItem[] => [
    { label: 'Read', onSelect: () => books.onOpen(entry.id) },
    { label: 'About book', onSelect: () => books.onDetails(entry.id) },
    // The card layout shows these as toggles on the card itself.
    ...(layout === 'shelf'
      ? [
          { label: entry.favorite ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => books.onToggle(entry.id, 'favorite') },
          { label: entry.toRead ? 'Remove from To read' : 'Add to To read', onSelect: () => books.onToggle(entry.id, 'toRead') },
          { label: entry.finished ? 'Mark as not finished' : 'Mark as finished', onSelect: () => books.onToggle(entry.id, 'finished') },
        ]
      : []),
    { label: 'Collections…', onSelect: () => books.onCollections(entry.id) },
    { label: 'Remove from library', danger: true, onSelect: () => books.onRemove(entry.id) },
  ];

  // Folders keeps the menu at every depth, as ReadEra does; its "Up one level" row goes up instead.
  const leading =
    search !== null || (inGroup && !inFolders) ? (
      <button type="button" className="icon-button" onClick={back} aria-label="Back">
        <Icon name="back" />
      </button>
    ) : (
      <button type="button" className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="Menu">
        <Icon name="menu" />
      </button>
    );
  const searchField = (
    <input
      className="shelf-search"
      autoFocus
      type="search"
      placeholder={`Search in ${title}`}
      aria-label="Search"
      value={search ?? ''}
      onChange={(e) => setSearch(e.target.value)}
    />
  );
  const toggleLayout = () => onPrefsChange({ ...prefs, layout: layout === 'shelf' ? 'cards' : 'shelf' });
  // Shows the layout it switches to.
  const layoutButton = (
    <button type="button" className="icon-button" aria-label={layout === 'shelf' ? 'Show as cards' : 'Show as shelf'} title={layout === 'shelf' ? 'Show as cards' : 'Show as shelf'} onClick={toggleLayout}>
      <Icon name={layout === 'shelf' ? 'viewList' : 'viewGrid'} />
    </button>
  );
  const moreButton = (
    <button type="button" className="icon-button" aria-label="More options" onClick={(e) => setMenu({ kind: 'main', anchor: e.currentTarget })}>
      <Icon name="moreVert" />
    </button>
  );
  const searchButton =
    search === null ? (
      <button type="button" className="icon-button" aria-label="Search" onClick={() => setSearch('')}>
        <Icon name="search" />
      </button>
    ) : null;

  return (
    <div className="library" data-layout={layout}>
      {/* Both layouts share the header with the shelf tabs. */}
      <header className="shelf-header">
        {leading}
        <div className="shelf-header-center">
          {search !== null ? (
            searchField
          ) : (
            <nav className="pill-tabs" aria-label="Shelves">
              {SHELF_TABS.map((shelf) => (
                <button
                  key={shelf}
                  type="button"
                  className="pill-tab"
                  aria-current={location.shelf === shelf && !inGroup ? 'page' : undefined}
                  onClick={() => goTo({ shelf })}
                >
                  {SHELF_TAB_LABELS[shelf] ?? SHELVES[shelf].label}
                </button>
              ))}
              {searchButton}
            </nav>
          )}
        </div>
        {layoutButton}
        {moreButton}
      </header>

      <main className="library-content">
        {(inGroup || !SHELF_TABS.includes(location.shelf)) && <h1 className="shelf-title">{title}</h1>}
        {inFolders && location.group && <p className="shelf-subtitle">{location.group}</p>}

        {isFilterActive(prefs.filter) && !listsGroups && !listsFormats && !inFolders && (
          <div className="filter-bar">
            <span>
              Filter: {[...prefs.filter.formats.map(formatLabel), ...(prefs.filter.hideFinished ? ['not finished'] : [])].join(', ')} · {visible.length} of{' '}
              {shelfBooks.length}
            </span>
            <button type="button" className="button-text" onClick={() => onPrefsChange({ ...prefs, filter: { formats: [], hideFinished: false } })}>
              Clear
            </button>
          </div>
        )}

        {listsFormats ? (
          <FormatList entries={entries} prefs={prefs} onPrefsChange={onPrefsChange} onShowFormat={(format) => onLocationChange({ shelf: 'formats', group: format })} />
        ) : inFolders ? (
          folderAccess === false ? (
            <FolderAccessPrompt onRequest={() => void platform.requestFolderAccess().then(setFolderAccess)} />
          ) : (
            <FolderContents
              listing={listing}
              entries={entries}
              search={search ?? ''}
              onOpenFolder={(path) => onLocationChange(path ? { shelf: 'folders', group: path } : { shelf: 'folders' })}
              onOpenFile={props.onOpenFile}
            />
          )
        ) : listsGroups && groups.length === 0 && location.shelf !== 'collections' ? (
          <EmptyState entries={entries} location={location} filtered={false} platform={platform} onAdd={props.onAdd} />
        ) : listsGroups ? (
          <ul className="group-list">
            {groups.map((group) => (
              <li key={group.key}>
                <button type="button" className="group-row" onClick={() => onLocationChange({ shelf: location.shelf, group: group.key })}>
                  <Icon name={SHELVES[location.shelf].icon} />
                  <span className="group-label">{group.label}</span>
                  <span className="group-count">{group.count}</span>
                </button>
              </li>
            ))}
            {location.shelf === 'collections' && (
              <li>
                <button type="button" className="group-row group-create" onClick={props.onCreateCollection}>
                  <span className="group-label">New collection</span>
                  <Icon name="addCircle" />
                </button>
              </li>
            )}
          </ul>
        ) : visible.length === 0 && shownImports.length === 0 ? (
          <EmptyState entries={entries} location={location} filtered={search !== null || isFilterActive(prefs.filter)} platform={platform} onAdd={props.onAdd} />
        ) : (
          <ul className={layout === 'shelf' ? 'shelf-grid' : 'card-list'}>
            {shownImports.map((book) => (
              <ImportingItem key={book.key} book={book} layout={layout} />
            ))}
            {visible.map((entry) =>
              layout === 'shelf' ? (
                <ShelfTile key={entry.id} platform={platform} entry={entry} books={books} onMenu={(anchor) => setMenu({ kind: 'book', anchor, entry })} />
              ) : (
                <BookCard key={entry.id} platform={platform} entry={entry} books={books} onMenu={(anchor) => setMenu({ kind: 'book', anchor, entry })} />
              ),
            )}
          </ul>
        )}
      </main>

      {drawerOpen && <Drawer location={location} onSelect={(shelf) => goTo({ shelf })} onSettings={props.onSettings} onAbout={props.onAbout} onClose={() => setDrawerOpen(false)} />}
      {menu && (
        <PopupMenu
          anchor={menu.anchor}
          title={menu.kind === 'book' ? menu.entry.title : menu.kind === 'sort' ? 'Sort by' : undefined}
          items={menu.kind === 'book' ? bookItems(menu.entry) : menu.kind === 'sort' ? sortItems : mainItems}
          onClose={() => setMenu(null)}
        />
      )}
      {filterOpen && (
        <FilterDialog
          filter={prefs.filter}
          countFor={(filter) => applyFilter(shelfBooks, filter, search ?? '').length}
          onApply={(filter) => onPrefsChange({ ...prefs, filter })}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}

function Drawer({ location, onSelect, onSettings, onAbout, onClose }: { location: LibraryLocation; onSelect: (shelf: Shelf) => void; onSettings: () => void; onAbout: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const item = (key: string, label: string, icon: IconName, onClick: () => void, current = false) => (
    <li key={key}>
      <button type="button" className="drawer-item" aria-current={current ? 'page' : undefined} onClick={onClick}>
        <Icon name={icon} />
        <span>{label}</span>
      </button>
    </li>
  );
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <nav className="drawer" aria-label="Library" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span className="drawer-logo">
            <Icon name="book" />
          </span>
          eReaderPlus
        </div>
        <ul className="drawer-list">{DRAWER_SHELVES.map((shelf) => item(shelf, SHELVES[shelf].label, SHELVES[shelf].icon, () => onSelect(shelf), location.shelf === shelf))}</ul>
        <ul className="drawer-list drawer-list-footer">
          {item('settings', 'Settings', 'settings', () => {
            onClose();
            onSettings();
          })}
          {item('about', 'About', 'info', () => {
            onClose();
            onAbout();
          })}
        </ul>
      </nav>
    </div>
  );
}

interface FormatListProps {
  entries: LibraryEntry[];
  prefs: LibraryPrefs;
  onPrefsChange: (prefs: LibraryPrefs) => void;
  onShowFormat: (format: BookFormat) => void;
}

/** Every supported format, ticked when its books are shown: the selection applies to the whole app. */
function FormatList({ entries, prefs, onPrefsChange, onShowFormat }: FormatListProps) {
  const counts = new Map<BookFormat, number>();
  for (const entry of entries) counts.set(entry.format, (counts.get(entry.format) ?? 0) + 1);
  const shownCount = ALL_FORMATS.filter((f) => isFormatShown(prefs.filter, f)).length;
  const all = prefs.filter.formats.length === 0;
  return (
    <>
      <p className="list-hint">Books in the ticked formats are shown everywhere: on every shelf and in Folders.</p>
      <ul className="group-list">
        <li className="format-item">
          <button type="button" role="checkbox" aria-checked={all} className="group-row" onClick={() => onPrefsChange({ ...prefs, filter: { ...prefs.filter, formats: [] } })}>
            <Checkbox on={all} />
            <span className="group-label">All formats</span>
            <span className="group-count">{entries.length}</span>
          </button>
        </li>
        {ALL_FORMATS.map((format) => {
          const shown = isFormatShown(prefs.filter, format);
          const count = counts.get(format) ?? 0;
          const last = shown && shownCount === 1;
          return (
            <li key={format} className="format-item">
              <button
                type="button"
                role="checkbox"
                aria-checked={shown}
                aria-label={`${formatLabel(format)}, ${count === 1 ? '1 book' : `${count} books`}`}
                className="group-row"
                disabled={last}
                title={last ? 'At least one format stays shown' : undefined}
                onClick={() => onPrefsChange({ ...prefs, filter: toggleFormat(prefs.filter, format) })}
              >
                <Checkbox on={shown} />
                <span className="group-label">{formatLabel(format)}</span>
                <span className="group-count">{count}</span>
              </button>
              <button
                type="button"
                className="icon-button format-show"
                aria-label={`Show ${formatLabel(format)} books`}
                disabled={!shown || count === 0}
                onClick={() => onShowFormat(format)}
              >
                <Icon name="chevronRight" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Checkbox({ on }: { on: boolean }) {
  return (
    <span className={on ? 'checkbox checkbox-on' : 'checkbox'} aria-hidden="true">
      {on && <Icon name="check" />}
    </span>
  );
}

interface FolderContentsProps {
  listing: FolderListing | null;
  entries: LibraryEntry[];
  search: string;
  onOpenFolder: (path: string) => void;
  onOpenFile: (file: FileRef) => void;
}

/** A folder's subfolders, then its book files; a file already in the library says so, with its progress. */
function FolderContents({ listing, entries, search, onOpenFolder, onOpenFile }: FolderContentsProps) {
  if (!listing) return null;
  const query = search.trim().toLocaleLowerCase();
  const matches = (name: string) => !query || name.toLocaleLowerCase().includes(query);
  const folders = listing.folders.filter((f) => matches(f.name));
  const books = listing.books.filter((b) => matches(b.file.name));
  const bySource = new Map(entries.filter((e) => e.source).map((e) => [e.source!, e]));
  return (
    <>
      {listing.error && <p className="picker-error">{listing.error}</p>}
      {!listing.error && folders.length === 0 && books.length === 0 && (
        <div className="library-empty">
          <p>{query ? 'Nothing matches.' : 'No folders here, and no books in the formats shown.'}</p>
        </div>
      )}
      <ul className="folder-rows">
        {listing.parent !== null && (
          <li>
            <button type="button" className="folder-row folder-up" title={listing.parent || 'Storage'} onClick={() => onOpenFolder(listing.parent!)}>
              <Icon name="back" />
              <span className="folder-name">Up one level</span>
            </button>
          </li>
        )}
        {folders.map((folder) => (
          <li key={folder.path}>
            <button type="button" className="folder-row" title={folder.path} onClick={() => onOpenFolder(folder.path)}>
              <Icon name="folder" />
              <span className="folder-name">{folder.name}</span>
              <Icon name="chevronRight" className="folder-arrow" />
            </button>
          </li>
        ))}
        {books.map((book) => {
          const entry = bySource.get(book.file.ref);
          const extension = book.file.name.includes('.') ? book.file.name.split('.').pop()! : '';
          const status = entry ? ` · in library${entry.finished ? ' · finished' : entry.progress > 0 ? ` · ${percentRead(entry)}%` : ''}` : '';
          return (
            <li key={book.path}>
              <button type="button" className="folder-row file-row" title={book.path} onClick={() => onOpenFile(book.file)}>
                <span className="file-format">{extension.toUpperCase()}</span>
                <span className="file-text">
                  <span className="folder-name">{book.file.name}</span>
                  <span className="file-meta">
                    {formatSize(book.size)}
                    {status}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EMPTY_MESSAGES: Partial<Record<Shelf, string>> = {
  reading: 'Nothing in progress. Books you open appear here; all your books are under Books.',
  favorites: 'Tap the star on a book to add it to Favorites.',
  toRead: 'Tap the clock on a book to save it for later.',
  finished: 'Books you mark as finished appear here.',
  series: 'No books in a series yet. Series come from the books themselves: EPUB, FB2 and comic files can name theirs.',
  collections: 'This collection is empty. Add books with the collections button on a book.',
};

function EmptyState({ entries, location, filtered, platform, onAdd }: { entries: LibraryEntry[]; location: LibraryLocation; filtered: boolean; platform: Platform; onAdd: () => void }) {
  if (entries.length === 0) {
    return (
      <div className="library-empty">
        <Icon name="book" className="library-empty-icon" />
        <p>No books yet.</p>
        <p className="library-hint">
          Open an EPUB, PDF, MOBI, AZW3, FB2, CBZ, DjVu, CHM or LIT file{platform.kind === 'electron' ? ', or drop one onto this window' : ''}.
        </p>
        <button type="button" className="button" onClick={onAdd}>
          Open book
        </button>
      </div>
    );
  }
  return (
    <div className="library-empty">
      <p>{filtered ? 'No books match.' : (EMPTY_MESSAGES[location.shelf] ?? 'No books here.')}</p>
    </div>
  );
}
