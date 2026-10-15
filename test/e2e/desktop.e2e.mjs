// End-to-end check of the desktop app: run `npm run build && node scripts/make-sample-books.mjs` first.
// Usage: node test/e2e/desktop.e2e.mjs [screenshot-dir]
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const shots = path.resolve(process.argv[2] ?? 'test-results');
await mkdir(shots, { recursive: true });
const userData = await mkdtemp(path.join(tmpdir(), 'ereader-e2e-'));

async function launch(book) {
  const app = await electron.launch({
    args: ['.', path.resolve('samples', book)],
    env: { ...process.env, EREADER_USER_DATA: userData },
    // Playwright emulates prefers-color-scheme: light by default; let the app control it.
    colorScheme: null,
  });
  const page = await app.firstWindow();
  page.on('console', (m) => m.type() === 'error' && results.push(`INFO [${book} console] ${m.text()}`));
  await page.setViewportSize({ width: 1000, height: 760 }).catch(() => {});
  return { app, page };
}

async function bookFrame(page, file) {
  for (let i = 0; i < 100; i++) {
    const frame = page.frames().find((f) => f.url().startsWith('book://') && f.url().includes(file));
    if (frame) {
      await frame.waitForFunction(() => !document.documentElement.classList.contains('ereader-pending'));
      return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Book frame ${file} did not load; frames: ${page.frames().map((f) => f.url()).join(', ')}`);
}

/**
 * Runs in a book frame: a touch gesture of one or two fingers moving from `from` to `to` ([[x, y], …] in
 * CSS px), as synthetic touch events (Playwright can't drive multi-touch in Electron).
 */
function touch([from, to]) {
  const target = document.elementFromPoint(...from[0]) ?? document.body;
  const at = (points) => points.map(([x, y], identifier) => new Touch({ identifier, target, clientX: x, clientY: y }));
  const fire = (type, touches, changed) =>
    target.dispatchEvent(new TouchEvent(type, { touches, changedTouches: changed, targetTouches: touches, bubbles: true, cancelable: true }));
  fire('touchstart', at(from), at(from));
  for (let step = 1; step <= 5; step++) {
    const points = from.map(([x, y], i) => [x + ((to[i][0] - x) * step) / 5, y + ((to[i][1] - y) * step) / 5]);
    fire('touchmove', at(points), at(points));
  }
  fire('touchend', [], at(to));
}

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message}`);
  }
};

