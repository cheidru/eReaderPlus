import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { chromiumMajor, MIN_ENGINE_MAJOR, type FileRef, type Platform } from './platform';

/** Native side: android/app/src/main/java/com/ereaderplus/app/BookStorePlugin.java */
interface BookStorePlugin {
  pickBookFile(): Promise<{ file: FileRef | null }>;
  takePendingOpenFiles(): Promise<{ files: FileRef[] }>;
  addListener(event: 'openFile', listener: (file: FileRef) => void): Promise<PluginListenerHandle>;
  extractArchive(options: { uri: string; bookId: string }): Promise<{ paths: string[] }>;
  copyRawFile(options: { uri: string; bookId: string; path: string }): Promise<void>;
  readText(options: { bookId: string; path: string }): Promise<{ text: string }>;
  readBinary(options: { bookId: string; path: string }): Promise<{ base64: string }>;
  writeText(options: { bookId: string; path: string; text: string }): Promise<void>;
  writeBinary(options: { bookId: string; path: string; base64: string }): Promise<void>;
  deleteBook(options: { bookId: string }): Promise<void>;
  openExternal(options: { url: string }): Promise<void>;
  webViewInfo(): Promise<{ packageName: string; versionName: string; androidVersion: string }>;
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

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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
      return (await BookStore.readText({ bookId, path })).text;
    },
    async readBinary(bookId, path) {
      return fromBase64((await BookStore.readBinary({ bookId, path })).base64);
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
  };
}
