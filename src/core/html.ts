import { injectReader } from './inject';

/**
 * Re-serializes an XHTML document as HTML. Chromium does not run module scripts in XML documents
 * (crbug.com/717643), and much web JavaScript assumes HTML-parser behavior (innerHTML leniency,
 * document.write), so scripted chapters are served as HTML. Returns null if the source is not well-formed.
 */
export function xhtmlToHtml(source: string): string | null {
  const xml = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  if (xml.getElementsByTagName('parsererror').length > 0 || !xml.documentElement) return null;
  const html = document.implementation.createHTMLDocument('');
  html.replaceChild(html.importNode(xml.documentElement, true), html.documentElement);
  if (!html.querySelector('meta[charset]')) {
    const meta = html.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    html.head.prepend(meta);
  }
  return `<!DOCTYPE html>\n${html.documentElement.outerHTML}`;
}

/** Serializes a parsed (X)HTML document as UTF-8 HTML, with the reader injected. */
export function readerHtml(doc: Document, css?: string): string {
  let html = doc;
  if (doc.contentType !== 'text/html') {
    html = document.implementation.createHTMLDocument('');
    html.replaceChild(html.importNode(doc.documentElement, true), html.documentElement);
  }
  let head = html.head;
  if (!head) {
    head = html.createElement('head');
    html.documentElement.prepend(head);
  }
  for (const meta of Array.from(head.querySelectorAll('meta[charset], meta[http-equiv]'))) {
    if (meta.hasAttribute('charset') || /content-type/i.test(meta.getAttribute('http-equiv') ?? '')) meta.remove();
  }
  if (css) {
    const style = html.createElement('style');
    style.textContent = css;
    head.prepend(style);
  }
  const meta = html.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.prepend(meta);
  return injectReader(`<!DOCTYPE html>\n${html.documentElement.outerHTML}`);
}
