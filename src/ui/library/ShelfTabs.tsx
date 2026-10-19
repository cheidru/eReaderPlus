import type { ReactNode } from 'react';
import type { Shelf } from '../../core/shelves';
import { SHELVES } from './shelfInfo';
import './ShelfTabs.css';

/** The three shelves on the iPad-style tab bar; the drawer reaches the rest. */
export const SHELF_TABS: Shelf[] = ['reading', 'all', 'collections'];
const SHELF_TAB_LABELS: Partial<Record<Shelf, string>> = { all: 'Library' };

interface Props {
  /** The tab shown as current, if any. */
  current?: Shelf;
  onSelect: (shelf: Shelf) => void;
  /** Shown after the tabs, inside the pill (the library's search button). */
  children?: ReactNode;
}

export function ShelfTabs({ current, onSelect, children }: Props) {
  return (
    <nav className="pill-tabs" aria-label="Shelves">
      {SHELF_TABS.map((shelf) => (
        <button key={shelf} type="button" className="pill-tab" aria-current={current === shelf ? 'page' : undefined} onClick={() => onSelect(shelf)}>
          {SHELF_TAB_LABELS[shelf] ?? SHELVES[shelf].label}
        </button>
      ))}
      {children}
    </nav>
  );
}
