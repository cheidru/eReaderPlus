/** Path prefix, on every book origin, that the shells serve from the app's own bundle instead of the book folder. */
export const READER_ASSETS_PREFIX = '/__ereader__/';

export const INJECTED_TAGS =
  `<link rel="stylesheet" href="${READER_ASSETS_PREFIX}paginator.css"/>` +
  `<script src="${READER_ASSETS_PREFIX}paginator.js"></script>`;

const HEAD_OPEN = /<head(\s[^>]*)?>/i;
const HTML_OPEN = /<html(\s[^>]*)?>/i;

/**
 * Inserts the paginator stylesheet and script at the start of <head>, so the reader is set up
 * before the book's own scripts run. Works on both XHTML and HTML sources without re-serializing.
 */
export function injectReader(source: string): string {
  if (source.includes(`${READER_ASSETS_PREFIX}paginator.js`)) return source;
  const head = HEAD_OPEN.exec(source);
  if (head) {
    const at = head.index + head[0].length;
    return source.slice(0, at) + INJECTED_TAGS + source.slice(at);
  }
  const html = HTML_OPEN.exec(source);
  if (html) {
    const at = html.index + html[0].length;
    return `${source.slice(0, at)}<head>${INJECTED_TAGS}</head>${source.slice(at)}`;
  }
  return INJECTED_TAGS + source;
}

export function isHtmlMediaType(mediaType: string): boolean {
  return mediaType === 'application/xhtml+xml' || mediaType === 'text/html';
}
