import { useEffect, useRef } from 'react';
import { MAX_HITS, type SearchHit } from '../../core/booksearch';
import { Icon } from '../icons';
import './Panels.css';

/** Search results and where the search is: reading the book first (progress 0..1), done, or failed. */
export interface SearchState {
  query: string;
  hits: SearchHit[];
  /** The query the hits were found for (the field may already hold the next one). */
  hitsQuery: string;
  /** Set while the book's text is being read for the first search. */
  progress: number | null;
  error: string | null;
  /** The hit the reader went to, shown in the search bar. */
  current: number | null;
}

export const NO_SEARCH: SearchState = { query: '', hits: [], hitsQuery: '', progress: null, error: null, current: null };

/** Shortest query searched: one letter would match nearly everywhere. */
export const MIN_QUERY_LENGTH = 2;

interface Props {
  search: SearchState;
  /** Chapter (or page) name for each spine document, shown above its results. */
  sectionLabel: (spineIndex: number) => string;
  onQueryChange: (query: string) => void;
  onSelect: (hitIndex: number) => void;
  onClose: () => void;
}

export function SearchPanel({ search, sectionLabel, onQueryChange, onSelect, onClose }: Props) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => currentRef.current?.scrollIntoView({ block: 'center' }), []);

  const tooShort = search.query.trim().length < MIN_QUERY_LENGTH;
  let status: string;
  if (search.error) status = search.error;
  else if (search.progress !== null) status = `Reading the book… ${Math.round(search.progress * 100)}%`;
  else if (tooShort) status = '';
  else if (search.hits.length === 0) status = 'No results';
  else if (search.hits.length >= MAX_HITS) status = `First ${MAX_HITS} results`;
  else status = search.hits.length === 1 ? '1 result' : `${search.hits.length} results`;

  return (
    <aside className="panel panel-left" aria-label="Search in book">
      <div className="panel-header search-header">
        <Icon name="search" className="search-header-icon" />
        <input
          className="search-field"
          type="search"
          autoFocus
          placeholder="Search in book"
          aria-label="Search in book"
          value={search.query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'Enter' && search.hits.length > 0) onSelect(search.current ?? 0);
          }}
        />
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close search">
          <Icon name="close" />
        </button>
      </div>
      <div className="panel-body">
        {status && (
          <p className="search-status" role="status">
            {status}
          </p>
        )}
        <ol className="search-results">
          {search.hits.map((hit, i) => (
            <li key={`${hit.spineIndex}:${hit.occurrence}`}>
              {(i === 0 || search.hits[i - 1].spineIndex !== hit.spineIndex) && <div className="search-section">{sectionLabel(hit.spineIndex)}</div>}
              <button
                type="button"
                ref={i === search.current ? currentRef : undefined}
                className={i === search.current ? 'search-hit search-hit-current' : 'search-hit'}
                onClick={() => onSelect(i)}
              >
                {hit.before}
                <mark>{hit.match}</mark>
                {hit.after}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
