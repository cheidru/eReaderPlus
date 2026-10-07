// Regenerates the binary book fixtures in test/fixtures/books/ (committed; unit tests and `npm run samples` use them):
//   sample.djvu        — 3 colored pages and a nested outline, encoded with the vendored DjVu.js
//   sample.mobi        — MOBI 6, converted by Calibre from a small EPUB with an image, a footnote link and a TOC
//   sample.azw3        — KF8 from the same EPUB
//   sample-combo.mobi  — combined MOBI 6 + KF8 file from the same EPUB
//   sample.lit         — Microsoft Reader LIT (sealed, as Calibre writes them) from the same EPUB
//   sample.pdf         — 3 colored pages with text, an outline, a page link and a web link (written by hand)
//   sample.chm         — uncompressed CHM in Windows-1251 Russian, with Windows-style links (written by hand)
// The Kindle and LIT files need Calibre's `ebook-convert` on PATH; the others need nothing.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';

const out = 'test/fixtures/books';
await mkdir(out, { recursive: true });

// --- DjVu -------------------------------------------------------------------------------------------

/** DjVu.js with its internal encoder classes exported, run in Node with the browser globals it needs. */
async function loadDjvuEncoder() {
  const source = (await readFile('vendor/djvujs/djvu.js', 'utf8')).replace(
    'var index = Object.assign({}, DjVu, {',
    'var index = Object.assign({}, DjVu, { IWImageWriter, BZZEncoder, ZPEncoder, ByteStreamWriter,',
  );
  class ImageData {
    constructor(data, width, height) {
      Object.assign(this, { data, width, height });
    }
  }
  // `document` keeps the library from starting its worker message loop.
  const context = vm.createContext({ ImageData, self: {}, document: {}, console, TextEncoder, TextDecoder });
  context.self = context;
  return { DjVu: vm.runInContext(`${source};DjVu`, context), ImageData };
}

/** A page: solid background with a white panel and a dark bar, so rendering can be checked by color. */
function pageImage(ImageData, width, height, [r, g, b]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const panel = x > width * 0.15 && x < width * 0.85 && y > height * 0.1 && y < height * 0.3;
      const bar = panel && y > height * 0.18 && y < height * 0.22 && x < width * 0.7;
      const [pr, pg, pb] = bar ? [30, 30, 30] : panel ? [255, 255, 255] : [r, g, b];
      data.set([pr, pg, pb, 255], i);
    }
  }
  return new ImageData(data, width, height);
}

function navmPayload(bookmarks) {
  const bytes = [];
  const u24 = (n) => bytes.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  let count = 0;
  const write = (b) => {
    count++;
    const children = b.children ?? [];
    const description = new TextEncoder().encode(b.description);
    const url = new TextEncoder().encode(b.url);
    bytes.push(children.length);
    u24(description.length);
    bytes.push(...description);
    u24(url.length);
    bytes.push(...url);
    children.forEach(write);
  };
  bookmarks.forEach(write);
  // DjVu.js's BZZ encoder drops the final byte (its own DIRM writer pads the same way).
  return new Uint8Array([(count >> 8) & 0xff, count & 0xff, ...bytes, 0]);
}

/** Inserts a NAVM (outline) chunk after DIRM, shifting the component offsets DIRM records. */
function withOutline(DjVu, file, bookmarks) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tag = (at) => String.fromCharCode(...file.subarray(at, at + 4));
  if (tag(12) !== 'DJVM' || tag(16) !== 'DIRM') throw new Error('Expected a bundled DjVu document');
  const dirmEnd = 24 + view.getUint32(20);
  const insertAt = dirmEnd + (dirmEnd & 1);

  const writer = new DjVu.ByteStreamWriter();
  new DjVu.BZZEncoder(new DjVu.ZPEncoder(writer)).encode(navmPayload(bookmarks).buffer);
  const compressed = new Uint8Array(writer.getBuffer());
  const chunk = new Uint8Array(8 + compressed.length + (compressed.length & 1));
  chunk.set(strToU8('NAVM'));
  new DataView(chunk.buffer).setUint32(4, compressed.length);
  chunk.set(compressed, 8);

  const result = new Uint8Array(file.length + chunk.length);
  result.set(file.subarray(0, insertAt));
  result.set(chunk, insertAt);
  result.set(file.subarray(insertAt), insertAt + chunk.length);
  const rv = new DataView(result.buffer);
  rv.setUint32(8, result.length - 12);
  const components = rv.getUint16(25);
  for (let i = 0; i < components; i++) rv.setUint32(27 + i * 4, rv.getUint32(27 + i * 4) + chunk.length);
  return result;
}

