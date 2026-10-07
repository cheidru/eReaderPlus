import type { LibraryEntry } from '../../core/types';
import { bookUrl, type Platform } from '../../platform';
import './LibraryView.css';

interface Props {
  platform: Platform;
  entries: LibraryEntry[];
  onOpen: (bookId: string) => void;
  onAdd: () => void;
  onRemove: (bookId: string) => void;
  onAbout: () => void;
}

export function LibraryView({ platform, entries, onOpen, onAdd, onRemove, onAbout }: Props) {
  const sorted = [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return (
    <div className="library">
      <header className="library-header">
        <h1>Library</h1>
        <div className="library-actions">
          <button type="button" className="button button-ghost" onClick={onAbout}>
            About
          </button>
          <button type="button" className="button" onClick={onAdd}>
            Open book
          </button>
        </div>
      </header>

      {sorted.length === 0 ? (
        <div className="library-empty">
          <p>No books yet.</p>
          <p className="library-hint">
            Open an EPUB, PDF, MOBI, AZW3, FB2, CBZ, DjVu, CHM or LIT file{platform.kind === 'electron' ? ', or drop one onto this window' : ''}.
          </p>
        </div>
      ) : (
        <ul className="library-grid">
          {sorted.map((entry) => (
            <li key={entry.id} className="book-card">
              <button type="button" className="book-open" onClick={() => onOpen(entry.id)} title={entry.title}>
                <div className="book-cover">
                  {entry.cover ? (
                    <img src={bookUrl(platform, entry.id, entry.cover)} alt="" loading="lazy" />
                  ) : (
                    <span className="book-cover-placeholder">{entry.title}</span>
                  )}
                  <span className="book-format">{entry.format.toUpperCase()}</span>
                </div>
                <span className="book-title">{entry.title}</span>
                <span className="book-author">{entry.authors.join(', ')}</span>
              </button>
              <div className="book-footer">
                <div className="book-progress" aria-label={`${Math.round(entry.progress * 100)}% read`}>
                  <div className="book-progress-fill" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
                </div>
                <button type="button" className="icon-button" aria-label={`Remove ${entry.title}`} onClick={() => onRemove(entry.id)}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