// --- Modern web EPUB: scripts, modern CSS, pagination, TOC navigation, progress -----------------
{
  const { app, page } = await launch('modern-web.epub');
  const versions = await app.evaluate(() => process.versions);
  results.push(`INFO Electron ${versions.electron}, Chromium ${versions.chrome}`);

  const frame = await bookFrame(page, 'modern.xhtml');
  await frame.waitForFunction(() => window.__featureChecks && window.__digest);
  const features = await frame.evaluate(() => window.__featureChecks);
  results.push(`INFO features: ${JSON.stringify(features)}`);
  check('book scripts run with modern features', () => {
    for (const [name, ok] of Object.entries(features)) assert.ok(ok, name);
  });

  const layout = await frame.evaluate(() => ({
    classes: document.documentElement.className,
    pages: Math.round(document.scrollingElement.scrollWidth / innerWidth),
    origin: location.origin,
  }));
  check('paginated layout applied', () => {
    assert.match(layout.classes, /ereader-paginated/);
    assert.ok(layout.pages > 3, `pages=${layout.pages}`);
  });
  check('book has its own origin', () => assert.match(layout.origin, /^book:\/\/[a-f0-9]{32}$/));
  await page.screenshot({ path: path.join(shots, '1-modern-page1.png') });

  await page.locator('.reader-numbers').waitFor();
  const before = await page.locator('.reader-numbers').textContent();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const after = await page.locator('.reader-numbers').textContent();
  const scrollX = await frame.evaluate(() => scrollX);
  check('ArrowRight turns the page', () => {
    assert.match(before, /^Page 1 of \d+/);
    assert.match(after, /^Page 2 of \d+/);
    assert.ok(scrollX > 0);
  });
  await page.screenshot({ path: path.join(shots, '2-modern-page2.png') });

  await page.mouse.move(500, 380);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(400);
  const afterWheel = await page.locator('.reader-numbers').textContent();
  check('mouse wheel turns the page', () => assert.match(afterWheel, /^Page 3 of \d+/));
  const fontScale = () => frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ereader-font-scale').trim());
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(400);
  const zoomedIn = await fontScale();
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const zoomedOut = await fontScale();
  check('Ctrl+wheel changes the font size', () => assert.deepEqual([zoomedIn, zoomedOut], ['1.1', '1']));

  const highlight = (f) =>
    f.evaluate(() => {
      const ranges = [...(CSS.highlights.get('ereader-search') ?? [])];
      const rect = ranges[0]?.getBoundingClientRect();
      return { count: ranges.length, text: ranges[0]?.toString() ?? '', left: rect?.left ?? -1, width: innerWidth };
    });
  await page.getByRole('button', { name: 'Search in book' }).click();
  await page.getByRole('searchbox', { name: 'Search in book' }).fill('pagination');
  await page.locator('.search-hit').nth(8).waitFor();
  const hitCount = await page.locator('.search-hit').count();
  await page.locator('.search-hit').nth(8).click();
  await page.waitForTimeout(500);
  const match = await highlight(frame);
  const matchPage = await page.locator('.reader-numbers').textContent();
  const searchBar = await page.locator('.reader-searchbar').textContent();
  check('search lists matches, then shows the chosen one highlighted on its page', () => {
    assert.ok(hitCount > 8, String(hitCount));
    assert.deepEqual([match.count, match.text], [1, 'pagination']);
    assert.ok(match.left >= 0 && match.left < match.width, JSON.stringify(match));
    assert.doesNotMatch(matchPage, /^Page 1 of/);
    assert.match(searchBar, new RegExp(`9 of ${hitCount}`));
  });
  await page.screenshot({ path: path.join(shots, '2b-search.png') });
  await page.getByRole('button', { name: 'Close search' }).click();
  await page.waitForTimeout(200);
  const afterClose = await highlight(frame);
  check('closing the search removes the highlight', () => assert.equal(afterClose.count, 0));

  await page.getByRole('button', { name: 'Contents' }).click();
  await page.getByRole('button', { name: 'Interactive chapter' }).click();
  const frame2 = await bookFrame(page, 'interactive.xhtml');
  await frame2.waitForFunction(() => window.__moduleRan === true);
  check('TOC navigates to chapter 2 and module scripts run', () => assert.ok(true));
  await frame2.click('#count');
  await frame2.click('#count');
  const counter = await frame2.evaluate(() => localStorage.getItem('counter'));
  check('book localStorage works', () => assert.equal(counter, '2'));
  await page.screenshot({ path: path.join(shots, '3-interactive.png') });

  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.waitForTimeout(500);
  const theme = await frame2.evaluate(() => ({
    theme: document.documentElement.dataset.ereaderTheme,
    bg: getComputedStyle(document.documentElement).backgroundColor,
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
  }));
  check('dark theme reaches the book (incl. prefers-color-scheme)', () => {
    assert.equal(theme.theme, 'dark');
    assert.equal(theme.bg, 'rgb(28, 28, 30)');
    assert.equal(theme.prefersDark, true);
  });
  await page.screenshot({ path: path.join(shots, '4-dark-settings.png') });
  await page.getByRole('button', { name: 'Light' }).click();

  const weight = page.getByRole('slider', { name: 'Font weight' });
  const strokeWidth = () => frame2.evaluate(() => getComputedStyle(document.querySelector('p')).webkitTextStrokeWidth);
  await weight.fill('3');
  await page.waitForTimeout(300);
  const heavier = await strokeWidth();
  await weight.fill('0');
  await page.waitForTimeout(300);
  const normal = await strokeWidth();
  check('font weight thickens the text, and 0 leaves it as published', () => {
    assert.ok(Number.parseFloat(heavier) > 0, heavier);
    assert.equal(normal, '0px');
  });

  // The window is landscape (1000×760), so the setting shows two pages side by side.
  const twoPages = page.getByRole('switch', { name: /Two pages in landscape/ });
  await twoPages.click();
  await page.waitForTimeout(500);
  const spread = await frame2.evaluate(() => ({
    columns: getComputedStyle(document.documentElement).columnCount,
    paragraph: document.querySelector('p').getBoundingClientRect().width,
    half: innerWidth / 2,
  }));
  await page.screenshot({ path: path.join(shots, '4b-two-pages.png') });
  await twoPages.click();
  await page.waitForTimeout(500);
  const single = await frame2.evaluate(() => getComputedStyle(document.documentElement).columnCount);
  check('two pages side by side in landscape, one page when turned off', () => {
    assert.equal(spread.columns, '2');
    assert.ok(spread.paragraph < spread.half, JSON.stringify(spread));
    assert.equal(single, 'auto');
  });
  await page.waitForTimeout(600); // let the debounced progress save land
  await app.close();
}

// --- Reopen: progress restored to chapter 2 ----------------------------------------------------
{
  const { app, page } = await launch('hostile.epub');
  await bookFrame(page, 'escape.xhtml');
  const frame = page.frames().find((f) => f.url().includes('escape.xhtml'));
  await frame.waitForFunction(() => window.__escape && Object.keys(window.__escape).length >= 9, null, { timeout: 15000 });
  const escape = await frame.evaluate(() => window.__escape);
  results.push(`INFO escape attempts: ${JSON.stringify(escape)}`);
  check('hostile book is contained', () => {
    for (const [name, blocked] of Object.entries(escape)) assert.ok(blocked, `${name} was allowed`);
  });
  check('app survived hostile book', () => assert.ok(page.url().startsWith('app://reader/')));
  await page.screenshot({ path: path.join(shots, '5-hostile.png') });

  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.locator('.book-card').nth(1).waitFor();
  await page.screenshot({ path: path.join(shots, '6-library.png') });
  await page.locator('.book-open[title="Modern Web Sample"]').click();
  const restored = await bookFrame(page, 'interactive.xhtml');
  check('progress restored on reopen', () => assert.ok(restored));
  await app.close();
}

