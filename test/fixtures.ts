/** Small in-memory books for tests. */
export const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

export function epub3Files(): Record<string, string | Uint8Array> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>Test Book</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:creator>Charles Babbage</dc:creator>
    <dc:language>en</dc:language>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="images/cover%20art.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="ltr">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="notes" linear="no"/>
  </spine>
</package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head>
<body>
  <nav epub:type="landmarks"><ol><li><a href="text/ch2.xhtml">Wrong list</a></li></ol></nav>
  <nav epub:type="toc"><ol>
    <li><a href="text/ch1.xhtml">Chapter One</a>
      <ol><li><a href="text/ch1.xhtml#part-b">Part B</a></li></ol>
    </li>
    <li><span>Unlinked heading</span></li>
    <li><a href="text/ch2.xhtml">Chapter Two</a></li>
  </ol></nav>
</body></html>`,
    'OEBPS/images/cover art.jpg': new Uint8Array([0xff, 0xd8, 0xff]),
    'OEBPS/text/ch1.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title><script>window.bookScript = 1;</script></head>
<body><header>Not the head</header><p>Hello</p><p id="part-b">B</p></body></html>`,
    'OEBPS/text/ch2.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>No head element</p></body></html>`,
    'OEBPS/text/notes.xhtml': `<!DOCTYPE html><html><head></head><body><p>Notes</p></body></html>`,
  };
}

export function epub2Files(): Record<string, string | Uint8Array> {
  return {
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': `<?xml version="1.0"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <opf:metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Old Book</dc:title>
    <dc:identifier id="BookId">isbn-123</dc:identifier>
    <opf:meta name="cover" content="cov"/>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <opf:item id="cov" href="cover.png" media-type="image/png"/>
    <opf:item id="a" href="a.html" media-type="application/xhtml+xml"/>
  </opf:manifest>
  <opf:spine toc="ncx"><opf:itemref idref="a"/></opf:spine>
</opf:package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint id="p1"><navLabel><text>Start</text></navLabel><content src="a.html"/>
    <navPoint id="p2"><navLabel><text>Inner</text></navLabel><content src="a.html#x"/></navPoint>
  </navPoint>
</navMap></ncx>`,
    'OEBPS/cover.png': new Uint8Array([0x89, 0x50]),
    'OEBPS/a.html': '<html><HEAD><title>A</title></HEAD><body>A</body></html>',
  };
}
