import { ALL_COLOR_THEMES, type AppTheme, type LibraryLayout, type LibraryPrefs } from '../../core/types';
import type { EngineInfo } from '../../platform';
import { Icon } from '../icons';
import { COLOR_THEMES, swatchBackground } from '../themes';
import './Pages.css';

/** The watched folders and what the last scan did, for the Folders section. */
export interface FolderSettings {
  folders: string[];
  scanning: boolean;
  /** One line about the last scan, or null before the first. */
  lastScan: string | null;
  onAdd: () => void;
  onRemove: (folder: string) => void;
  onScan: () => void;
}

interface Props {
  prefs: LibraryPrefs;
  folders: FolderSettings;
  engine: EngineInfo | null;
  onChange: (prefs: LibraryPrefs) => void;
  onBack: () => void;
  onAbout: () => void;
}

const LAYOUTS: { value: LibraryLayout; label: string; description: string }[] = [
  { value: 'cards', label: 'Cards', description: 'Each book on a card with its cover, details and shelf buttons, like ReadEra.' },
  { value: 'shelf', label: 'Shelf', description: 'A plain grid of covers with the reading progress, like the iPad Books library.' },
];

const APP_THEMES: { value: AppTheme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsPage({ prefs, folders, engine, onChange, onBack, onAbout }: Props) {
  return (
    <div className="page">
      <header className="app-bar">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 className="app-bar-title">Settings</h1>
      </header>

      <main className="page-content settings">
        <section>
          <h2 className="settings-section">Library</h2>
          <div role="radiogroup" aria-label="Library layout">
            {LAYOUTS.map((layout) => (
              <label key={layout.value} className="settings-row">
                <span className="settings-text">
                  <span className="settings-label">{layout.label}</span>
                  <span className="settings-description">{layout.description}</span>
                </span>
                <input type="radio" className="settings-radio" name="layout" checked={prefs.layout === layout.value} onChange={() => onChange({ ...prefs, layout: layout.value })} />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="settings-section">Folders</h2>
          {folders.folders.map((folder) => (
            <div key={folder} className="watched-folder">
              <Icon name="folder" />
              <span className="settings-text">
                <span className="settings-label">{folder.split(/[\\/]/).filter(Boolean).pop() ?? folder}</span>
                <span className="settings-description">{folder}</span>
              </span>
              <button type="button" className="icon-button" onClick={() => folders.onRemove(folder)} aria-label={`Stop checking ${folder}`} title="Stop checking this folder">
                <Icon name="close" />
              </button>
            </div>
          ))}
          <button type="button" className="settings-row settings-button" onClick={folders.onAdd}>
            <span className="settings-text">
              <span className="settings-label">Add folder</span>
              <span className="settings-description">Books in the folder and its subfolders are added to the library, now and whenever the app starts.</span>
            </span>
          </button>
          {folders.folders.length > 0 && (
            <button type="button" className="settings-row settings-button" onClick={folders.onScan} disabled={folders.scanning}>
              <span className="settings-text">
                <span className="settings-label">{folders.scanning ? 'Scanning…' : 'Scan now'}</span>
                {folders.lastScan && <span className="settings-description">{folders.lastScan}</span>}
              </span>
            </button>
          )}
        </section>

        <section>
          <h2 className="settings-section">Appearance</h2>
          <div className="settings-row settings-choice">
            <span className="settings-text">
              <span className="settings-label">Theme</span>
              <span className="settings-description">Light or dark library and menus. The book's own colors are set in the reader.</span>
            </span>
            <div className="settings-seg" role="group" aria-label="Theme">
              {APP_THEMES.map((mode) => (
                <button key={mode.value} type="button" className="settings-seg-button" aria-pressed={prefs.appTheme === mode.value} onClick={() => onChange({ ...prefs, appTheme: mode.value })}>
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row settings-choice">
            <span className="settings-text">
              <span className="settings-label">Color theme</span>
              <span className="settings-description">Colors of the bars, highlights and accents, in either theme.</span>
            </span>
            <div className="settings-swatches" role="radiogroup" aria-label="Color theme">
              {ALL_COLOR_THEMES.map((color) => (
                <label key={color} className="settings-swatch">
                  <input type="radio" name="color-theme" checked={prefs.colorTheme === color} onChange={() => onChange({ ...prefs, colorTheme: color })} />
                  <span className="settings-swatch-dot" style={{ background: swatchBackground(color) }} />
                  {COLOR_THEMES[color].label}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h2 className="settings-section">Other</h2>
          <button type="button" className="settings-row settings-button" onClick={onAbout}>
            <span className="settings-text">
              <span className="settings-label">About eReaderPlus</span>
              {engine && (
                <span className="settings-description">
                  {engine.engine} {engine.version} · {engine.shell}
                </span>
              )}
            </span>
          </button>
        </section>
      </main>
    </div>
  );
}
