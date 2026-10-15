// Checks Electron's release feed for a Chromium newer than the one the app's Electron ships (from
// package-lock.json). When there is one, writes the mail about it to .engine-notice/ and sets the GitHub Actions
// outputs `chrome` and `electron` (.github/workflows/engine-updates.yml sends it). Prints the result either way.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { ELECTRON_RELEASES_URL, engineUpdate, newestStableEngine, releaseNotesUrl } from '../src/core/engine-updates.ts';

const REPO = 'https://github.com/cheidru/eReaderPlus';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const current = lock.packages?.['node_modules/electron']?.version;
if (!current) throw new Error('No Electron in package-lock.json');

const response = await fetch(ELECTRON_RELEASES_URL);
if (!response.ok) throw new Error(`${ELECTRON_RELEASES_URL}: HTTP ${response.status}`);
const feed = await response.json();
const currentChrome = feed.find?.((release) => release.version === current)?.chrome;
if (!currentChrome) throw new Error(`Electron ${current} is not in the release feed`);

const update = engineUpdate(currentChrome, newestStableEngine(feed));
if (!update) {
  console.log(`Up to date: Electron ${current} ships Chromium ${currentChrome}, the newest stable one.`);
} else {
  const subject = `eReaderPlus: Chromium ${update.chrome} is out (Electron ${update.electron})`;
  const body = [
    'A newer rendering engine is out for the eReaderPlus desktop app.',
    '',
    `The app now:  Electron ${current} with Chromium ${currentChrome}`,
    `Newest:       Electron ${update.electron} with Chromium ${update.chrome}`,
    '',
    `What's new:   ${releaseNotesUrl(update)}`,
    `Update PRs:   ${REPO}/pulls?q=is%3Apr+is%3Aopen+electron`,
    '',
    'To update: merge the Electron pull request once its checks pass (or run `npm install -D electron@latest`),',
    'then build and publish a new release of the app.',
    '',
    'Android needs nothing: its engine, Android System WebView, is updated by the Play Store.',
  ].join('\n');
  await mkdir('.engine-notice', { recursive: true });
  await writeFile('.engine-notice/subject', subject);
  await writeFile('.engine-notice/body', `${body}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `chrome=${update.chrome}\nelectron=${update.electron}\n`);
  console.log(`${subject}\n\n${body}`);
}
