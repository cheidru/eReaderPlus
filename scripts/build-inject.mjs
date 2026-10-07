// Bundles the scripts that are injected into book documents. Output goes to public/__ereader__/,
// which Vite serves in dev and copies into dist/web/ (and from there into the Android assets).
//   paginator.js/.css  — injected into every book document
//   djvu-page.js/.css  — renders DjVu pages; djvu.js is the vendored DjVu.js library (GPL, see vendor/djvujs)
//   pdf-page.js/.css   — renders PDF pages; pdfjs/ is pdf.js (Apache-2.0, from pdfjs-dist) with its data files
import { build, context } from 'esbuild';
import { copyFile, cp, mkdir } from 'node:fs/promises';

const outDir = 'public/__ereader__';
const watch = process.argv.includes('--watch');

await mkdir(outDir, { recursive: true });
const options = {
  entryPoints: {
    paginator: 'src/inject/paginator.ts',
    'djvu-page': 'src/inject/djvu-page.ts',
    'pdf-page': 'src/inject/pdf-page.ts',
  },
  outdir: outDir,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: !watch,
  logLevel: 'info',
};
await Promise.all([
  copyFile('src/inject/paginator.css', `${outDir}/paginator.css`),
  copyFile('src/inject/djvu-page.css', `${outDir}/djvu-page.css`),
  copyFile('vendor/djvujs/djvu.js', `${outDir}/djvu.js`),
  copyFile('vendor/djvujs/LICENSE.md', `${outDir}/djvu.js.LICENSE.md`),
  copyFile('vendor/djvujs/GNU_GPL_v2', `${outDir}/djvu.js.GNU_GPL_v2.txt`),
  copyFile('src/inject/pdf-page.css', `${outDir}/pdf-page.css`),
  copyPdfJs(`${outDir}/pdfjs`),
]);

/** The legacy build, which supports the oldest Chromium the app accepts (MIN_ENGINE_MAJOR). */
async function copyPdfJs(target) {
  const pdfjs = 'node_modules/pdfjs-dist';
  await mkdir(target, { recursive: true });
  await Promise.all([
    copyFile(`${pdfjs}/legacy/build/pdf.min.mjs`, `${target}/pdf.min.mjs`),
    copyFile(`${pdfjs}/legacy/build/pdf.worker.min.mjs`, `${target}/pdf.worker.min.mjs`),
    copyFile(`${pdfjs}/LICENSE`, `${target}/LICENSE`),
    ...['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((dir) => cp(`${pdfjs}/${dir}`, `${target}/${dir}`, { recursive: true })),
  ]);
}
if (watch) {
  await (await context(options)).watch();
} else {
  await build(options);
}
