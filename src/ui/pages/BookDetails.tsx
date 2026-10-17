import { useEffect, useState, type ReactNode } from 'react';
import { loadManifest } from '../../core/import';
import { formatLabel } from '../../core/shelves';
import type { BookManifest, LibraryEntry } from '../../core/types';
import type { Platform } from '../../platform';
import { Icon } from '../icons';
import { BookToggles, Cover } from '../library/BookItems';
import { percentRead, seriesLabel, type BookHandlers } from '../library/shelfInfo';
import './Pages.css';

interface Props {
  platform: Platform;
  entry: LibraryEntry;
  books: BookHandlers;
  /** The bar's drop-down of the formats shown. */
  formatsButton: ReactNode;
  onBack: () => void;
  onAuthor: (author: string) => void;
  onSeries: (name: string) => void;
  onCollection: (name: string) => void;
}

/** The UI is in English, so its dates and language names are too, whatever the system locale. */
const UI_LOCALE = 'en';
const dateTime = new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: 'long', timeStyle: 'short' });

export function BookDetails({ platform, entry, books, formatsButton, onBack, onAuthor, onSeries, onCollection }: Props) {
  const [manifest, setManifest] = useState<BookManifest | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadManifest(platform, entry.id)
      .then((m) => !cancelled && setManifest(m))
      .catch(() => {}); // The library entry has everything essential; the manifest only adds details.
    return () => {
      cancelled = true;
    };
  }, [platform, entry.id]);

  const language = manifest?.language && manifest.language !== 'und' ? languageName(manifest.language) : null;

  return (
    <div className="page">
      <header className="app-bar">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 className="app-bar-title">About book</h1>
        {formatsButton}
        <button type="button" className="button-text" onClick={() => books.onOpen(entry.id)}>
          Read
        </button>
      </header>

      <main className="page-content details">
        <div className="details-cover">
          <Cover platform={platform} entry={entry} />
        </div>
        <div className="details-main">
          <h2 className="details-title">{entry.title}</h2>
          <div className="details-actions">
            <BookToggles entry={entry} books={books} />
            <button type="button" className="icon-button" aria-label="Remove from library" title="Remove from library" onClick={() => books.onRemove(entry.id)}>
              <Icon name="delete" />
            </button>
          </div>

          <dl className="details-list">
            {entry.authors.length > 0 && (
              <Item label={entry.authors.length > 1 ? 'Authors' : 'Author'}>
                {entry.authors.map((author, i) => (
                  <span key={author}>
                    {i > 0 && ', '}
                    <button type="button" className="details-link" onClick={() => onAuthor(author)}>
                      {author}
                    </button>
                  </span>
                ))}
              </Item>
            )}
            {entry.series && (
              <Item label="Series">
                <button type="button" className="details-link" onClick={() => onSeries(entry.series!.name)}>
                  {seriesLabel(entry.series)}
                </button>
              </Item>
            )}
            {(entry.collections?.length ?? 0) > 0 && (
              <Item label={entry.collections!.length > 1 ? 'Collections' : 'Collection'}>
                {entry.collections!.map((name, i) => (
                  <span key={name}>
                    {i > 0 && ', '}
                    <button type="button" className="details-link" onClick={() => onCollection(name)}>
                      {name}
                    </button>
                  </span>
                ))}
              </Item>
            )}
            <Item label="Progress and last read">
              {entry.lastOpenedAt === 0
                ? 'Not opened yet'
                : `${entry.finished ? 'Finished' : `${percentRead(entry)}%`}, ${dateTime.format(entry.lastOpenedAt)}`}
            </Item>
            <Item label="Format and file">
              {formatLabel(entry.format)}
              {entry.fileName ? ` · ${entry.fileName}` : ''}
            </Item>
            {language && <Item label="Language">{language}</Item>}
            {manifest && (
              <Item label="Contents">
                {manifest.toc.length > 0 ? `${countToc(manifest.toc)} table of contents entries` : 'No table of contents'} · {manifest.spine.length}{' '}
                {manifest.spine.length === 1 ? 'document' : 'documents'}
              </Item>
            )}
            <Item label="Added to library">{dateTime.format(entry.addedAt)}</Item>
          </dl>
        </div>
      </main>
    </div>
  );
}

/** ReadEra style: the value large, its label small underneath. */
function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="details-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function countToc(items: BookManifest['toc']): number {
  return items.reduce((n, item) => n + 1 + countToc(item.children), 0);
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(UI_LOCALE, { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
