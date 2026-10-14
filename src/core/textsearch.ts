/**
 * Text matching for search inside a book, shared by the app (which searches every chapter and lists the
 * results) and the paginator (which finds the same match in the shown document and highlights it).
 * Both sides must see the same text, so they extract it with the same rules: the app from the stored
 * file, the paginator from the live document, and a match is identified by its occurrence number.
 */

/** A run of document text: a text node's content, or a space standing for a line or block break. */
export interface TextChunk {
  node: Text | null;
  text: string;
}

/** Normalized document text, and where each of its characters came from (only when asked for). */
export interface TextIndex {
  /** What is compared: case and quotes folded. */
  text: string;
  /** The same characters as written, for showing results: `display[i]` is where `text[i]` came from. */
  display: string;
  chunk: number[];
  offset: number[];
}

/** Elements whose text is never shown. */
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'title']);

/** Elements that start a new line: their edges count as a space, so words in adjacent blocks don't merge. */
const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'td', 'th', 'tr', 'ul',
]);

const BREAK: TextChunk = { node: null, text: ' ' };

/** The text of an element's subtree in reading order, with breaks at block boundaries. */
export function collectChunks(root: Element): TextChunk[] {
  const chunks: TextChunk[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      chunks.push({ node: node as Text, text: (node as Text).data });
      return;
    }
    if (node.nodeType !== 1) return;
    const name = (node as Element).localName.toLowerCase();
    if (SKIPPED.has(name)) return;
    const block = BLOCKS.has(name);
    if (block) chunks.push(BREAK);
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
    if (block) chunks.push(BREAK);
  };
  visit(root);
  return chunks;
}

/** Characters that are not part of the visible text: soft hyphen, zero-width spaces and joiners, BOM. */
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/;
const SPACE = /\s/;
const FOLDED: Record<string, string> = {
  'ё': 'е',
  '‘': "'",
  '’': "'",
  'ʼ': "'",
  '“': '"',
  '”': '"',
  '«': '"',
  '»': '"',
  '–': '-',
  '—': '-',
};

/** One character as compared: '' if invisible, ' ' if whitespace, else folded to lower case. */
function fold(char: string): string {
  if (INVISIBLE.test(char)) return '';
  if (SPACE.test(char)) return ' ';
  const lower = char.toLowerCase();
  // Some characters lower-case to two (İ); keeping the length keeps positions exact.
  const single = lower.length === 1 ? lower : char;
  return FOLDED[single] ?? single;
}

/** Joins chunks into comparable text: case and quotes folded, invisible characters dropped, whitespace collapsed. */
export function indexText(chunks: TextChunk[], withPositions: boolean): TextIndex {
  // Collected in an array: appending a whole book one character at a time to a string is quadratic.
  const chars: string[] = [];
  const shown: string[] = [];
  const chunk: number[] = [];
  const offset: number[] = [];
  let afterSpace = true; // No leading space.
  for (let c = 0; c < chunks.length; c++) {
    const raw = chunks[c].text;
    for (let o = 0; o < raw.length; o++) {
      const f = fold(raw[o]);
      if (f === '' || (f === ' ' && afterSpace)) continue;
      afterSpace = f === ' ';
      chars.push(f);
      shown.push(f === ' ' ? ' ' : raw[o]);
      if (withPositions) {
        chunk.push(c);
        offset.push(o);
      }
    }
  }
  return { text: chars.join(''), display: shown.join(''), chunk, offset };
}

/** A query in the same form as indexed text. */
export function normalizeQuery(query: string): string {
  return indexText([{ node: null, text: query }], false).text.trim();
}

/** Start positions of non-overlapping matches. */
export function findOccurrences(text: string, query: string): number[] {
  const starts: number[] = [];
  if (!query) return starts;
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) starts.push(at);
  return starts;
}

/** The document range of the `occurrence`-th match of `query` under `root`, or null if there is none. */
export function findRange(root: Element, query: string, occurrence: number): Range | null {
  const q = normalizeQuery(query);
  if (!q) return null;
  const chunks = collectChunks(root);
  const index = indexText(chunks, true);
  const start = findOccurrences(index.text, q)[occurrence];
  if (start === undefined) return null;
  const end = start + q.length - 1;
  // A query never starts or ends with a space, so both ends fall on characters of real text nodes.
  const startNode = chunks[index.chunk[start]].node;
  const endNode = chunks[index.chunk[end]].node;
  if (!startNode || !endNode) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(startNode, index.offset[start]);
  range.setEnd(endNode, index.offset[end] + 1);
  return range;
}
