import { describe, expect, it } from 'vitest';
import { checkForAppUpdate, LATEST_RELEASE_URL, newerRelease } from '../src/core/app-updates';

const apk = { name: 'eReaderPlus.apk', browser_download_url: 'https://github.com/cheidru/eReaderPlus/releases/download/v0.2.0/eReaderPlus.apk' };
const release = (tag: string, assets: unknown[] = [apk]) => ({ tag_name: tag, assets });

describe('Android app updates', () => {
  it('offers a newer release with its APK', () => {
    expect(newerRelease(release('v0.2.0'), '0.1.0')).toEqual({ version: '0.2.0', url: apk.browser_download_url });
    expect(newerRelease(release('v0.10.0'), '0.9.3')?.version).toBe('0.10.0');
  });

  it('offers nothing for the same or an older version, or a release without an APK', () => {
    expect(newerRelease(release('v0.1.0'), '0.1.0')).toBeNull();
    expect(newerRelease(release('v0.1.0'), '0.2.0')).toBeNull();
    expect(newerRelease(release('v0.2.0', [{ name: 'eReaderPlus-Setup.exe', browser_download_url: 'x' }]), '0.1.0')).toBeNull();
  });

  it('treats the release of a pre-release version as newer, and ignores malformed responses', () => {
    expect(newerRelease(release('v1.0.0'), '1.0.0-beta.1')?.version).toBe('1.0.0');
    expect(newerRelease(release('nightly'), '0.1.0')).toBeNull();
    expect(newerRelease({ message: 'Not Found' }, '0.1.0')).toBeNull();
    expect(newerRelease(null, '0.1.0')).toBeNull();
  });

  it('asks GitHub for the latest release, and gives up quietly when it cannot', async () => {
    const urls: string[] = [];
    const ok = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(release('v0.2.0')));
    }) as typeof fetch;
    expect(await checkForAppUpdate('0.1.0', ok)).toEqual({ version: '0.2.0', url: apk.browser_download_url });
    expect(urls).toEqual([LATEST_RELEASE_URL]);

    const rateLimited = (async () => new Response('{}', { status: 403 })) as typeof fetch;
    expect(await checkForAppUpdate('0.1.0', rateLimited)).toBeNull();
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await checkForAppUpdate('0.1.0', offline)).toBeNull();
  });
});