{
  const { DjVu, ImageData } = await loadDjvuEncoder();
  const pages = [
    [200, 40, 40],
    [40, 160, 60],
    [40, 70, 200],
  ].map((color) => pageImage(ImageData, 600, 800, color));
  const doc = new DjVu.IWImageWriter(90).createMultiPageDocument(pages);
  const file = withOutline(DjVu, new Uint8Array(doc.buffer), [
    { description: 'Red page', url: '#1' },
    { description: 'Part two', url: '#2', children: [{ description: 'Blue page', url: '#3' }] },
  ]);
  await writeFile(`${out}/sample.djvu`, file);
  console.log(`${out}/sample.djvu`, file.length, 'bytes');
}

// --- Kindle formats (via Calibre) ----------------------------------------------------------------

function png(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
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

const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><meta charset="utf-8"/><title>${title}</title>
<link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;
const filler = (n) =>
  Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}. Kindle books are converted to HTML at import time, ` +
    'so the reader can paginate them like any other book. Ünïcödé text survives the round trip.</p>').join('\n');

const kindleSource = {
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5a6b7c8d-0000-4000-8000-000000000001</dc:identifier>
    <dc:title>Kindle Sample</dc:title>
    <dc:creator>eReaderPlus samples</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta name="cover" content="cover"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="figure" href="images/figure.png" media-type="image/png"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`),
  'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="ch1.xhtml">Chapter One</a><ol><li><a href="ch1.xhtml#figure">The Figure</a></li></ol></li>
  <li><a href="ch2.xhtml">Chapter Two</a></li>
</ol></nav></body></html>`),
  'OEBPS/toc.ncx': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head></head><docTitle><text>Kindle Sample</text></docTitle><navMap>
  <navPoint id="n1" playOrder="1"><navLabel><text>Chapter One</text></navLabel><content src="ch1.xhtml"/>
    <navPoint id="n2" playOrder="2"><navLabel><text>The Figure</text></navLabel><content src="ch1.xhtml#figure"/></navPoint>
  </navPoint>
  <navPoint id="n3" playOrder="3"><navLabel><text>Chapter Two</text></navLabel><content src="ch2.xhtml"/></navPoint>
</navMap></ncx>`),
  'OEBPS/style.css': strToU8('h1 { color: #8b1a1a; text-align: center; } .figure { text-align: center; }'),
  'OEBPS/images/cover.png': png(300, 450, [139, 26, 26]),
  'OEBPS/images/figure.png': png(200, 120, [30, 90, 160]),
  'OEBPS/ch1.xhtml': strToU8(
    xhtml(
      'Chapter One',
      `<h1>Chapter One</h1>${filler(6)}
<p>See the note<a href="ch2.xhtml#note1" id="ref1">[1]</a>.</p>
<div class="figure" id="figure"><img src="images/figure.png" alt="A blue figure"/></div>${filler(6)}`,
    ),
  ),
  'OEBPS/ch2.xhtml': strToU8(
    xhtml('Chapter Two', `<h1>Chapter Two</h1>${filler(8)}<p id="note1"><a href="ch1.xhtml#ref1">[1]</a> The note.</p>`),
  ),
};

// --- PDF ----------------------------------------------------------------------------------------

