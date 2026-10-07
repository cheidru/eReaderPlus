export function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(stripBom(text), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Malformed XML in ${what}`);
  }
  return doc;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Descendant elements by local name, ignoring namespaces (books are inconsistent about prefixes). */
export function all(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName));
}

export function first(root: Document | Element, localName: string): Element | null {
  return root.getElementsByTagNameNS('*', localName)[0] ?? null;
}

export function children(el: Element, localName?: string): Element[] {
  return Array.from(el.children).filter((c) => localName === undefined || c.localName === localName);
}

export function child(el: Element, localName: string): Element | null {
  return children(el, localName)[0] ?? null;
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Reads an attribute that may be written with or without a namespace prefix (e.g. epub:type, l:href). */
export function attr(el: Element, localName: string): string | null {
  if (el.hasAttribute(localName)) return el.getAttribute(localName);
  for (const a of Array.from(el.attributes)) {
    if (a.localName === localName) return a.value;
  }
  return null;
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
