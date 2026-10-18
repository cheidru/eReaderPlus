// Generates sample books into samples/ for manual and end-to-end testing:
//   modern-web.epub  — scripted EPUB 3 using recent HTML/CSS/JS features
//   hostile.epub     — a book whose scripts try to escape the sandbox
//   sample.fb2       — FictionBook 2 with notes
//   sample.cbz       — comic archive with generated PNG pages
//   sample.md        — Markdown with front matter, a table, code, and an image beside it (md-images/)
//   sample.mobi, .azw3, .djvu, .pdf, .chm, .lit — copies of test/fixtures/books/ (see scripts/make-test-fixtures.mjs)
import { strToU8, zipSync } from 'fflate';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const out = 'samples';
await mkdir(out, { recursive: true });

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function epub({ id, title, chapters, metadata = '' }) {
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
  };
  const manifest = chapters
    .map((c, i) => `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml" properties="scripted"/>`)
    .join('\n    ');
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('');
  const navItems = chapters.map((c) => `<li><a href="${c.file}">${c.title}</a></li>`).join('');
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>eReaderPlus samples</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    ${metadata}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifest}
  </manifest>
  <spine>${spine}</spine>
</package>`);
  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><h1>Contents</h1><ol>${navItems}</ol></nav></body></html>`);
  for (const c of chapters) files[`OEBPS/${c.file}`] = strToU8(c.html);
  return zipSync(files);
}

