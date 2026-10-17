import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SCAN_EXTENSIONS } from '../../core/folders';
import type { FolderListing, Platform } from '../../platform';
import { Icon } from '../icons';
import './Pages.css';

interface Props {
  platform: Platform;
  /** The bar's drop-down of the formats shown. */
  formatsButton: ReactNode;
  onPick: (folder: string) => void;
  onCancel: () => void;
}

/** The app's own folder browser, like ReadEra's Folders view: storage roots, then folders, down to the one to watch. */
export function FolderPicker({ platform, formatsButton, onPick, onCancel }: Props) {
  const [access, setAccess] = useState<boolean | null>(null);
  const [listing, setListing] = useState<FolderListing | null>(null);

  const open = useCallback(
    (path: string) => {
      void platform.listFolder(path, SCAN_EXTENSIONS).then(setListing);
    },
    [platform],
  );

  useEffect(() => {
    void platform.hasFolderAccess().then((granted) => {
      setAccess(granted);
      if (granted) open('');
    });
  }, [platform, open]);

  const requestAccess = async () => {
    const granted = await platform.requestFolderAccess();
    setAccess(granted);
    if (granted) open('');
  };

  const up = () => (listing && listing.parent !== null ? open(listing.parent) : onCancel());

  return (
    <div className="page">
      <header className="app-bar">
        <button type="button" className="icon-button" onClick={up} aria-label="Up">
          <Icon name="back" />
        </button>
        <div className="app-bar-heading">
          <h1 className="app-bar-title">Choose a folder</h1>
          <span className="app-bar-subtitle">{listing?.path || 'Storage'}</span>
        </div>
        {formatsButton}
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Cancel">
          <Icon name="close" />
        </button>
      </header>

      {access === false ? (
        <main className="page-content">
          <FolderAccessPrompt onRequest={() => void requestAccess()} />
        </main>
      ) : (
        <main className="page-content picker-list">
          {listing?.error && <p className="picker-error">{listing.error}</p>}
          {listing && !listing.error && listing.folders.length === 0 && <p className="picker-empty">No folders in here.</p>}
          <ul className="folder-rows">
            {listing?.folders.map((folder) => (
              <li key={folder.path}>
                <button type="button" className="folder-row" title={folder.path} onClick={() => open(folder.path)}>
                  <Icon name="folder" />
                  <span className="folder-name">{folder.name}</span>
                  <Icon name="chevronRight" className="folder-arrow" />
                </button>
              </li>
            ))}
          </ul>
        </main>
      )}

      {access && listing && (
        <footer className="picker-footer">
          <span className="picker-count">
            {listing.path === '' ? 'Open a storage location' : listing.books.length === 1 ? '1 book file here' : `${listing.books.length} book files here`}
          </span>
          <button type="button" className="button" disabled={listing.path === '' || !!listing.error} onClick={() => onPick(listing.path)}>
            Use this folder
          </button>
        </footer>
      )}
    </div>
  );
}

/** Shown on Android until the app may read the device's folders. */
export function FolderAccessPrompt({ onRequest }: { onRequest: () => void }) {
  return (
    <div className="picker-access">
      <Icon name="folder" className="picker-access-icon" />
      <p>To show the folders on this device, eReaderPlus needs permission to read its files.</p>
      <p className="settings-description">Android lists this as “All files access”. Turn it on for eReaderPlus, then come back.</p>
      <button type="button" className="button" onClick={onRequest}>
        Allow access
      </button>
    </div>
  );
}