// --- FB2 and CBZ ---------------------------------------------------------------------------------
{
  const { app, page } = await launch('sample.fb2');
  const frame = await bookFrame(page, 'ch001.xhtml');
  const text = await frame.evaluate(() => document.body.innerText.slice(0, 40));
  check('FB2 renders', () => assert.match(text, /Chapter 1/));
  await page.screenshot({ path: path.join(shots, '7-fb2.png') });

  const fontScale = () => frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ereader-font-scale').trim());
  await frame.evaluate(touch, [[[330, 400], [430, 400]], [[310, 400], [450, 400]]]);
  await page.waitForTimeout(400);
  const pinched = await fontScale();
  await frame.evaluate(touch, [[[310, 400], [450, 400]], [[330, 400], [430, 400]]]);
  await page.waitForTimeout(400);
  const unpinched = await fontScale();
  check('pinch changes the font size', () => assert.deepEqual([pinched, unpinched], ['1.1', '1']));
  await frame.evaluate(touch, [[[500, 600]], [[500, 300]]]);
  await page.waitForTimeout(400);
  const swiped = await page.locator('.reader-numbers').textContent();
  check('swiping up turns the page', () => assert.match(swiped, /^Page 2 of/));

  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('button', { name: 'Scroll' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.waitForTimeout(400);
  await frame.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight));
  await page.waitForTimeout(600);
  await page.mouse.move(500, 380);
  await page.mouse.wheel(0, 100);
  const next = await frameWithText(page, 'A line of verse');
  check('scrolled: wheel past the end of a chapter opens the next', () => assert.ok(next));
  await page.waitForTimeout(600);
  await page.mouse.wheel(0, -100);
  const previous = await frameWithText(page, 'An epigraph.');
  const atEnd = await previous.evaluate(() => scrollY + innerHeight >= document.scrollingElement.scrollHeight - 2);
  check('scrolled: wheel up at the start opens the previous chapter at its end', () => assert.ok(atEnd));
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.waitForTimeout(600);
  await app.close();
}
{
  const { app, page } = await launch('sample.cbz');
  await bookFrame(page, '0001.xhtml');
  await page.keyboard.press('ArrowRight');
  const frame = await bookFrame(page, '0002.xhtml');
  check('CBZ renders and turns pages', () => assert.ok(frame));
  const fixedView = () =>
    frame.evaluate(() => {
      const style = document.documentElement.style;
      return { zoom: Number(document.documentElement.dataset.ereaderZoom ?? 1), x: parseFloat(style.getPropertyValue('--ereader-fixed-x')) };
    });
  await frame.evaluate(touch, [[[400, 300], [500, 300]], [[300, 300], [600, 300]]]);
  await page.waitForTimeout(400);
  const pinchedIn = await fixedView();
  await frame.evaluate(touch, [[[500, 300]], [[350, 310]]]);
  await page.waitForTimeout(400);
  const dragged = await fixedView();
  check('pinch zooms a comic page, one finger pans it', () => {
    assert.ok(Math.abs(pinchedIn.zoom - 3) < 0.05, String(pinchedIn.zoom));
    assert.ok(dragged.x < pinchedIn.x - 100, `${pinchedIn.x} -> ${dragged.x}`);
    assert.match(frame.url(), /0002\.xhtml$/);
  });
  await frame.evaluate(touch, [[[300, 300], [600, 300]], [[400, 300], [500, 300]]]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, '8-cbz.png') });
  const title = await page.locator('.reader-title').textContent();
  check('ComicInfo title used', () => assert.equal(title, 'Sample Comic #1'));
  await app.close();
}

// --- MOBI, AZW3 and DjVu --------------------------------------------------------------------------

