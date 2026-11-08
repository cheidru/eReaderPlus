# eReaderPlus

An ebook reader that turns books into HTML and renders them with an up-to-date Chromium, so books can use the
modern web platform, including JavaScript (modules, canvas, View Transitions, `crypto.subtle`, …).

## Install and update

Download from **https://cheidru.github.io/eReaderPlus/**. The page offers the right file for your device; every
version is also listed under [Releases](https://github.com/cheidru/eReaderPlus/releases).

### Windows 10 or 11

1. Click **Download for Windows** and open the downloaded `eReaderPlus-Setup.exe`.
2. If Windows says "Windows protected your PC", click **More info**, then **Run anyway** (the installer is not
   code-signed yet).
3. eReaderPlus installs in a few seconds, without asking for administrator rights, and starts. Open it later from the
   Start menu or the desktop icon.

**Updates install themselves.** Each time eReaderPlus starts, it checks for a new version and downloads it in the
background; Windows shows a notification when it is ready, and it is installed when you close the app. To update by
hand, run the newest installer from the download page over the installed app.

### Android 7.0 or newer

1. Open the download page on the phone, tap **Download for Android** and open the downloaded `eReaderPlus.apk`.
2. If asked, allow your browser to **install unknown apps**, then go back.
3. Tap **Install**. If Play Protect warns about an unknown app, tap **More details**, then **Install anyway**.
4. Start eReaderPlus from its icon on the home screen or in the app list.

**Updates:** when a new version is out, eReaderPlus shows "eReaderPlus *version* is available" at the top of the
screen. Tap **Download**, open the downloaded file and tap **Update**. (**Not now** hides the notice until the next
version.) You can also install the newest APK from the download page at any time.

On both systems your books, reading positions and settings are kept through updates.

### iPhone and iPad

Not available yet.

## Platforms and formats

- **Desktop** (Windows, macOS, Linux): Electron, which ships its own Chromium.
- **Android**: Capacitor on Android System WebView (Chromium, kept current by Google Play).
- **iOS** (planned): Capacitor on WKWebView. Apple requires WebKit, so iOS cannot use Chromium.

Formats: EPUB 2/3 (including fixed layout and obfuscated fonts), PDF (with text layer, outline and links), MOBI / AZW
(MOBI 6), AZW3 (KF8, also inside combined MOBI files), FB2 / FB2.zip, CBZ, DjVu (bundled, with OCR text layer and
outline), CHM (Compiled HTML Help), LIT (Microsoft Reader) and Markdown (a .md file, or a ZIP of .md files and their
images; GitHub-flavored). DRM-protected books are refused, except LIT files that are merely "sealed" or "inscribed": those
use a key derived from the file itself, like EPUB font obfuscation, and are opened.

**License note:** distributed builds are subject to the GPL, version 3: DjVu pages are decoded by the vendored
[DjVu.js](vendor/djvujs/README.md) (GPL-2.0-or-later), and the LIT reader (`src/core/lit*.ts`) is ported from Calibre
(GPL-3.0). Other components: pdf.js (Apache-2.0, `pdfjs-dist`), chmlib-ts (LGPL-2.1, plus its LZX decoder vendored in
[vendor/chmlib-lzx](vendor/chmlib-lzx/README.md)), MOBI/KF8 parsing adapted from foliate-js (MIT), and marked (MIT).

## How it works

1. **Import** (`src/core/`, shared by all platforms): native code unzips the book into its own folder; TypeScript
   parses it, converts FB2/CBZ/MOBI/AZW3/LIT/Markdown to (X)HTML, extracts CHM help files (transcoded to UTF-8), and injects a
   small paginator script into every chapter. DjVu and PDF are not converted: each page document renders its page
   from the original file when shown (pdf.js, which has its own worker). For DjVu the app keeps the open book in
   memory: DjVu.js in a Web Worker decodes pages in the background ahead of the reader, as many as fit a memory
   budget (a small book entirely), so turning a page is instant.
   Scripted XHTML chapters are re-serialized as HTML, because Chromium won't run module scripts in XML documents.
   Each importer reports the title and cover first (the cover is written before anything else), so a new book shows
   up in the library with its cover at once while the rest is converted in the background.
2. **Serve**: each book gets its own origin: `book://<id>/` on desktop, `https://<id>.ereaderplus.invalid/` on
   Android. A strict CSP blocks the network.
3. **Render**: the React UI shows the chapter in a sandboxed, cross-origin iframe. The paginator
   (`src/inject/paginator.ts`) lays out pages with CSS multi-column and talks to the app only via `postMessage`.
   The documents before and after the one shown (chapters, comic or PDF pages) are loaded ahead in frames out of sight,
   so turning into them shows them at once.

## Development

```sh
npm install
npm run install:electron
npm run dev:desktop     # Vite dev server + Electron
npm test                # unit tests (parsers, injection, message validation)
npm run test:e2e        # builds, generates samples/, drives the real Electron app with Playwright
node scripts/make-icons.mjs  # renders the app icon for desktop, Android and the download page from one design
npm run samples         # sample books in samples/ (modern-web.epub, hostile.epub, sample.fb2, sample.cbz, sample.mobi, …)
```

The MOBI, AZW3, LIT, DjVu, PDF and CHM samples are copies of the committed fixtures in `test/fixtures/books/`. To
regenerate those, run `node scripts/make-test-fixtures.mjs` (the Kindle and LIT files need Calibre's `ebook-convert` on
`PATH`).

Packaging: `npm run dist:win` / `dist:mac` / `dist:linux` (installers in `release/`).

Android needs JDK 21 and Android SDK 36 (Android Studio's bundled JBR works as `JAVA_HOME`):

```sh
npm run android:sync    # builds the web app and copies it into android/
npm run android:run     # or open android/ in Android Studio
```

## Releases

The download page (`site/`, published by `.github/workflows/pages.yml` to https://cheidru.github.io/eReaderPlus/;
enable it once under Settings > Pages > Source: GitHub Actions) links to the newest GitHub Release. The desktop app
updates itself from the releases with electron-updater; the Android app looks up the newest release at start
(`src/core/app-updates.ts`) and offers its APK.

To release, push a version tag: `git tag v0.2.0 && git push origin v0.2.0`. The Release workflow
(`.github/workflows/release.yml`) takes the version from the tag, builds `eReaderPlus-Setup.exe` (with `latest.yml`
for auto-update) and a signed `eReaderPlus.apk`, and publishes them as a GitHub Release. Tags with a suffix
(`v1.0.0-beta.1`) become pre-releases, which the download page and auto-update skip.

- **Android signing** (required): the secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` (Settings > Secrets and variables > Actions). Keep a backup of the
  keystore and its passwords: Android only installs an update signed with the same key.
- **Windows signing** (optional): without it, SmartScreen warns on first run ("More info > Run anyway"). The
  workflow signs with Azure Artifact Signing when the `AZURE_*` secrets and variables listed in `release.yml` are set.

## Updating the rendering engine

- **Desktop**: use the maintainer-only **Update engine** workflow below. It upgrades Electron together with its
  bundled Chromium, including Electron patches that leave Chromium unchanged. Installed apps receive the engine
  through an ordinary app release. Shipping without warnings needs code-signing certificates (Windows, Apple Developer ID).
- **Android**: the WebView updates itself through Google Play. The app shows a warning with an update link when
  the WebView is older than `MIN_ENGINE_MAJOR` (`src/platform/platform.ts`).

### Maintainer update button

The daily **Engine updates** workflow emails once per newer stable Electron release. Its email links to
[Actions → Update engine](https://github.com/cheidru/eReaderPlus/actions/workflows/update-engine.yml).
Choose **Run workflow**, leave the branch at **main**, and run it. Beta and nightly releases are excluded.

The workflow pins Electron exactly in `package.json` and `package-lock.json`, chooses the next unused patch
version for the app, and tests those files against the starting main commit. It runs typecheck, unit tests,
desktop end-to-end tests, and installer builds on Windows, macOS, and Linux. The workflow calls the same
`desktop-checks.yml` used by normal CI; it does not depend on a bot-created PR triggering those tests.

After validation, it creates or refreshes one PR on the managed branch `maintenance/update-engine`. Do not put
manual edits on that branch: another run refreshes it. If main changes during validation, the run stops and asks
you to run it again. An already-current engine produces no changes. A failed test or installer build prevents
the PR from being created or refreshed; the run's logs and diagnostic artifacts explain the failure.

Open the run's **Artifacts**, download `installers-windows-latest`, unzip it, and try `eReaderPlus-Setup.exe`.
Mac and Linux installers are available too. These are unsigned test installers retained for 14 days; they are
not published releases. Installing one can update your existing local eReaderPlus installation.

Review and merge the PR, then pull main and push the version tag named in the PR to publish through the existing
Release workflow. Before tagging, check that the app version and tag are still unused if other changes have
landed meanwhile. The updater never merges, tags, or publishes automatically.

One-time repository setup: **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to
create and approve pull requests** must be enabled. The updater requests repository write permissions only for
its final PR job and needs no personal access token. If GitHub displays **Approve workflows to run** on the PR,
approve its normal CI checks before merging; the update workflow's own validation has already run.

Dependabot continues to update packaging tools and other dependencies, but `electron` itself is excluded so the
manual workflow owns engine upgrades. Existing Dependabot PRs may still include Electron: merge or close those
once before using the tool. It detects such PRs and stops rather than creating a duplicate. Continue reviewing
Dependabot security alerts as usual; the manual engine tool is responsible for applying Electron updates.

### Local maintainer command

Use Node 24 or newer. A read-only preview works even with uncommitted changes:

```powershell
npm run update:engine -- --check
```

To prepare and test an update, start from an up-to-date main checkout with a clean working tree and an `origin`
remote. Then run:

```powershell
npm run update:engine
```

It creates `maintenance/electron-<version>`, updates the two package files, installs dependencies and the Electron
executable, and runs typecheck, unit tests, and desktop end-to-end tests on your OS. On Linux without a display,
`xvfb-run` must be installed. Existing branch names are never overwritten. Failures leave the prepared files
for inspection; the command does not commit, push, or publish. After success, use `npm run dist:win` (or
`dist:mac` / `dist:linux`) if you want a local installer. Review and commit the package changes before opening a PR.

`--prepare-only` is the workflow's internal mode: it updates only the package files, leaving installation and
validation to the OS matrix. It does not switch branches. Do not treat this mode as a tested update.

The updater and email scripts live under `scripts/`, and the workflow files live under `.github/`. Neither
directory is shipped by `electron-builder.yml`; the installed app has no maintainer update controls or credentials.