const xhtml = (title, head, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><meta charset="utf-8"/><title>${title}</title>${head}</head>
<body>${body}</body></html>`;

const lorem =
  'Reading on the open web platform means a book can use everything a browser can do. ' +
  'This paragraph exists to fill pages so that pagination, page counts and progress can be tested. ';
const paragraphs = (n, prefix) =>
  Array.from({ length: n }, (_, i) => `<p id="${prefix}-${i + 1}">${i + 1}. ${lorem.repeat(3)}</p>`).join('\n');

const modernChapter = xhtml(
  'Modern CSS',
  `<style>
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(8em, 1fr)); gap: 0.5em; }
    .card { container-type: inline-size; border: 2px solid #888; padding: 0.5em; border-radius: 8px; }
    .card:has(.badge) { border-color: rebeccapurple; }
    @container (min-width: 6em) { .card p { color: color-mix(in oklch, rebeccapurple 70%, currentColor); } }
    .nest { &amp; strong { text-decoration: underline wavy; } }
    .feature { font-family: system-ui; }
    .ok { color: green; } .fail { color: crimson; }
  </style>`,
  `<h1>Modern web features</h1>
  <ul id="features" class="feature"></ul>
  <div class="grid">
    <div class="card"><span class="badge">:has()</span><p>Container query + color-mix</p></div>
    <div class="card"><p class="nest">CSS <strong>nesting</strong></p></div>
  </div>
  <p><button id="vt" type="button">Run a View Transition</button> <span id="vt-out"></span></p>
  <script>
    const checks = {
      ':has()': CSS.supports('selector(:has(a))'),
      'Container queries': CSS.supports('container-type: inline-size'),
      'CSS nesting': CSS.supports('selector(&amp;)'),
      'Anchor positioning': CSS.supports('anchor-name: --a'),
      '@scope': typeof CSSScopeRule !== 'undefined',
      'View Transitions': typeof document.startViewTransition === 'function',
      'Secure context (crypto.subtle)': !!(window.isSecureContext &amp;&amp; crypto.subtle),
      'Popover API': HTMLElement.prototype.hasOwnProperty('popover'),
      'Navigation API': 'navigation' in window,
    };
    const list = document.getElementById('features');
    for (const [name, ok] of Object.entries(checks)) {
      const li = document.createElement('li');
      li.className = ok ? 'ok' : 'fail';
      li.textContent = (ok ? '✓ ' : '✗ ') + name;
      list.append(li);
    }
    window.__featureChecks = checks;
    document.getElementById('vt').addEventListener('click', () => {
      document.startViewTransition(() => { document.getElementById('vt-out').textContent = 'transitioned at ' + new Date().toLocaleTimeString(); });
    });
    crypto.subtle.digest('SHA-256', new TextEncoder().encode('ebook')).then((d) => {
      window.__digest = Array.from(new Uint8Array(d)).slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
    });
  </script>
  <h2 id="long">Long text</h2>
  ${paragraphs(40, 'p')}`,
);

const scriptedChapter = xhtml(
  'Interactive',
  `<style>canvas { width: 100%; max-width: 30em; aspect-ratio: 2; border: 1px solid #888; }</style>`,
  `<h1 id="top">Interactive chapter</h1>
  <p>This chapter animates a canvas and keeps a counter in the book's own localStorage.</p>
  <canvas id="c" width="600" height="300"></canvas>
  <p><button id="count" type="button">Clicked <span id="n">0</span> times</button></p>
  <script type="module">
    const key = 'counter';
    const n = document.getElementById('n');
    n.textContent = localStorage.getItem(key) ?? '0';
    document.getElementById('count').addEventListener('click', () => {
      const v = Number(localStorage.getItem(key) ?? 0) + 1;
      localStorage.setItem(key, String(v));
      n.textContent = String(v);
    });
    const ctx = document.getElementById('c').getContext('2d');
    let t = 0;
    (function frame() {
      t += 0.02;
      ctx.clearRect(0, 0, 600, 300);
      for (let i = 0; i &lt; 12; i++) {
        ctx.fillStyle = 'hsl(' + (i * 30 + t * 50) + ' 70% 55%)';
        ctx.beginPath();
        ctx.arc(300 + Math.cos(t + i) * 200, 150 + Math.sin(t * 1.3 + i) * 100, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    })();
    window.__moduleRan = true;
  </script>
  ${paragraphs(10, 'q')}`,
);

await writeFile(
  `${out}/modern-web.epub`,
  epub({
    id: 'urn:uuid:7f1c2d3e-0000-4000-8000-000000000001',
    title: 'Modern Web Sample',
    metadata: `<meta property="belongs-to-collection" id="series">eReaderPlus Samples</meta>
    <meta refines="#series" property="collection-type">series</meta>
    <meta refines="#series" property="group-position">1</meta>`,
    chapters: [
      { file: 'modern.xhtml', title: 'Modern web features', html: modernChapter },
      { file: 'interactive.xhtml', title: 'Interactive chapter', html: scriptedChapter },
    ],
  }),
);

const hostileChapter = xhtml(
  'Escape attempts',
  '',
  `<h1>Sandbox escape attempts</h1><ul id="results"></ul>
  <script>
    const results = {};
    const list = document.getElementById('results');
    const record = (name, blocked, detail) => {
      results[name] = blocked;
      const li = document.createElement('li');
      li.textContent = (blocked ? 'BLOCKED ' : 'ALLOWED ') + name + (detail ? ' — ' + detail : '');
      list.append(li);
    };
    window.__escape = results;
    try { parent.document.body; record('parent.document', false); } catch (e) { record('parent.document', true, e.name); }
    try { record('require/process', typeof require === 'undefined' &amp;&amp; typeof process === 'undefined'); } catch (e) { record('require/process', true); }
    try { record('ereaderNative bridge', typeof window.ereaderNative === 'undefined' &amp;&amp; typeof parent.ereaderNative === 'undefined'); } catch (e) { record('ereaderNative bridge', true, e.name); }
    try { const w = window.open('https://example.com'); record('window.open', w === null); } catch (e) { record('window.open', true, e.name); }
    try { top.location.href = 'https://example.com'; record('top navigation', false); } catch (e) { record('top navigation', true, e.name); }
    fetch('https://example.com/').then(() => record('fetch remote', false), (e) => record('fetch remote', true, e.name));
    const img = new Image();
    img.onload = () => record('remote image', false);
    img.onerror = () => record('remote image', true);
    img.src = 'https://example.com/favicon.ico';
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia({ video: true }).then(() => record('camera', false), (e) => record('camera', true, e.name));
    } else { record('camera', true, 'no mediaDevices'); }
    fetch('/../../../Windows/win.ini').then((r) => record('path traversal', !r.ok, String(r.status)), () => record('path traversal', true));
  </script>`,
);

await writeFile(
  `${out}/hostile.epub`,
  epub({
    id: 'urn:uuid:7f1c2d3e-0000-4000-8000-000000000002',
    title: 'Hostile Sample',
    chapters: [{ file: 'escape.xhtml', title: 'Escape attempts', html: hostileChapter }],
  }),
);

await writeFile(
  `${out}/sample.fb2`,
  `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info><author><first-name>Sample</first-name><last-name>Author</last-name></author><book-title>FictionBook Sample</book-title><lang>en</lang><sequence name="eReaderPlus Samples" number="2"/></title-info>
    <document-info><id>fb2-sample-1</id></document-info>
  </description>
  <body>
    <section><title><p>Chapter 1</p></title><epigraph><p>An epigraph.</p><text-author>Someone</text-author></epigraph>
      <p>First chapter with a note<a l:href="#n1" type="note">[1]</a>.</p>${Array.from({ length: 30 }, () => `<p>${lorem}</p>`).join('')}</section>
    <section><title><p>Chapter 2</p></title><poem><stanza><v>A line of verse,</v><v>and another one.</v></stanza></poem>${Array.from({ length: 30 }, () => `<p>${lorem}</p>`).join('')}</section>
  </body>
  <body name="notes"><section id="n1"><title><p>1</p></title><p>The note text.</p></section></body>
</FictionBook>`,
);

function png(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const colors = [
  [220, 80, 60],
  [60, 140, 220],
  [80, 180, 90],
  [230, 180, 50],
];
const comic = {};
colors.forEach((c, i) => (comic[`pages/page${i + 1}.png`] = new Uint8Array(png(400, 600, c))));
comic['ComicInfo.xml'] = strToU8('<ComicInfo><Series>Sample Comic</Series><Number>1</Number><Writer>eReaderPlus</Writer></ComicInfo>');
await writeFile(`${out}/sample.cbz`, zipSync(comic));

await mkdir(`${out}/md-images`, { recursive: true });
await writeFile(`${out}/md-images/dot.png`, png(60, 40, [40, 120, 200]));
const fence = '```';
await writeFile(
  `${out}/sample.md`,
  `---
title: Markdown Sample
author: eReaderPlus
lang: en
---

# Markdown Sample

An image from beside the file: ![a blue dot](md-images/dot.png)

## Tables and code

| Format | Kind  |
|--------|-------|
| CBZ    | comic |
| MD     | text  |

${fence}js
console.log('code block');
${fence}

${lorem.repeat(12)}

## Second part

${lorem.repeat(30)}

- [x] done
- [ ] to do

See [the tables](#tables-and-code).
`,
);

for (const name of ['sample.mobi', 'sample.azw3', 'sample.djvu', 'sample.pdf', 'sample.chm', 'sample.lit']) await copyFile(`test/fixtures/books/${name}`, `${out}/${name}`);

console.log(`Sample books written to ${out}/`);
