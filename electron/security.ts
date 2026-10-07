import { app, type Session } from 'electron';
import { BOOK_SCHEME } from '../src/platform/electron-api';
import { APP_ORIGIN } from './protocols';

/** Permissions the app UI itself may use. Book origins get none. */
const APP_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

function originOf(url: string): string {
  try {
    // Not URL.origin: Node reports "null" as the origin of custom schemes such as app://.
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return '';
  }
}

export function isAppUrl(url: string, devOrigin: string | null): boolean {
  const origin = originOf(url);
  return origin === APP_ORIGIN || (devOrigin !== null && origin === devOrigin);
}

export function hardenSession(session: Session, devOrigin: string | null): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isAppUrl(details.requestingUrl, devOrigin) && APP_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return isAppUrl(requestingOrigin, devOrigin) && APP_PERMISSIONS.has(permission);
  });

  // Nothing in the reader needs the network. Book CSP already blocks it; this is defense in depth.
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    const allowed = devOrigin !== null && originOf(details.url.replace(/^ws/, 'http')) === devOrigin;
    callback({ cancel: !allowed });
  });
}

export function hardenAllWebContents(devOrigin: string | null): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('will-frame-navigate', (event) => {
      const { url, isMainFrame } = event;
      const allowed = isMainFrame ? isAppUrl(url, devOrigin) : url.startsWith(`${BOOK_SCHEME}://`) || url === 'about:blank';
      if (!allowed) event.preventDefault();
    });
  });
}
