# eReaderPlus

An ebook reader that turns books into HTML and renders them with an up-to-date Chromium, so books can use the
modern web platform, including JavaScript (modules, canvas, View Transitions, `crypto.subtle`, …).

- **Desktop** (Windows, macOS, Linux): Electron, which ships its own Chromium.
- **Android**: Capacitor on Android System WebView (Chromium, kept current by Google Play).
- **iOS** (planned): Capacitor on WKWebView. Apple requires WebKit, so iOS cannot use Chromium.

Formats: EPUB 2/3 (including fixed layout and obfuscated fonts), PDF (with text layer, outline and links), MOBI / AZW
(MOBI 6), AZW3 (KF8, also inside combined MOBI files), FB2 / FB2.zip, CBZ, DjVu (bundled, with OCR text layer and
outline), CHM (Compiled HTML Help) and LIT (Microsoft Reader). DRM-protected books are refused, except LIT files that are
merely "sealed" or "inscribed": those use a key derived from the file itself, like EPUB font obfuscation, and are opened.

**License note:** distributed builds are subject to the GPL, version 3: DjVu pages are decoded by the vendored
[DjVu.js](vendor/djvujs/README.md) (GPL-2.0-or-later), and the LIT reader (`src/core/lit*.ts`) is ported from Calibre
(GPL-3.0). Other components: pdf.js (Apache-2.0, `pdfjs-dist`), chmlib-ts (LGPL-2.1, plus its LZX decoder vendored in
[vendor/chmlib-lzx](vendor/chmlib-lzx/README.md)), and MOBI/KF8 parsing adapted from foliate-js (MIT).

## How it works

1. **Import** (`src/core/`, shared by all platforms): native code unzips the book into its own folder; TypeScript
   parses it, converts FB2/CBZ/MOBI/AZW3/LIT to (X)HTML, extracts CHM help files (transcoded to UTF-8), and injects a
   small paginator script into every chapter. DjVu and PDF are not converted: each page document renders its page
   from the original file when shown (DjVu.js in a Web Worker; pdf.js, which has its own worker).
   Scripted XHTML chapters are re-serialized as HTML, because Chromium won't run module scripts in XML documents.
2. **Serve**: each book gets its own origin: `book://<id>/` on desktop, `https://<id>.ereaderplus.invalid/` on
   Android. A strict CSP blocks the network.
3. **Render**: the React UI shows the chapter in a sandboxed, cross-origin iframe. The paginator
   (`src/inject/paginator.ts`) lays out pages with CSS multi-column and talks to the app only via `postMessage`.

## Development

```sh
npm install
npm run dev:desktop     # Vite dev server + Electron
npm test                # unit tests (parsers, injection, message validation)
npm run test:e2e        # builds, generates samples/, drives the real Electron app with Playwright
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

## Updating the rendering engine

- **Desktop**: each Electron major ships a newer Chromium (about every 8 weeks; security fixes in between).
  Dependabot opens a PR for new Electron releases, and CI runs the unit and end-to-end tests on all three OSes.
  Merge the PR, tag a release, and publish with `electron-builder --publish always`. Installed apps update through
  electron-updater (set `publish:` in `electron-builder.yml` first). Shipping without warnings needs code-signing
  certificates (Windows, Apple Developer ID).
- **Android**: the WebView updates itself through Google Play. The app shows a warning with an update link when
  the WebView is older than `MIN_ENGINE_MAJOR` (`src/platform/platform.ts`).
