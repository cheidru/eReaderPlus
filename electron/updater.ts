import { app } from 'electron';
import electronUpdater from 'electron-updater';

/** How often an app left open looks again for a newer release. */
const RECHECK_MS = 4 * 60 * 60 * 1000;

/** The version downloaded and waiting to be installed, if any. */
let readyVersion: string | null = null;

/**
 * Checks GitHub Releases for a newer app build, at start and every few hours, and downloads it in the background.
 * Each Electron upgrade ships a newer Chromium, so this is also how the rendering engine gets updated.
 * A downloaded update installs when the app quits; `onReady` lets the app offer to restart into it now.
 * Requires `publish` in electron-builder.yml.
 */
export function initAutoUpdate(onReady: (version: string) => void): void {
  if (!app.isPackaged) return;
  const { autoUpdater } = electronUpdater;
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version;
    onReady(info.version);
  });
  const check = () =>
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.warn('Update check failed:', error);
    });
  void check();
  setInterval(check, RECHECK_MS);
}

export function readyUpdate(): string | null {
  return readyVersion;
}

/** Quits, installs the downloaded update without asking again, and starts the new version. */
export function installUpdate(): void {
  if (readyVersion) electronUpdater.autoUpdater.quitAndInstall(true, true);
}
