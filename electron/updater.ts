import { app } from 'electron';
import electronUpdater from 'electron-updater';

/**
 * Checks GitHub Releases for a newer app build. Each Electron upgrade ships a newer Chromium,
 * so this is also how the rendering engine gets updated. Requires `publish` in electron-builder.yml.
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return;
  electronUpdater.autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
    console.warn('Update check failed:', error);
  });
}
