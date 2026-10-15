import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { IPC } from '../src/platform/electron-api';
import * as bookstore from './bookstore';
import { findBookFiles, listFolder } from './folders';
import { kvGet, kvSet } from './kv';
import { APP_ORIGIN, registerProtocols, registerSchemes } from './protocols';
import { hardenAllWebContents, hardenSession, isAppUrl } from './security';
import { initAutoUpdate } from './updater';

const BOOK_EXTENSIONS = ['epub', 'kepub', 'fb2', 'fbz', 'cbz', 'zip', 'mobi', 'azw', 'azw3', 'djvu', 'djv', 'pdf', 'chm', 'lit'];
const devUrl = process.env.ELECTRON_RENDERER_URL ?? null;
const devOrigin = devUrl ? new URL(devUrl).origin : null;

let mainWindow: BrowserWindow | null = null;
/** Files opened from the OS before the renderer asked for them. */
let pendingFiles: string[] = [];
let rendererReady = false;

registerSchemes();

// Lets tests and side-by-side dev builds use a separate library.
if (process.env.EREADER_USER_DATA) app.setPath('userData', path.resolve(process.env.EREADER_USER_DATA));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingFiles.push(...bookFilesFromArgv(process.argv));
  app.on('second-instance', (_event, argv) => {
    bookFilesFromArgv(argv).forEach(openFile);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('open-file', (event, file) => {
    event.preventDefault();
    openFile(file);
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}

function bookFilesFromArgv(argv: string[]): string[] {
  // argv[0] is the executable; in dev it is followed by the app path and possibly Chromium switches.
  return argv.slice(1).filter((arg) => {
    if (arg.startsWith('-')) return false;
    const ext = path.extname(arg).slice(1).toLowerCase();
    return BOOK_EXTENSIONS.includes(ext) && existsSync(arg) && statSync(arg).isFile();
  });
}

function openFile(file: string): void {
  if (rendererReady && mainWindow) mainWindow.webContents.send(IPC.openFile, file);
  else pendingFiles.push(file);
}

function start(): void {
  const readerSession = session.fromPartition('persist:ereader');
  const webRoot = path.join(app.getAppPath(), 'dist', 'web');
  const readerAssetsDir = devUrl ? path.join(app.getAppPath(), 'public', '__ereader__') : path.join(webRoot, '__ereader__');

  hardenSession(readerSession, devOrigin);
  hardenAllWebContents(devOrigin);
  registerProtocols(readerSession, { webRoot, readerAssetsDir, devOrigin });
  registerIpc();
  createWindow(readerSession);
  initAutoUpdate();
}

function createWindow(readerSession: Electron.Session): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    show: false,
    // The default app theme's page (Dusk, dark), so the window doesn't flash another color before the UI draws.
    backgroundColor: '#14111b',
    autoHideMenuBar: true,
    webPreferences: {
      session: readerSession,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
  // Main-frame navigations only (reloads); the renderer re-announces itself via takePendingOpenFiles.
  mainWindow.webContents.on('did-navigate', () => (rendererReady = false));
  void mainWindow.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`);
}

/** An argument that must be a list of strings (file extensions). */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** IPC is only accepted from the app's own top-level page, never from book frames. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent !== null || !isAppUrl(frame.url, devOrigin)) {
      throw new Error('IPC from an untrusted frame');
    }
    return fn(...(args as A));
  });
}

function registerIpc(): void {
  handle(IPC.pickBookFile, async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Books', extensions: BOOK_EXTENSIONS }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    const file = result.filePaths[0];
    return result.canceled || !file ? null : { ref: file, name: path.basename(file) };
  });
  handle(IPC.takePendingOpenFiles, () => {
    rendererReady = true;
    const files = pendingFiles;
    pendingFiles = [];
    return files;
  });
  handle(IPC.extractArchive, (file: string, bookId: string) => bookstore.extractArchive(file, bookId));
  handle(IPC.copyRawFile, (file: string, bookId: string, dest: string) => bookstore.copyRawFile(file, bookId, dest));
  handle(IPC.readText, (bookId: string, rel: string) => bookstore.readText(bookId, rel));
  handle(IPC.readBinary, (bookId: string, rel: string) => bookstore.readBinary(bookId, rel));
  handle(IPC.writeText, (bookId: string, rel: string, text: string) => bookstore.writeFileInBook(bookId, rel, text));
  handle(IPC.writeBinary, (bookId: string, rel: string, data: Uint8Array) => bookstore.writeFileInBook(bookId, rel, data));
  handle(IPC.deleteBook, (bookId: string) => bookstore.deleteBook(bookId));
  handle(IPC.kvGet, (key: string) => kvGet(key));
  handle(IPC.kvSet, (key: string, value: unknown) => kvSet(key, value));
  handle(IPC.openExternal, async (url: string) => {
    if (!/^(https?:|mailto:)/i.test(url)) throw new Error('Refusing to open a non-web URL');
    await shell.openExternal(url);
  });
  // Drives prefers-color-scheme for the app and every book frame.
  handle(IPC.listFolder, (dir: string, extensions: string[]) => listFolder(String(dir), stringList(extensions)));
  handle(IPC.findBookFiles, (dir: string, extensions: string[]) => findBookFiles(String(dir), stringList(extensions)));
  handle(IPC.setColorScheme, (scheme: string) => {
    nativeTheme.themeSource = scheme === 'dark' ? 'dark' : 'light';
  });
}
