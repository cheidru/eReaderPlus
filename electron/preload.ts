import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type ElectronNativeApi } from '../src/platform/electron-api';

const api: ElectronNativeApi = {
  pickBookFile: () => ipcRenderer.invoke(IPC.pickBookFile),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onOpenFile(listener) {
    const handler = (_event: Electron.IpcRendererEvent, path: string) => listener(path);
    ipcRenderer.on(IPC.openFile, handler);
    return () => ipcRenderer.off(IPC.openFile, handler);
  },
  takePendingOpenFiles: () => ipcRenderer.invoke(IPC.takePendingOpenFiles),
  onUpdateReady(listener) {
    const handler = (_event: Electron.IpcRendererEvent, version: string) => listener(version);
    ipcRenderer.on(IPC.updateReady, handler);
    return () => ipcRenderer.off(IPC.updateReady, handler);
  },
  readyUpdate: () => ipcRenderer.invoke(IPC.readyUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  extractArchive: (path, bookId) => ipcRenderer.invoke(IPC.extractArchive, path, bookId),
  copyRawFile: (path, bookId, dest) => ipcRenderer.invoke(IPC.copyRawFile, path, bookId, dest),
  readText: (bookId, path) => ipcRenderer.invoke(IPC.readText, bookId, path),
  readBinary: (bookId, path) => ipcRenderer.invoke(IPC.readBinary, bookId, path),
  writeText: (bookId, path, text) => ipcRenderer.invoke(IPC.writeText, bookId, path, text),
  writeBinary: (bookId, path, data) => ipcRenderer.invoke(IPC.writeBinary, bookId, path, data),
  deleteBook: (bookId) => ipcRenderer.invoke(IPC.deleteBook, bookId),
  kvGet: (key) => ipcRenderer.invoke(IPC.kvGet, key),
  kvSet: (key, value) => ipcRenderer.invoke(IPC.kvSet, key, value),
  versions: () => ({ chrome: process.versions.chrome, electron: process.versions.electron, platform: process.platform }),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  setColorScheme: (scheme) => ipcRenderer.invoke(IPC.setColorScheme, scheme),
  listFolder: (path, extensions) => ipcRenderer.invoke(IPC.listFolder, path, extensions),
  findBookFiles: (folder, extensions) => ipcRenderer.invoke(IPC.findBookFiles, folder, extensions),
};

contextBridge.exposeInMainWorld('ereaderNative', api);
