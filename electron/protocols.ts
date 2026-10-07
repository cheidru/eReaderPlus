import { net, protocol, type Session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_SCHEME, BOOK_SCHEME } from '../src/platform/electron-api';
import { isBookId, resolveInBook } from './bookstore';

export const APP_HOST = 'reader';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const READER_ASSETS_PREFIX = '/__ereader__/';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml; charset=utf-8',
  xht: 'application/xhtml+xml; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  opf: 'application/oebps-package+xml; charset=utf-8',
  ncx: 'application/x-dtbncx+xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  vtt: 'text/vtt; charset=utf-8',
  smil: 'application/smil+xml',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
};

function mimeType(file: string): string {
  return MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/** Must run before app 'ready'. Both schemes are secure contexts, so books get the full modern web platform. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: BOOK_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
}

async function serveFile(file: string, headers: Record<string, string>): Promise<Response> {
  const upstream = await net.fetch(pathToFileURL(file).toString());
  if (!upstream.ok) return notFound();
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': mimeType(file), 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

function decodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function insideDir(dir: string, relative: string): string | null {
  const resolved = path.resolve(dir, relative.replace(/^[/\\]+/, ''));
  return resolved.startsWith(dir + path.sep) ? resolved : null;
}

export function appCsp(devOrigin: string | null): string {
  const self = devOrigin ? `'self' ${devOrigin}` : `'self'`;
  return [
    `default-src ${self}`,
    // pdf.js compiles WebAssembly helpers (image decoders, PostScript functions) when importing PDFs.
    `script-src ${self} 'wasm-unsafe-eval'`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob: ${BOOK_SCHEME}:`,
    `frame-src ${BOOK_SCHEME}:`,
    `connect-src ${self}${devOrigin ? ` ${devOrigin.replace(/^http/, 'ws')}` : ''}`,
    `object-src 'none'`,
    `base-uri 'none'`,
  ].join('; ');
}

/**
 * CSP for book resources: everything from the book's own origin (including its scripts) is allowed,
 * nothing from the network. Only the app may embed the book.
 */
export function bookCsp(devOrigin: string | null): string {
  return [
    `default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'`,
    `connect-src 'self' data: blob:`,
    `form-action 'none'`,
    `base-uri 'self'`,
    `frame-ancestors ${APP_ORIGIN}${devOrigin ? ` ${devOrigin}` : ''}`,
  ].join('; ');
}

export interface ProtocolOptions {
  webRoot: string;
  readerAssetsDir: string;
  devOrigin: string | null;
}

export function registerProtocols(session: Session, options: ProtocolOptions): void {
  const appHeaders = { 'Content-Security-Policy': appCsp(options.devOrigin) };
  const bookHeaders = { 'Content-Security-Policy': bookCsp(options.devOrigin) };

  session.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodePath(url.pathname);
    if (url.host !== APP_HOST || relative === null) return notFound();
    const file = insideDir(options.webRoot, relative === '/' ? 'index.html' : relative);
    return file ? serveFile(file, appHeaders) : notFound();
  });

  session.protocol.handle(BOOK_SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodePath(url.pathname);
    if (!isBookId(url.host) || relative === null) return notFound();
    if (relative.startsWith(READER_ASSETS_PREFIX)) {
      const file = insideDir(options.readerAssetsDir, relative.slice(READER_ASSETS_PREFIX.length));
      return file ? serveFile(file, bookHeaders) : notFound();
    }
    try {
      return await serveFile(resolveInBook(url.host, relative), bookHeaders);
    } catch {
      return notFound();
    }
  });
}