{
  const colors = [
    [200, 40, 40],
    [40, 160, 60],
    [40, 70, 200],
  ];
  const names = ['Page One', 'Page Two', 'Page Three'];
  const rgb = (c) => c.map((v) => (v / 255).toFixed(4)).join(' ');
  const stream = (content) => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  const pageContent = (i) =>
    `q ${rgb(colors[i])} rg 0 0 450 600 re f 1 1 1 rg 60 420 330 120 re f ` +
    `0 0 0 rg BT /F1 28 Tf 80 465 Td (${names[i]}) Tj ET` +
    (i === 0 ? ' 1 1 1 rg BT /F1 16 Tf 70 315 Td (Go to page three) Tj ET BT /F1 16 Tf 70 255 Td (Visit example.com) Tj ET' : '') +
    ' Q';
  const page = (contents, extra = '') =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 450 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R${extra} >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /PageMode /UseOutlines >>',
    '<< /Type /Pages /Kids [4 0 R 5 0 R 6 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    page(7, ' /Annots [14 0 R 15 0 R]'),
    page(8),
    page(9),
    stream(pageContent(0)),
    stream(pageContent(1)),
    stream(pageContent(2)),
    '<< /Type /Outlines /First 11 0 R /Last 12 0 R /Count 3 >>',
    '<< /Title (Red page) /Parent 10 0 R /Next 12 0 R /Dest [4 0 R /Fit] >>',
    '<< /Title (Part two) /Parent 10 0 R /Prev 11 0 R /First 13 0 R /Last 13 0 R /Count 1 /Dest [5 0 R /Fit] >>',
    '<< /Title (Blue page) /Parent 12 0 R /Dest [6 0 R /Fit] >>',
    '<< /Type /Annot /Subtype /Link /Rect [60 300 390 340] /Border [0 0 0] /Dest [6 0 R /Fit] >>',
    '<< /Type /Annot /Subtype /Link /Rect [60 240 390 280] /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>',
    '<< /Title (PDF Sample) /Author (eReaderPlus samples) >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  const id = '<0123456789abcdef0123456789abcdef>';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 16 0 R /ID [${id} ${id}] >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(`${out}/sample.pdf`, Buffer.from(pdf, 'latin1'));
  console.log(`${out}/sample.pdf`);
}

// --- CHM ----------------------------------------------------------------------------------------

/** Windows-1251 for ASCII and Russian letters (what an old Russian help file would contain). */
function cp1251(text) {
  return Uint8Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    if (code < 0x80) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    if (code === 0x401) return 0xa8;
    if (code === 0x451) return 0xb8;
    throw new Error(`No Windows-1251 byte for ${ch}`);
  });
}

