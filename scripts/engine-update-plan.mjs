// Shared by the email check and the maintainer updater. Not imported by the app.
import { ELECTRON_RELEASES_URL, engineUpdate, newestStableEngine } from '../src/core/engine-updates.ts';

export async function fetchEngineFeed() {
  const response = await fetch(ELECTRON_RELEASES_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Electron release feed: HTTP ${response.status}`);
  return response.json();
}

export function enginePlan(lock, feed) {
  const electron = lock.packages?.['node_modules/electron']?.version;
  if (!electron) throw new Error('No Electron in package-lock.json');
  const release = Array.isArray(feed) && feed.find((item) => item?.version === electron);
  if (!release || typeof release.chrome !== 'string' || !/^\d+(\.\d+)*$/.test(release.chrome)) {
    throw new Error(`Electron ${electron} is not in the release feed, or its Chromium version is invalid`);
  }
  const current = { electron, chrome: release.chrome };
  const latest = newestStableEngine(feed);
  if (!latest) throw new Error('The release feed contains no stable Electron releases');
  return { current, latest, update: engineUpdate(current, latest) };
}

/** A fresh patch version, skipping version tags already used on this release line. */
export function nextAppVersion(current, tags) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new Error(`Expected a stable app version, got ${current}`);
  const [, major, minor, patch] = match;
  let next = Number(patch) + 1;
  for (const tag of tags) {
    const version = /^v(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(tag);
    if (version && version[1] === major && version[2] === minor) next = Math.max(next, Number(version[3]) + 1);
  }
  return `${major}.${minor}.${next}`;
}
