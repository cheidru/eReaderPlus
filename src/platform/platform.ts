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
}

export function bookUrl(platform: Platform, bookId: string, path: string): string {
  return `${platform.bookOrigin(bookId)}/${encodePath(path)}`;
}

export function chromiumMajor(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10) || 0;
}
