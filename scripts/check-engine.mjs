// Checks for newer stable Electron releases, including patches with unchanged Chromium. When there is one,
// writes the mail about it to .engine-notice/ and sets the GitHub Actions
// outputs `chrome` and `electron` (.github/workflows/engine-updates.yml sends it). Prints the result either way.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { releaseNotesUrl } from '../src/core/engine-updates.ts';
import { enginePlan, fetchEngineFeed } from './engine-update-plan.mjs';

const REPO = 'https://github.com/cheidru/eReaderPlus';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const { current, update } = enginePlan(lock, await fetchEngineFeed());
if (!update) {
  console.log(`Up to date: Electron ${current.electron} with Chromium ${current.chrome}.`);
} else {
  const subject = `eReaderPlus: Electron ${update.electron} is out (Chromium ${update.chrome})`;
  const body = [
    'A newer rendering engine is out for the eReaderPlus desktop app.',
    '',
    `The app now:  Electron ${current.electron} with Chromium ${current.chrome}`,
    `Newest:       Electron ${update.electron} with Chromium ${update.chrome}`,
    '',
    `What's new:   ${releaseNotesUrl(update)}`,
    `Update tool:  ${REPO}/actions/workflows/update-engine.yml`,
    `Update PR:    ${REPO}/pulls?q=is%3Apr+is%3Aopen+head%3Amaintenance%2Fupdate-engine`,
    '',
    'Open the update tool and choose Run workflow on main. It tests the upgrade on all three desktop platforms',
    'and provides test installers before proposing a pull request. Review it, merge, then release with a version tag.',
    'Or run `npm run update:engine` in a clean local checkout. Nothing is committed or published by the local tool.',
    '',
    'Android needs nothing: its engine, Android System WebView, is updated by the Play Store.',
  ].join('\n');
  await mkdir('.engine-notice', { recursive: true });
  await writeFile('.engine-notice/subject', subject);
  await writeFile('.engine-notice/body', `${body}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `chrome=${update.chrome}\nelectron=${update.electron}\n`);
  console.log(`${subject}\n\n${body}`);
}
