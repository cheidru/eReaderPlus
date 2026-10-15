// Renders the app icon in every size the platforms need, from the one design below:
//   build/icon.png                         — Windows/macOS/Linux (electron-builder makes the .ico/.icns from it)
//   android/.../mipmap-*/ic_launcher*.png  — Android launcher (adaptive foreground + monochrome, legacy square/round)
//   android/.../drawable*/splash.png       — Android launch screen
//   site/favicon.svg, site/apple-touch-icon.png — download page
// Run `node scripts/make-icons.mjs` after changing the design. Needs Chrome (or `npx playwright install chromium`).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

// The app's default theme (Dusk, src/ui/App.css).
const colors = {
  backgroundTop: '#56418c',
  backgroundBottom: '#2b1f46',
  page: '#fff4e6',
  text: '#b9a6dc',
  plus: '#ff9f43',
  splash: '#14111b',
};

// An open book with a plus on the right page. Drawn in a 100 x 100 box, centered at (50, 50).
const leftPage = 'M47 27C37 20 23 19 10 22V76C23 73 37 74 47 81Z';
const rightPage = 'M53 27C63 20 77 19 90 22V76C77 73 63 74 53 81Z';
const lines = [33, 43, 53, 63].map((y, i) => `M17 ${y + 1 - i * 0.2}C25 ${y - 1} 33 ${y - 0.5} 40 ${y + 2.5}`);
const plus = 'M71.5 41.5v18M62.5 50.5h18';

function glyph() {
  return `<path d="${leftPage}" fill="${colors.page}"/>
    <path d="${rightPage}" fill="${colors.page}"/>
    <path d="${lines.join('')}" fill="none" stroke="${colors.text}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="${plus}" stroke="${colors.plus}" stroke-width="6.5" stroke-linecap="round"/>`;
}

/** Single-color glyph for Android's themed icons: the lines and the plus are cut out of the pages. */
function monochromeGlyph() {
  return `<mask id="cut"><rect width="100" height="100" fill="#fff"/>
      <path d="${lines.join('')}" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round"/>
      <path d="${plus}" stroke="#000" stroke-width="6.5" stroke-linecap="round"/></mask>
    <g mask="url(#cut)"><path d="${leftPage}" fill="#fff"/><path d="${rightPage}" fill="#fff"/></g>`;
}

const gradient = `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${colors.backgroundTop}"/><stop offset="1" stop-color="${colors.backgroundBottom}"/></linearGradient>`;

/** `content` (100 x 100 units) scaled to `scale` and centered in a `width` x `height` canvas. */
function place(content, width, height, scale) {
  const s = scale / 100;
  return `<g transform="translate(${width / 2 - 50 * s} ${height / 2 - 50 * s}) scale(${s})">${content}</g>`;
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

/** The icon on its background: `shape` is 'rounded' (desktop, Android legacy), 'round' or 'square' (iOS rounds it). */
function icon(size, shape = 'rounded') {
  const inset = shape === 'square' ? 0 : size * 0.04;
  const side = size - 2 * inset;
  const radius = shape === 'round' ? side / 2 : shape === 'square' ? 0 : side * 0.22;
  return svg(size, size, `<defs>${gradient}</defs>
    <rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${radius}" fill="url(#bg)"/>
    ${place(glyph(), size, size, size * 0.74)}`);
}

// Android adaptive icons: a 108dp layer of which the launcher shows at least the middle 66dp circle.
const adaptiveScale = 0.62;
const adaptiveForeground = (size) => svg(size, size, place(glyph(), size, size, size * adaptiveScale));
const adaptiveMonochrome = (size) => svg(size, size, place(monochromeGlyph(), size, size, size * adaptiveScale));

function splash(width, height) {
  const size = Math.min(width, height) * 0.3;
  return svg(width, height, `<defs>${gradient}</defs><rect width="${width}" height="${height}" fill="${colors.splash}"/>
    <g transform="translate(${(width - size) / 2} ${(height - size) / 2})">${icon(size).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`);
}

const res = 'android/app/src/main/res';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const splashSizes = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };

const outputs = [['build/icon.png', icon(1024)], ['site/apple-touch-icon.png', icon(180, 'square')]];
for (const [density, factor] of Object.entries(densities)) {
  const dir = `${res}/mipmap-${density}`;
  outputs.push(
    [`${dir}/ic_launcher.png`, icon(48 * factor)],
    [`${dir}/ic_launcher_round.png`, icon(48 * factor, 'round')],
    [`${dir}/ic_launcher_foreground.png`, adaptiveForeground(108 * factor)],
    [`${dir}/ic_launcher_monochrome.png`, adaptiveMonochrome(108 * factor)],
  );
  const [w, h] = splashSizes[density];
  outputs.push([`${res}/drawable-port-${density}/splash.png`, splash(w, h)], [`${res}/drawable-land-${density}/splash.png`, splash(h, w)]);
}
outputs.push([`${res}/drawable/splash.png`, splash(480, 320)]);

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage();
for (const [path, image] of outputs) {
  const [, width, height] = image.match(/width="([\d.]+)" height="([\d.]+)"/).map(Number);
  await page.setViewportSize({ width, height });
  await page.setContent(`<body style="margin:0;background:transparent">${image}</body>`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, omitBackground: true });
}
await browser.close();

await writeFile('site/favicon.svg', icon(64));
console.log(`Wrote ${outputs.length + 1} files`);
