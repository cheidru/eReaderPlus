/** The API the Electron preload script exposes as `window.ereaderNative`. */
export interface ElectronNativeApi {
  pickBookFile(): Promise<{ ref: string; name: string } | null>;
  getPathForFile(file: File): string;
  onOpenFile(listener: (path: string) => void): () => void;
  takePendingOpenFiles(): Promise<string[]>;
  extractArchive(path: string, bookId: string): Promise<string[]>;
  copyRawFile(path: string, bookId: string, dest: string): Promise<void>;
  readText(bookId: string, path: string): Promise<string>;
  readBinary(bookId: string, path: string): Promise<Uint8Array>;
  writeText(bookId: string, path: string, text: string): Promise<void>;
  writeBinary(bookId: string, path: string, data: Uint8Array): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
  kvGet(key: string): Promise<unknown>;
  kvSet(key: string, value: unknown): Promise<void>;
  versions(): { chrome: string; electron: string; platform: string };
  openExternal(url: string): Promise<void>;
  setColorScheme(scheme: 'light' | 'dark'): Promise<void>;
}

export const IPC = {
  pickBookFile: 'ereader:pick-book-file',
  openFile: 'ereader:open-file',
  takePendingOpenFiles: 'ereader:take-pending-open-files',
  extractArchive: 'ereader:extract-archive',
  copyRawFile: 'ereader:copy-raw-file',
  readText: 'ereader:read-text',
  readBinary: 'ereader:read-binary',
  writeText: 'ereader:write-text',
  writeBinary: 'ereader:write-binary',
  deleteBook: 'ereader:delete-book',
  kvGet: 'ereader:kv-get',
  kvSet: 'ereader:kv-set',
  openExternal: 'ereader:open-external',
  setColorScheme: 'ereader:set-color-scheme',
} as const;

export const BOOK_SCHEME = 'book';
export const APP_SCHEME = 'app';
