/**
 * App updates on Android, where nothing installs them: at start the app asks GitHub for the newest release
 * and offers its APK. (The desktop app updates itself with electron-updater.)
 */
import { compareVersions } from './engine-updates';

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/cheidru/eReaderPlus/releases/latest';
const APK_NAME = 'eReaderPlus.apk';
/** The version whose update offer the user dismissed; a newer one is offered again. */
export const UPDATE_DISMISSED_KEY = 'update-dismissed';

export interface AppUpdate {
  /** e.g. "0.1.2" */
  version: string;
  /** Where its APK downloads from. */
  url: string;
}

const RELEASE_VERSION = /^\d+(\.\d+)*$/;

/** Whether release `version` is newer than the running `current` one, which may be a pre-release ("1.0.0-beta.1"). */
function isNewer(version: string, current: string): boolean {
  const [base, prerelease] = current.split(/[-+]/, 2);
  if (!RELEASE_VERSION.test(base)) return false;
  const order = compareVersions(version, base);
  return order > 0 || (order === 0 && prerelease !== undefined);
}

/** The release in GitHub's latest-release response, if it is newer than `current` and has an APK. */
export function newerRelease(release: unknown, current: string): AppUpdate | null {
  if (typeof release !== 'object' || release === null) return null;
  const { tag_name: tag, assets } = release as Record<string, unknown>;
  if (typeof tag !== 'string') return null;
  const version = tag.replace(/^v/, '');
  if (!RELEASE_VERSION.test(version) || !isNewer(version, current)) return null;
  const apk = Array.isArray(assets)
    ? (assets as unknown[]).find((a): a is { browser_download_url: string } => {
        const asset = a as Record<string, unknown> | null;
        return asset?.name === APK_NAME && typeof asset.browser_download_url === 'string';
      })
    : undefined;
  return apk ? { version, url: apk.browser_download_url } : null;
}

/** The newer release, or null when there is none or GitHub can't be reached (offline, rate-limited). */
export async function checkForAppUpdate(current: string, fetcher: typeof fetch = fetch): Promise<AppUpdate | null> {
  try {
    const response = await fetcher(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
    return response.ok ? newerRelease(await response.json(), current) : null;
  } catch {
    return null;
  }
}
