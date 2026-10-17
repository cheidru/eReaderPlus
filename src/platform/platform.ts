import { encodePath } from '../core/paths';

/** An opaque handle to a user-selected book file (a filesystem path on desktop, a content:// URI on Android). */
export interface FileRef {
  ref: string;
  name: string;
}

export interface EngineInfo {
  /** Human-readable rendering engine name, e.g. "Chromium" or "Android System WebView". */
  engine: string;
  /** Full engine version, e.g. "140.0.7339.80". */
  version: string;
  /** App shell, e.g. "Electron 44.5.1" or "Capacitor (Android 14)". */
  shell: string;
  /** False when the engine is older than MIN_ENGINE_MAJOR and the user should update it. */
  upToDate: boolean;
  /** Where the user can update the engine when it is outdated (Android: Play Store page of the WebView). */
  updateUrl: string | null;
}

/** A folder in the in-app folder browser. Storage roots have a display name; other folders show `name`. */
export interface FolderEntry {
  name: string;
  path: string;
}

export interface FolderListing {
  /** '' for the list of storage roots. */
  path: string;
  /** Where "up" goes: '' for the roots list, null when already at the roots. */
  parent: string | null;
  folders: FolderEntry[];
  /** Book files directly inside this folder, sorted by name. */
  books: FoundBookFile[];
  /** Set when the folder could not be read (missing, or no permission). */
  error: string | null;
}

/** A book file found in a watched folder. `modified` is in ms since the epoch. */
export interface FoundBookFile {
  file: FileRef;
  path: string;
  size: number;
  modified: number;
}

/** Oldest Chromium major the reader is tested against. */
export const MIN_ENGINE_MAJOR = 120;

/**
 * Everything platform-specific. The shared UI and core code talk to native code only through this.
 * Paths are book-root-relative POSIX paths.
 */
export interface Platform {
  readonly kind: 'electron' | 'android';
  pickBookFile(): Promise<FileRef | null>;
  /** Converts a File dropped onto the window into a FileRef, when the platform supports it. */
  fileFromDrop(file: File): FileRef | null;
  /** Subscribes to files opened from the OS ("Open with", double-click). Delivers pending files immediately. */
  onOpenFile(listener: (file: FileRef) => void): () => void;
  /** Unzips an archive into the book's folder natively. Returns the extracted file paths. */
  extractArchive(file: FileRef, bookId: string): Promise<string[]>;
  copyRawFile(file: FileRef, bookId: string, path: string): Promise<void>;
  readText(bookId: string, path: string): Promise<string>;
  readBinary(bookId: string, path: string): Promise<Uint8Array>;
  writeText(bookId: string, path: string, text: string): Promise<void>;
  writeBinary(bookId: string, path: string, data: Uint8Array): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
  /** Origin that serves the book's folder, unique per book (e.g. book://<id> or https://<id>.ereaderplus.invalid). */
  bookOrigin(bookId: string): string;
  kvGet<T>(key: string): Promise<T | null>;
  kvSet(key: string, value: unknown): Promise<void>;
  engineInfo(): Promise<EngineInfo>;
  openExternal(url: string): Promise<void>;
  /** Sets prefers-color-scheme seen by books, where the platform allows it. */
  setColorScheme(scheme: 'light' | 'dark'): Promise<void>;
  /** Whether the app may browse the device's folders (Android asks the user once; desktop always may). */
  hasFolderAccess(): Promise<boolean>;
  /** Asks the user for folder access where needed. Resolves to whether it was granted. */
  requestFolderAccess(): Promise<boolean>;
  /** Subfolders and count of book files (by extension) of a folder, or the storage roots for ''. */
  listFolder(path: string, extensions: string[]): Promise<FolderListing>;
  /** Book files (by extension) in a folder and its subfolders, skipping hidden folders and links. */
  findBookFiles(folder: string, extensions: string[]): Promise<FoundBookFile[]>;
  /**
   * Desktop: subscribes to a newer version having been downloaded (it installs when the app quits); delivers one
   * already downloaded at once. Android installs updates from the APK instead (core/app-updates.ts).
   */
  onUpdateReady?(listener: (version: string) => void): () => void;
  /** Desktop: restarts into the downloaded version. */
  installUpdate?(): Promise<void>;
}

export function bookUrl(platform: Platform, bookId: string, path: string): string {
  return `${platform.bookOrigin(bookId)}/${encodePath(path)}`;
}

export function chromiumMajor(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10) || 0;
}
