import { BOOK_SCHEME, type ElectronNativeApi } from './electron-api';
import { chromiumMajor, MIN_ENGINE_MAJOR, type FileRef, type Platform } from './platform';

declare global {
  interface Window {
    ereaderNative?: ElectronNativeApi;
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function createElectronPlatform(api: ElectronNativeApi): Platform {
  const toRef = (path: string): FileRef => ({ ref: path, name: basename(path) });
  return {
    kind: 'electron',
    pickBookFile: () => api.pickBookFile(),
    fileFromDrop(file) {
      const path = api.getPathForFile(file);
      return path ? toRef(path) : null;
    },
    onOpenFile(listener) {
      const unsubscribe = api.onOpenFile((path) => listener(toRef(path)));
      void api.takePendingOpenFiles().then((paths) => paths.forEach((p) => listener(toRef(p))));
      return unsubscribe;
    },
    extractArchive: (file, bookId) => api.extractArchive(file.ref, bookId),
    copyRawFile: (file, bookId, path) => api.copyRawFile(file.ref, bookId, path),
    // A file's ref is its path on desktop; Windows takes '/' as a separator too.
    siblingFile: (file, relative) => toRef(file.ref.slice(0, Math.max(file.ref.lastIndexOf('/'), file.ref.lastIndexOf('\\')) + 1) + relative),
    readText: api.readText,
    readBinary: api.readBinary,
    writeText: api.writeText,
    writeBinary: api.writeBinary,
    deleteBook: api.deleteBook,
    bookOrigin: (bookId) => `${BOOK_SCHEME}://${bookId}`,
    kvGet: async <T,>(key: string) => ((await api.kvGet(key)) as T | null) ?? null,
    kvSet: api.kvSet,
    async engineInfo() {
      const v = api.versions();
      return {
        engine: 'Chromium',
        version: v.chrome,
        shell: `Electron ${v.electron} (${v.platform})`,
        upToDate: chromiumMajor(v.chrome) >= MIN_ENGINE_MAJOR,
        updateUrl: null,
      };
    },
    openExternal: api.openExternal,
    setColorScheme: api.setColorScheme,
    hasFolderAccess: async () => true,
    requestFolderAccess: async () => true,
    listFolder: api.listFolder,
    findBookFiles: api.findBookFiles,
    onUpdateReady(listener) {
      const unsubscribe = api.onUpdateReady(listener);
      void api.readyUpdate().then((version) => version && listener(version));
      return unsubscribe;
    },
    installUpdate: api.installUpdate,
  };
}
