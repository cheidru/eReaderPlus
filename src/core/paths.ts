/** POSIX-style path helpers for book-root-relative paths (no leading slash). */

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Normalizes `a/./b/../c` to `a/c`. Returns null when the path escapes the root. */
export function normalize(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

export function splitFragment(href: string): [path: string, fragment: string] {
  const i = href.indexOf('#');
  return i < 0 ? [href, ''] : [href.slice(0, i), href.slice(i + 1)];
}

/**
 * Resolves `href` (as found inside the document at `basePath`) to a book-root-relative path,
 * keeping any #fragment. Returns null for external URLs or paths escaping the root.
 */
export function resolveHref(basePath: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const [rawPath, fragment] = splitFragment(href);
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = rawPath;
  }
  const joined = path === '' ? basePath : path.startsWith('/') ? path.slice(1) : joinDir(dirname(basePath), path);
  const normalized = normalize(joined);
  if (normalized === null) return null;
  return fragment ? `${normalized}#${fragment}` : normalized;
}

function joinDir(dir: string, path: string): string {
  return dir ? `${dir}/${path}` : path;
}

/** Encodes each path segment for use in a URL. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Relative URL path from the document at `fromPath` to `toPath` (both book-root-relative). */
export function relativePath(fromPath: string, toPath: string): string {
  const from = dirname(fromPath).split('/').filter(Boolean);
  const to = toPath.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...Array<string>(from.length - common).fill('..'), ...to.slice(common)].join('/');
}