/** The book frame whose text contains `text` (Kindle books are split into parts with generated names). */
async function frameWithText(page, text) {
  for (let i = 0; i < 100; i++) {
    for (const frame of page.frames().filter((f) => f.url().startsWith('book://'))) {
      const found = await frame
        .evaluate((t) => !document.documentElement.classList.contains('ereader-pending') && document.body.innerText.includes(t), text)
        .catch(() => false);
      if (found) return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`No book frame shows "${text}"; frames: ${page.frames().map((f) => f.url()).join(', ')}`);
}

{
  const { app, page } = await launch('sample.mobi');
  await frameWithText(page, 'Chapter One');
  const title = await page.locator('.reader-title').textContent();
  check('MOBI renders with its metadata', () => assert.equal(title, 'Kindle Sample'));
  await page.screenshot({ path: path.join(shots, '9-mobi.png') });
  await page.getByRole('button', { name: 'Contents' }).click();
  await page.getByRole('button', { name: 'Chapter Two' }).click();
  const chapter2 = await frameWithText(page, 'The note.');
  check('MOBI TOC navigates between parts', () => assert.match(chapter2.url(), /\/text\/part\d{4}\.html$/));
  await app.close();
}
{
  const { app, page } = await launch('sample.azw3');
  const chapter1 = await frameWithText(page, 'See the note');
  const image = await chapter1.evaluate(async () => {
    const img = document.querySelector('img');
    await img.decode();
    return img.naturalWidth;
  });
  check('AZW3 images load', () => assert.equal(image, 200));
  const linked = await chapter1.evaluate(() => getComputedStyle(document.querySelector('h1')).textAlign);
  check('AZW3 stylesheets apply', () => assert.equal(linked, 'center'));
  await page.screenshot({ path: path.join(shots, '10-azw3.png') });
  // The iframe (and its Playwright frame) is reused across documents, so remember the URL first.
  const chapter1Url = chapter1.url();
  await chapter1.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent === '[1]').click());
  const notes = await frameWithText(page, 'The note.');
  check('AZW3 footnote link opens the note', () => assert.notEqual(notes.url(), chapter1Url));
  await app.close();
}
{
  const { app, page } = await launch('sample.djvu');
  const pixel = async (file) => {
    const frame = await bookFrame(page, file);
    await frame.waitForFunction(() => document.documentElement.dataset.djvuDecoder, null, { timeout: 15000 });
    return frame.evaluate(() => ({
      color: [...document.querySelector('canvas').getContext('2d').getImageData(2, 2, 1, 1).data.slice(0, 3)],
      decoder: document.documentElement.dataset.djvuDecoder,
      fixed: document.documentElement.classList.contains('ereader-fixed-scaled'),
    }));
  };
  const near = (actual, expected) => actual.every((v, i) => Math.abs(v - expected[i]) < 24);
  const first = await pixel('0001.html');
  results.push(`INFO DjVu page 1: ${JSON.stringify(first)}`);
  check('DjVu page renders in a worker, in fixed layout', () => {
    assert.ok(near(first.color, [200, 40, 40]), JSON.stringify(first.color));
    assert.equal(first.decoder, 'worker');
    assert.ok(first.fixed);
  });
  await page.screenshot({ path: path.join(shots, '11-djvu.png') });
  await page.keyboard.press('ArrowRight');
  const second = await pixel('0002.html');
  check('DjVu turns pages', () => assert.ok(near(second.color, [40, 160, 60]), JSON.stringify(second.color)));
  await page.getByRole('button', { name: 'Contents' }).click();
  await page.getByRole('button', { name: 'Blue page' }).click();
  const third = await pixel('0003.html');
  check('DjVu outline navigates', () => assert.ok(near(third.color, [40, 70, 200]), JSON.stringify(third.color)));

  // The window is landscape, so two pages show pages 1–2 side by side, then page 3 alone.
  const twoPages = async () => {
    await page.getByRole('button', { name: 'Display settings' }).click();
    await page.getByRole('switch', { name: /Two pages in landscape/ }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();
  };
  await twoPages();
  await page.keyboard.press('Home');
  const djvuSpreadFrame = await bookFrame(page, '0001.html');
  await djvuSpreadFrame.waitForFunction(() => document.querySelector('[data-ereader-part="1"] canvas')?.width > 1, null, { timeout: 15000 });
  const djvuSpread = await djvuSpreadFrame.evaluate(() => {
    const sheets = [...document.querySelectorAll('.djvu-sheet')];
    const color = (sheet) => [...sheet.querySelector('canvas').getContext('2d').getImageData(2, 2, 1, 1).data.slice(0, 3)];
    return {
      colors: sheets.map(color),
      left: sheets.map((sheet) => sheet.getBoundingClientRect().left),
      width: document.documentElement.getBoundingClientRect().width,
      screen: innerWidth,
    };
  });
  await page.screenshot({ path: path.join(shots, '11b-djvu-two-pages.png') });
  check('DjVu two-page view shows the next page beside the first, fitted to the window', () => {
    assert.ok(near(djvuSpread.colors[0], [200, 40, 40]) && near(djvuSpread.colors[1], [40, 160, 60]), JSON.stringify(djvuSpread.colors));
    assert.ok(djvuSpread.left[1] > djvuSpread.left[0], JSON.stringify(djvuSpread.left));
    assert.ok(djvuSpread.width <= djvuSpread.screen + 1, JSON.stringify(djvuSpread));
  });
  await page.getByRole('button', { name: 'Next page' }).click();
  const djvuLast = await bookFrame(page, '0003.html');
  await djvuLast.waitForFunction(() => document.documentElement.dataset.djvuDecoder, null, { timeout: 15000 });
  const djvuLastSheets = await djvuLast.evaluate(() => document.querySelectorAll('.djvu-sheet').length);
  check('DjVu two-page view turns two pages at a time, the last page alone', () => assert.equal(djvuLastSheets, 1));
  await twoPages();

  await page.getByRole('button', { name: 'Back to library' }).click();
  const cover = page.locator('.book-open[title="sample"] img');
  await cover.waitFor();
  const coverWidth = await cover.evaluate(async (img) => (await img.decode(), img.naturalWidth));
  check('DjVu cover rendered at import', () => assert.ok(coverWidth > 0));
  await page.screenshot({ path: path.join(shots, '12-library-new-formats.png') });
  await app.close();
}

{
  const { app, page } = await launch('sample.pdf');
  const render = async (file) => {
    const frame = await bookFrame(page, file);
    await frame.waitForFunction(() => document.documentElement.dataset.pdfRendered, null, { timeout: 15000 });
    await frame.waitForFunction(() => document.querySelector('.textLayer')?.textContent);
    return {
      frame,
      color: await frame.evaluate(() => [...document.querySelector('canvas').getContext('2d').getImageData(2, 2, 1, 1).data.slice(0, 3)]),
      text: await frame.evaluate(() => document.querySelector('.textLayer').textContent),
    };
  };
  const near = (actual, expected) => actual.every((v, i) => Math.abs(v - expected[i]) < 24);
  const first = await render('0001.html');
  check('PDF page renders with its text layer', () => {
    assert.ok(near(first.color, [200, 40, 40]), JSON.stringify(first.color));
    assert.match(first.text, /Page One/);
  });
  const title = await page.locator('.reader-title').textContent();
  check('PDF title from metadata', () => assert.equal(title, 'PDF Sample'));
  await page.keyboard.press(' ');
  await first.frame.focus('body');
  await page.keyboard.press(' ');
  await page.waitForTimeout(500);
  const afterSpace = page.frames().filter((f) => f.url().startsWith('book://')).map((f) => f.url().split('/').pop());
  check('Space does not turn the page, from the app or the page', () => assert.deepEqual(afterSpace, ['0001.html']));
  await page.screenshot({ path: path.join(shots, '13-pdf.png') });
  const links = await first.frame.evaluate(() => [...document.querySelectorAll('.pdf-links a')].map((a) => a.getAttribute('href')));
  check('PDF link annotations become links', () => assert.deepEqual(links.sort(), ['0003.html', 'https://example.com/']));
  await first.frame.evaluate(() => document.querySelector('.pdf-links a[href="0003.html"]').click());
  const third = await render('0003.html');
  check('PDF internal link opens its page', () => assert.ok(near(third.color, [40, 70, 200]), JSON.stringify(third.color)));
  await page.getByRole('button', { name: 'Contents' }).click();
  await page.getByRole('button', { name: 'Part two' }).click();
  const second = await render('0002.html');
  check('PDF outline navigates', () => assert.ok(near(second.color, [40, 160, 60]), JSON.stringify(second.color)));

  const view = (frame) =>
    frame.evaluate(() => ({
      zoom: Number(document.documentElement.dataset.ereaderZoom ?? 1),
      y: parseFloat(document.documentElement.style.getPropertyValue('--ereader-fixed-y')),
      canvas: document.querySelector('canvas').width,
    }));
  await page.mouse.move(500, 380);
  const unzoomed = await view(second.frame);
  await page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(800);
  const zoomed = await view(second.frame);
  results.push(`INFO PDF zoom: ${JSON.stringify({ unzoomed, zoomed })}`);
  check('Ctrl+wheel zooms a PDF page and re-renders it sharper', () => {
    assert.ok(zoomed.zoom > 2.5, String(zoomed.zoom));
    assert.ok(zoomed.canvas > unzoomed.canvas * 2, `${unzoomed.canvas} -> ${zoomed.canvas}`);
  });
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(300);
  const panned = await view(second.frame);
  check('wheel scrolls a zoomed page instead of turning it', () => {
    assert.match(second.frame.url(), /0002\.html$/);
    assert.ok(panned.y < zoomed.y, `${zoomed.y} -> ${panned.y}`);
  });
  const cursor = () => second.frame.evaluate(() => getComputedStyle(document.body).cursor);
  await page.keyboard.down(' ');
  await page.waitForTimeout(200);
  const handCursor = await cursor();
  await page.mouse.down();
  await page.mouse.move(450, 460, { steps: 5 });
  const grabbingCursor = await cursor();
  await page.mouse.up();
  await page.keyboard.up(' ');
  await page.waitForTimeout(200);
  const dragged = await view(second.frame);
  const releasedCursor = await cursor();
  check('holding Space shows a hand that drags the zoomed page, without turning it', () => {
    assert.deepEqual([handCursor, grabbingCursor, releasedCursor], ['grab', 'grabbing', 'auto']);
    assert.ok(dragged.y > panned.y + 50, `${panned.y} -> ${dragged.y}`);
    assert.match(second.frame.url(), /0002\.html$/);
  });
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(600);
  await page.mouse.wheel(0, 100);
  const nextPage = await render('0003.html');
  const nextView = await view(nextPage.frame);
  check('wheel at the bottom of a zoomed page turns to the next, still zoomed, at its top', () => {
    assert.equal(nextView.zoom, zoomed.zoom);
    assert.ok(Math.abs(nextView.y) < 1, String(nextView.y));
  });
  await page.waitForTimeout(600);
  await page.mouse.wheel(0, -100);
  const backPage = await render('0002.html');
  await backPage.frame.waitForFunction(() => document.documentElement.dataset.ereaderZoom);
  const backView = await view(backPage.frame);
  check('wheel up at the top goes to the previous page at its bottom', () => assert.ok(backView.y < -100, String(backView.y)));
  await page.screenshot({ path: path.join(shots, '13b-pdf-zoomed.png') });
  await page.keyboard.down('Control');
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const fitted = await view(backPage.frame);
  check('Ctrl+wheel zooms back out to the whole page', () => assert.equal(fitted.zoom, 1));

  await page.getByRole('button', { name: 'Search in book' }).click();
  await page.getByRole('searchbox', { name: 'Search in book' }).fill('page three');
  await page.locator('.search-hit').nth(1).waitFor();
  const pdfSections = await page.locator('.search-section').allTextContents();
  await page.locator('.search-hit').nth(1).click();
  const pageThree = await render('0003.html');
  await pageThree.frame.waitForFunction(() => CSS.highlights.get('ereader-search')?.size === 1, null, { timeout: 15000 });
  const pdfMatch = await pageThree.frame.evaluate(() => [...CSS.highlights.get('ereader-search')][0].toString());
  check('PDF search finds text on its pages and highlights it in the text layer', () => {
    assert.deepEqual(pdfSections, ['Page 1', 'Page 3']);
    assert.equal(pdfMatch, 'Page Three');
  });
  await page.getByRole('button', { name: 'Close search' }).click();

  // The window is landscape, so the setting shows pages 1–2 side by side, then page 3 alone.
  const twoPages = async () => {
    await page.getByRole('button', { name: 'Display settings' }).click();
    await page.getByRole('switch', { name: /Two pages in landscape/ }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();
  };
  await twoPages();
  await page.keyboard.press('Home');
  const spreadFrame = await bookFrame(page, '0001.html');
  await spreadFrame.waitForFunction(() => document.querySelector('[data-ereader-part="1"] .textLayer')?.textContent, null, { timeout: 15000 });
  const pdfSpread = await spreadFrame.evaluate(() => {
    const sheets = [...document.querySelectorAll('.pdf-sheet')];
    const color = (sheet) => [...sheet.querySelector('canvas').getContext('2d').getImageData(2, 2, 1, 1).data.slice(0, 3)];
    return {
      colors: sheets.map(color),
      left: sheets.map((sheet) => sheet.getBoundingClientRect().left),
      text: sheets[1].querySelector('.textLayer').textContent,
      width: document.documentElement.getBoundingClientRect().width,
      screen: innerWidth,
    };
  });
  await page.screenshot({ path: path.join(shots, '13c-pdf-two-pages.png') });
  check('PDF two-page view shows the next page beside the first, fitted to the window', () => {
    assert.ok(near(pdfSpread.colors[0], [200, 40, 40]) && near(pdfSpread.colors[1], [40, 160, 60]), JSON.stringify(pdfSpread.colors));
    assert.ok(pdfSpread.left[1] > pdfSpread.left[0], JSON.stringify(pdfSpread.left));
    assert.match(pdfSpread.text, /Page Two/);
    assert.ok(pdfSpread.width <= pdfSpread.screen + 1, JSON.stringify(pdfSpread));
  });
  await page.getByRole('button', { name: 'Search in book' }).click();
  await page.getByRole('searchbox', { name: 'Search in book' }).fill('page two');
  await page.locator('.search-hit').first().waitFor();
  await page.locator('.search-hit').first().click();
  await spreadFrame.waitForFunction(() => CSS.highlights.get('ereader-search')?.size === 1, null, { timeout: 15000 });
  const spreadMatch = await spreadFrame.evaluate(() => {
    const range = [...CSS.highlights.get('ereader-search')][0];
    return { text: range.toString(), part: range.startContainer.parentElement.closest('[data-ereader-part]').dataset.ereaderPart };
  });
  check('PDF search on the second page of a spread highlights it there', () => assert.deepEqual(spreadMatch, { text: 'Page Two', part: '1' }));
  await page.getByRole('button', { name: 'Close search' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  const lastSpread = await bookFrame(page, '0003.html');
  await lastSpread.waitForFunction(() => document.documentElement.dataset.pdfRendered);
  const lastSheets = await lastSpread.evaluate(() => document.querySelectorAll('.pdf-sheet').length);
  check('PDF two-page view turns two pages at a time, the last page alone', () => assert.equal(lastSheets, 1));

  // Cover alone: page 1 by itself in the middle, as large as the pages of a pair, then pages 2–3.
  const coverAlone = async () => {
    await page.getByRole('button', { name: 'Display settings' }).click();
    await page.getByRole('switch', { name: /Cover alone/ }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();
  };
  await coverAlone();
  const pairFrame = await bookFrame(page, '0002.html');
  await pairFrame.waitForFunction(() => document.querySelector('[data-ereader-part="1"] .textLayer')?.textContent, null, { timeout: 15000 });
  const pair = await pairFrame.evaluate(() => ({
    text: [...document.querySelectorAll('.textLayer')].map((layer) => layer.textContent.trim()),
    width: document.querySelector('.pdf-sheet').getBoundingClientRect().width,
  }));
  await page.keyboard.press('Home');
  const coverFrame = await bookFrame(page, '0001.html');
  await coverFrame.waitForFunction(() => document.documentElement.dataset.pdfRendered);
  const coverView = await coverFrame.evaluate(() => {
    const rect = document.querySelector('.pdf-sheet').getBoundingClientRect();
    return { sheets: document.querySelectorAll('.pdf-sheet').length, center: rect.left + rect.width / 2, width: rect.width, screenCenter: innerWidth / 2 };
  });
  await page.screenshot({ path: path.join(shots, '13d-pdf-cover-alone.png') });
  check('PDF cover alone: page 1 by itself in the middle, as large as a page of a pair, then pages 2–3 together', () => {
    assert.deepEqual(pair.text, ['Page Two', 'Page Three']);
    assert.equal(coverView.sheets, 1);
    assert.ok(Math.abs(coverView.center - coverView.screenCenter) < 1, JSON.stringify(coverView));
    assert.ok(Math.abs(coverView.width - pair.width) < 1, JSON.stringify({ coverView, pair }));
  });
  await coverAlone();
  await twoPages();

  await page.getByRole('button', { name: 'Back to library' }).click();
  const cover = page.locator('.book-open[title="PDF Sample"] img');
  await cover.waitFor();
  const coverWidth = await cover.evaluate(async (img) => (await img.decode(), img.naturalWidth));
  check('PDF cover rendered at import', () => assert.ok(coverWidth > 0));
  await page.getByRole('button', { name: 'Show as shelf' }).click();
  const tileStatus = await page.locator('.shelf-tile:has(.book-open[title="PDF Sample"]) .tile-status').textContent();
  check('shelf tiles show the file format under the cover', () => assert.equal(tileStatus, 'PDF'));
  await page.screenshot({ path: path.join(shots, '13e-shelf-formats.png') });
  await page.getByRole('button', { name: 'Show as cards' }).click();
  const cards = await page.locator('.card-list').count();
  check('the top bar button switches between shelf and cards', () => assert.equal(cards, 1));
  await page.screenshot({ path: path.join(shots, '13f-cards.png') });
  await app.close();
}
{
  const { app, page } = await launch('sample.chm');
  const index = await frameWithText(page, 'Добро пожаловать');
  const title = await page.locator('.reader-title').textContent();
  check('CHM opens with its code-page title', () => assert.equal(title, 'Пример справки'));
  const pageState = await index.evaluate(async () => {
    const img = document.querySelector('img');
    await img.decode();
    return { image: img.naturalWidth, heading: getComputedStyle(document.querySelector('h1')).color };
  });
  check('CHM images and styles load through fixed-up links', () => assert.deepEqual(pageState, { image: 120, heading: 'rgb(139, 26, 26)' }));
  await page.screenshot({ path: path.join(shots, '14-chm.png') });
  await index.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent === 'Глава первая').click());
  const chapter = await frameWithText(page, 'Текст первой главы');
  const scripted = await chapter.evaluate(() => window.__chmScript === true);
  check('CHM case-insensitive link works and page scripts run', () => assert.ok(scripted));
  await page.getByRole('button', { name: 'Contents' }).click();
  await page.getByRole('button', { name: 'Глава вторая & часть два' }).click();
  await frameWithText(page, 'Часть два.');
  check('CHM sitemap TOC navigates', () => assert.ok(true));
  await app.close();
}
{
  const { app, page } = await launch('sample.lit');
  const chapter1 = await frameWithText(page, 'See the note');
  const image = await chapter1.evaluate(async () => {
    const img = document.querySelector('img');
    await img.decode();
    return img.naturalWidth;
  });
  check('LIT (sealed) opens, with images', () => assert.equal(image, 200));
  await page.screenshot({ path: path.join(shots, '15-lit.png') });
  await page.getByRole('button', { name: 'Contents' }).click();
  await page.getByRole('button', { name: 'Chapter Two' }).click();
  await frameWithText(page, 'The note.');
  check('LIT TOC navigates', () => assert.ok(true));
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.locator('.book-card').first().waitFor();
  await page.screenshot({ path: path.join(shots, '16-library-all-formats.png') });

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Series' }).click();
  const seriesRows = await page.locator('.group-row').allTextContents();
  await page.locator('.group-row', { hasText: 'eReaderPlus Samples' }).click();
  const inSeries = await page.locator('.book-open').evaluateAll((els) => els.map((el) => el.getAttribute('title')));
  check('series from EPUB 3, FB2 and ComicInfo metadata, books in series order', () => {
    assert.deepEqual(seriesRows, ['eReaderPlus Samples2', 'Sample Comic1']);
    assert.deepEqual(inSeries, ['Modern Web Sample', 'FictionBook Sample']);
  });
  await page.screenshot({ path: path.join(shots, '17-series.png') });

  const titles = () => page.locator('.book-open').evaluateAll((els) => els.map((el) => el.getAttribute('title')));
  await page.getByRole('button', { name: 'Back' }).click(); // Out of the series, back to the list of series.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Formats' }).click();
  const formatRows = await page.getByRole('checkbox').count();
  await page.getByRole('checkbox', { name: /^EPUB,/ }).click();
  await page.screenshot({ path: path.join(shots, '17b-formats.png') });
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Books' }).click();
  await page.locator('.book-card').first().waitFor();
  const withoutEpub = await titles();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Formats' }).click();
  await page.getByRole('checkbox', { name: 'All formats' }).click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Books' }).click();
  await page.locator('.book-card').first().waitFor();
  const allAgain = await titles();
  check('Formats lists every format, and the formats ticked there apply to the shelves', () => {
    assert.equal(formatRows, 10); // "All formats" and the nine formats.
    assert.ok(!withoutEpub.includes('Modern Web Sample') && withoutEpub.includes('PDF Sample'), JSON.stringify(withoutEpub));
    assert.ok(allAgain.includes('Modern Web Sample'), JSON.stringify(allAgain));
  });
  await app.close();
}

// --- Watched folders: the in-app folder browser, then scans, on an empty library -------------------
{
  const folderData = await mkdtemp(path.join(tmpdir(), 'ereader-folders-'));
  const watched = path.join(folderData, 'Books');
  await mkdir(path.join(watched, 'Series'), { recursive: true });
  await copyFile(path.resolve('samples', 'modern-web.epub'), path.join(watched, 'modern-web.epub'));
  await copyFile(path.resolve('samples', 'sample.fb2'), path.join(watched, 'Series', 'sample.fb2'));
  await writeFile(path.join(watched, 'notes.txt'), 'Not a book.');
  const app = await electron.launch({ args: ['.'], env: { ...process.env, EREADER_USER_DATA: path.join(folderData, 'data') }, colorScheme: null });
  const page = await app.firstWindow();
  page.on('console', (m) => m.type() === 'error' && results.push(`INFO [folders console] ${m.text()}`));
  await page.setViewportSize({ width: 1000, height: 760 }).catch(() => {});

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Settings' }).click();
  await page.getByRole('button', { name: /Add folder/ }).click();
  // Down from the storage roots one folder at a time, starting at the deepest root that holds the folder.
  const chain = [];
  for (let p = watched; ; p = path.dirname(p)) {
    chain.unshift(p);
    if (path.dirname(p) === p) break;
  }
  const row = (p) => page.locator(`.folder-row[title="${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
  await page.locator('.folder-row').first().waitFor();
  let step = chain.length - 1;
  while (step > 0 && (await row(chain[step]).count()) === 0) step--;
  for (; step < chain.length; step++) {
    await row(chain[step]).click();
    await page.locator('.app-bar-subtitle', { hasText: chain[step] }).waitFor();
  }
  const hereCount = await page.locator('.picker-count').textContent();
  await page.screenshot({ path: path.join(shots, '18-folder-picker.png') });
  await page.getByRole('button', { name: 'Use this folder' }).click();
  const lastScan = page.locator('.settings-description', { hasText: 'Last scan' });
  await lastScan.waitFor({ timeout: 30000 });
  const firstScan = await lastScan.textContent();
  const listed = await page.locator('.watched-folder .settings-description').allTextContents();
  await page.screenshot({ path: path.join(shots, '19-folder-settings.png') });
  await page.getByRole('button', { name: 'Scan now' }).click();
  await page.locator('.settings-description', { hasText: '0 new' }).waitFor({ timeout: 30000 });
  const secondScan = await lastScan.textContent();

  await page.getByRole('button', { name: 'Back' }).click();
  const readingNow = await page.locator('.book-card').count();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Books' }).click();
  await page.locator('.book-card').nth(1).waitFor();
  const allBooks = await page.locator('.book-open').evaluateAll((els) => els.map((el) => el.getAttribute('title')).sort());
  check('folder browser walks down to a folder and shows its book files', () => assert.equal(hereCount, '1 book file here'));
  check('watched folder scan imports books (subfolders too) once, and skips other files', () => {
    assert.deepEqual(listed, [watched]);
    assert.equal(firstScan, 'Last scan: 2 book files in your folders, 2 new');
    assert.equal(secondScan, 'Last scan: 2 book files in your folders, 0 new');
    assert.deepEqual(allBooks, ['FictionBook Sample', 'Modern Web Sample']);
  });
  check('books found by a scan wait under Books, not in Reading now', () => assert.equal(readingNow, 0));

  // Folders: browse the device to a book file and open it.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Folders' }).click();
  await page.locator('.folder-row').first().waitFor();
  step = chain.length - 1;
  while (step > 0 && (await row(chain[step]).count()) === 0) step--;
  for (; step < chain.length; step++) {
    await row(chain[step]).click();
    await page.locator('.shelf-subtitle', { hasText: chain[step] }).waitFor();
  }
  const epubPath = path.join(watched, 'modern-web.epub');
  const fileRow = page.locator(`.file-row[title="${epubPath.replace(/\\/g, '\\\\')}"]`);
  await fileRow.waitFor();
  const folderView = {
    folders: await page.locator('.folder-row:not(.file-row):not(.folder-up) .folder-name').allTextContents(),
    up: await page.locator('.folder-up').getAttribute('title'),
    files: await page.locator('.file-row .folder-name').allTextContents(),
    meta: await fileRow.locator('.file-meta').textContent(),
  };
  await page.screenshot({ path: path.join(shots, '20-folders.png') });
  await fileRow.click();
  await page.locator('.reader-title').waitFor();
  const opened = await page.locator('.reader-title').textContent();
  await page.getByRole('button', { name: 'Back to library' }).click();
  const backIn = await page.locator('.shelf-subtitle').textContent();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.drawer-item', { hasText: 'Books' }).click();
  await page.locator('.book-card').nth(1).waitFor();
  const booksAfter = await page.locator('.book-card').count();
  check('Folders browses to book files and opens one, using the copy already in the library', () => {
    assert.deepEqual(folderView.folders, ['Series']);
    assert.equal(folderView.up, folderData);
    assert.deepEqual(folderView.files, ['modern-web.epub']);
    assert.match(folderView.meta, /KB · in library/);
    assert.equal(opened, 'Modern Web Sample');
    assert.equal(backIn, watched);
    assert.equal(booksAfter, 2);
  });
  await app.close();
  await rm(folderData, { recursive: true, force: true });
}


await rm(userData, { recursive: true, force: true });
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
