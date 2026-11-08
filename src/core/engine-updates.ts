/**
 * Maintainer engine checks. Electron patch releases matter even when Chromium is unchanged.
 * scripts/check-engine.mjs runs this daily on GitHub and mails the developer; the app itself never checks.
 */

/** Electron's public release feed: every release, with the Chromium it ships. */
export const ELECTRON_RELEASES_URL = 'https://releases.electronjs.org/releases.json';

export interface EngineRelease {
  /** Electron version, e.g. "44.7.2". */
  electron: string;
  /** The Chromium it ships, e.g. "152.0.7977.149". */
  chrome: string;
}

/** Plain dotted versions; pre-releases ("45.0.0-beta.3", "46.0.0-nightly.20261014") don't match. */
const STABLE_VERSION = /^\d+(\.\d+)*$/;

/** Compares dotted version numbers: negative when `a` is older than `b`, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The newest stable Electron and its bundled Chromium, or null if the feed has none. */
export function newestStableEngine(feed: unknown): EngineRelease | null {
  if (!Array.isArray(feed)) return null;
  let newest: EngineRelease | null = null;
  for (const entry of feed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { version, chrome } = entry as Record<string, unknown>;
    if (typeof version !== 'string' || typeof chrome !== 'string' || !STABLE_VERSION.test(version) || !STABLE_VERSION.test(chrome)) continue;
    const order = newest ? compareVersions(version, newest.electron) || compareVersions(chrome, newest.chrome) : 1;
    if (order > 0) newest = { electron: version, chrome };
  }
  return newest;
}

/** Update Electron, including patches with the same Chromium; never downgrade either engine. */
export function engineUpdate(current: EngineRelease, latest: EngineRelease | null): EngineRelease | null {
  return latest &&
    STABLE_VERSION.test(current.electron) &&
    STABLE_VERSION.test(current.chrome) &&
    compareVersions(latest.electron, current.electron) > 0 &&
    compareVersions(latest.chrome, current.chrome) >= 0
    ? latest
    : null;
}

export const releaseNotesUrl = (release: EngineRelease) => `https://releases.electronjs.org/release/v${release.electron}`;