/** Big-endian 7-bit variable-length integer, as in CHM directory entries. */
function encint(n) {
  const bytes = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

/** A CHM with every file in the uncompressed section and a single directory chunk. */
function chmFile(files, lcid) {
  const sorted = [...files].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  const entries = [];
  let offset = 0;
  for (const file of sorted) {
    const name = Buffer.from(file.name, 'utf8');
    entries.push(...encint(name.length), ...name, ...encint(0), ...encint(offset), ...encint(file.data.length));
    offset += file.data.length;
  }
  const chunkSize = 0x1000;
  if (0x14 + entries.length + 2 > chunkSize) throw new Error('Too many files for one directory chunk');
  const chunk = Buffer.alloc(chunkSize);
  chunk.write('PMGL', 0, 'latin1');
  chunk.writeUInt32LE(chunkSize - 0x14 - entries.length, 4);
  chunk.writeInt32LE(-1, 12);
  chunk.writeInt32LE(-1, 16);
  Buffer.from(entries).copy(chunk, 0x14);
  chunk.writeUInt16LE(sorted.length, chunkSize - 2);

  // ITSP: version, header length, unknown, chunk size, density, depth, root index (none), first and last
  // PMGL chunk, unknown, chunk count, language.
  const itsp = Buffer.alloc(0x54);
  itsp.write('ITSP', 0, 'latin1');
  [1, 0x54, 0x0a, chunkSize, 2, 1, -1, 0, 0, -1, 1, lcid].forEach((v, i) => itsp.writeInt32LE(v, 4 + i * 4));

  const dirOffset = 0x60 + 0x18;
  const dataOffset = dirOffset + itsp.length + chunk.length;
  const itsf = Buffer.alloc(0x60);
  itsf.write('ITSF', 0, 'latin1');
  itsf.writeInt32LE(3, 4);
  itsf.writeInt32LE(0x60, 8);
  itsf.writeInt32LE(1, 12);
  itsf.writeUInt32LE(lcid, 0x14);
  itsf.writeBigUInt64LE(0x60n, 0x38);
  itsf.writeBigUInt64LE(0x18n, 0x40);
  itsf.writeBigUInt64LE(BigInt(dirOffset), 0x48);
  itsf.writeBigUInt64LE(BigInt(itsp.length + chunk.length), 0x50);
  itsf.writeBigUInt64LE(BigInt(dataOffset), 0x58);
  const section0 = Buffer.alloc(0x18);
  section0.writeUInt32LE(0x01fe, 0);
  section0.writeBigUInt64LE(BigInt(dataOffset + offset), 8);
  return Buffer.concat([itsf, section0, itsp, chunk, ...sorted.map((f) => Buffer.from(f.data))]);
}

function chmSystem(records) {
  const parts = [Buffer.from([3, 0, 0, 0])];
  for (const [code, data] of records) {
    const header = Buffer.alloc(4);
    header.writeUInt16LE(code, 0);
    header.writeUInt16LE(data.length, 2);
    parts.push(header, data);
  }
  return Buffer.concat(parts);
}

{
  const lcid = 0x0419; // Russian: pages without a charset declaration are Windows-1251
  const zstr = (s) => Buffer.concat([Buffer.from(cp1251(s)), Buffer.from([0])]);
  const lcidRecord = Buffer.alloc(36);
  lcidRecord.writeUInt32LE(lcid, 0);
  const page = (title, body, head = '') => cp1251(`<HTML><HEAD><TITLE>${title}</TITLE>${head}</HEAD><BODY>${body}</BODY></HTML>`);
  const files = [
    {
      name: '/#SYSTEM',
      data: chmSystem([
        [0, zstr('sample.hhc')],
        [2, zstr('index.htm')],
        [3, zstr('Пример справки')],
        [4, lcidRecord],
      ]),
    },
    {
      name: '/index.htm',
      data: page(
        'Справка',
        '<H1>Пример справки</H1><P>Добро пожаловать.</P>' +
          '<P><A HREF="TOPICS/Chapter1.HTM">Глава первая</A> | <A HREF="ms-its:sample.chm::/topics/chapter2.htm#part">Глава вторая</A></P>' +
          '<IMG SRC="Images\\Pic.PNG" ALT="">',
        '<LINK REL="stylesheet" HREF="style.css">',
      ),
    },
    {
      name: '/topics/chapter1.htm',
      data: page(
        'Глава первая',
        '<H1>Глава первая</H1><P>Текст первой главы.</P><P><A HREF="../INDEX.HTM">Назад</A></P>' +
          '<SCRIPT>window.__chmScript = true;</SCRIPT>',
        '<LINK REL="stylesheet" HREF="../Style.CSS">',
      ),
    },
    {
      name: '/topics/chapter2.htm',
      data: page('Глава вторая', `<H1>Глава вторая</H1>${'<P>Длинный текст второй главы.</P>'.repeat(30)}<P ID="part">Часть два.</P>`),
    },
    { name: '/style.css', data: cp1251('h1 { color: #8b1a1a; } body { background: url(IMAGES/pic.png) no-repeat -9999px 0; }') },
    { name: '/images/pic.png', data: png(120, 60, [30, 90, 160]) },
    {
      name: '/sample.hhc',
      data: cp1251(
        '<HTML><BODY><UL>' +
          '<LI><OBJECT type="text/sitemap"><param name="Name" value="Пример справки"><param name="Local" value="index.htm"></OBJECT>' +
          '<LI><OBJECT type="text/sitemap"><param name="Name" value="Главы"></OBJECT>' +
          '<UL><LI><OBJECT type="text/sitemap"><param name="Name" value="Глава первая"><param name="Local" value="topics\\chapter1.htm"></OBJECT>' +
          '<LI><OBJECT type="text/sitemap"><param name="Name" value="Глава вторая &amp; часть два"><param name="Local" value="Topics/Chapter2.htm#part"></OBJECT>' +
          '</UL></UL></BODY></HTML>',
      ),
    },
  ];
  await writeFile(`${out}/sample.chm`, chmFile(files, lcid));
  console.log(`${out}/sample.chm`);
}

const work = await mkdtemp(path.join(tmpdir(), 'ereader-fixtures-'));
try {
  const epub = path.join(work, 'kindle-sample.epub');
  await writeFile(epub, zipSync(kindleSource));
  const convert = (target, ...args) => {
    execFileSync('ebook-convert', [epub, path.join(out, target), ...args], { stdio: 'ignore' });
    console.log(`${out}/${target}`);
  };
  try {
    convert('sample.mobi', '--mobi-file-type', 'old');
    convert('sample.azw3');
    convert('sample-combo.mobi', '--mobi-file-type', 'both');
    convert('sample.lit');
  } catch (error) {
    console.error(`Skipping the Kindle fixtures: Calibre's ebook-convert failed or is not installed (${error.message})`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
