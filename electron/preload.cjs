"use strict";

// electron/preload.ts
var import_electron = require("electron");

// src/platform/electron-api.ts
var IPC = {
  pickBookFile: "ereader:pick-book-file",
  openFile: "ereader:open-file",
  takePendingOpenFiles: "ereader:take-pending-open-files",
  extractArchive: "ereader:extract-archive",
  copyRawFile: "ereader:copy-raw-file",
  readText: "ereader:read-text",
  readBinary: "ereader:read-binary",
  writeText: "ereader:write-text",
  writeBinary: "ereader:write-binary",
  deleteBook: "ereader:delete-book",
  kvGet: "ereader:kv-get",
  kvSet: "ereader:kv-set",
  openExternal: "ereader:open-external",
  setColorScheme: "ereader:set-color-scheme",
  listFolder: "ereader:list-folder",
  findBookFiles: "ereader:find-book-files"
};

// electron/preload.ts
var api = {
  pickBookFile: () => import_electron.ipcRenderer.invoke(IPC.pickBookFile),
  getPathForFile: (file) => import_electron.webUtils.getPathForFile(file),
  onOpenFile(listener) {
    const handler = (_event, path) => listener(path);
    import_electron.ipcRenderer.on(IPC.openFile, handler);
    return () => import_electron.ipcRenderer.off(IPC.openFile, handler);
  },
  takePendingOpenFiles: () => import_electron.ipcRenderer.invoke(IPC.takePendingOpenFiles),
  extractArchive: (path, bookId) => import_electron.ipcRenderer.invoke(IPC.extractArchive, path, bookId),
  copyRawFile: (path, bookId, dest) => import_electron.ipcRenderer.invoke(IPC.copyRawFile, path, bookId, dest),
  readText: (bookId, path) => import_electron.ipcRenderer.invoke(IPC.readText, bookId, path),
  readBinary: (bookId, path) => import_electron.ipcRenderer.invoke(IPC.readBinary, bookId, path),
  writeText: (bookId, path, text) => import_electron.ipcRenderer.invoke(IPC.writeText, bookId, path, text),
  writeBinary: (bookId, path, data) => import_electron.ipcRenderer.invoke(IPC.writeBinary, bookId, path, data),
  deleteBook: (bookId) => import_electron.ipcRenderer.invoke(IPC.deleteBook, bookId),
  kvGet: (key) => import_electron.ipcRenderer.invoke(IPC.kvGet, key),
  kvSet: (key, value) => import_electron.ipcRenderer.invoke(IPC.kvSet, key, value),
  versions: () => ({ chrome: process.versions.chrome, electron: process.versions.electron, platform: process.platform }),
  openExternal: (url) => import_electron.ipcRenderer.invoke(IPC.openExternal, url),
  setColorScheme: (scheme) => import_electron.ipcRenderer.invoke(IPC.setColorScheme, scheme),
  listFolder: (path, extensions) => import_electron.ipcRenderer.invoke(IPC.listFolder, path, extensions),
  findBookFiles: (folder, extensions) => import_electron.ipcRenderer.invoke(IPC.findBookFiles, folder, extensions)
};
import_electron.contextBridge.exposeInMainWorld("ereaderNative", api);
//# sourceMappingURL=preload.cjs.map
