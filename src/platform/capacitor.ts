import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { encodePath } from '../core/paths';
import { chromiumMajor, MIN_ENGINE_MAJOR, type FileRef, type FolderListing, type FoundBookFile, type Platform } from './platform';

/** Native side: android/app/src/main/java/com/ereaderplus/app/BookStorePlugin.java */
interface BookStorePlugin {
  pickBookFile(): Promise<{ file: FileRef | null }>;
  takePendingOpenFiles(): Promise<{ files: FileRef[] }>;
  addListener(event: 'openFile', listener: (file: FileRef) => void): Promise<PluginListenerHandle>;
  extractArchive(options: { uri: string; bookId: string }): Promise<{ paths: string[] }>;
  copyRawFile(options: { uri: string; bookId: string; path: string }): Promise<void>;
  writeText(options: { bookId: string; path: string; text: string }): Promise<void>;
  writeBinary(options: { bookId: string; path: string; base64: string }): Promise<void>;
  deleteBook(options: { bookId: string }): Promise<void>;
  openExternal(options: { url: string }): Promise<void>;
  webViewInfo(): Promise<{ packageName: string; versionName: string; androidVersion: string }>;
  hasFolderAccess(): Promise<{ granted: boolean }>;
  requestFolderAccess(): Promise<{ granted: boolean }>;
  listFolder(options: { path: string; extensions: string[] }): Promise<FolderListing>;
  findBookFiles(options: { folder: string; extensions: string[] }): Promise<{ files: FoundBookFile[] }>;
}

export const BOOK_HOST_SUFFIX = 'ereaderplus.invalid';

const BookStore = registerPlugin<BookStorePlugin>('BookStore');

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Reads a book file through BookWebViewClient, which streams it from disk. A large book (hundreds of MB) does not fit
 * in the Java heap as the base64 string the plugin bridge would need.
 */
async function fetchBookFile(bookId: string, path: string): Promise<Response> {
  const response = await fetch(`/__book__/${bookId}/${encodePath(path)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cannot read ${path}`);
  return response;
}

export function createCapacitorPlatform(): Platform {
  return {
    kind: 'android',
    async pickBookFile() {
      return (await BookStore.pickBookFile()).file;
    },
    fileFromDrop: () => null,
    onOpenFile(listener) {
      const handle = BookStore.addListener('openFile', listener);
      void BookStore.takePendingOpenFiles().then(({ files }) => files.forEach(listener));
      return () => void handle.then((h) => h.remove());
    },
    async extractArchive(file, bookId) {
      return (await BookStore.extractArchive({ uri: file.ref, bookId })).paths;
    },
    copyRawFile: (file, bookId, path) => BookStore.copyRawFile({ uri: file.ref, bookId, path }),
    async readText(bookId, path) {
      return (await fetchBookFile(bookId, path)).text();
    },
    async readBinary(bookId, path) {
      return new Uint8Array(await (await fetchBookFile(bookId, path)).arrayBuffer());
    },
    writeText: (bookId, path, text) => BookStore.writeText({ bookId, path, text }),
    writeBinary: (bookId, path, data) => BookStore.writeBinary({ bookId, path, base64: toBase64(data) }),
    deleteBook: (bookId) => BookStore.deleteBook({ bookId }),
    bookOrigin: (bookId) => `https://${bookId}.${BOOK_HOST_SUFFIX}`,
    async kvGet<T>(key: string) {
      const { value } = await Preferences.get({ key });
      return value === null ? null : (JSON.parse(value) as T);
    },
    kvSet: (key, value) => Preferences.set({ key, value: JSON.stringify(value) }),
    async engineInfo() {
      const info = await BookStore.webViewInfo();
      const version = info.versionName || /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] || 'unknown';
      return {
        engine: 'Android System WebView',
        version,
        shell: `Capacitor (Android ${info.androidVersion})`,
        upToDate: chromiumMajor(version) >= MIN_ENGINE_MAJOR,
        updateUrl: `https://play.google.com/store/apps/details?id=${info.packageName || 'com.google.android.webview'}`,
      };
    },
    openExternal: (url) => BookStore.openExternal({ url }),
    // Android WebView follows the system dark mode setting.
    setColorScheme: async () => {},
    hasFolderAccess: async () => (await BookStore.hasFolderAccess()).granted,
    requestFolderAccess: async () => (await BookStore.requestFolderAccess()).granted,
    listFolder: (path, extensions) => BookStore.listFolder({ path, extensions }),
    findBookFiles: async (folder, extensions) => (await BookStore.findBookFiles({ folder, extensions })).files,
  };
}
