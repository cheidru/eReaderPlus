/**
 * Font de-obfuscation for EPUB (IDPF "embedding" and Adobe schemes). Obfuscation is not DRM:
 * the key is derived from the book's own identifier, and readers are expected to reverse it.
 */
import type { BookFs } from './bookfs';
import { all, attr, first, parseXml } from './xml';

export const IDPF_ALGORITHM = 'http://www.idpf.org/2008/embedding';
export const ADOBE_ALGORITHM = 'http://ns.adobe.com/pdf/enc#RC';

export class DrmError extends Error {
  constructor() {
    super('This book is DRM-protected and cannot be opened.');
  }
}

interface EncryptedResource {
  path: string;
  algorithm: string;
}

export function parseEncryption(xml: string): EncryptedResource[] {
  const doc = parseXml(xml, 'META-INF/encryption.xml');
  return all(doc, 'EncryptedData').flatMap((data) => {
    const method = first(data, 'EncryptionMethod');
    const ref = first(data, 'CipherReference');
    const uri = ref ? attr(ref, 'URI') : null;
    if (!method || !uri) return [];
    return [{ path: decodeURIComponent(uri.replace(/^\//, '')), algorithm: attr(method, 'Algorithm') ?? '' }];
  });
}

async function idpfKey(uniqueIdentifier: string): Promise<Uint8Array> {
  const cleaned = uniqueIdentifier.replace(/[ \u0009\u000d\u000a]/g, '');
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(cleaned));
  return new Uint8Array(digest);
}

function adobeKey(identifiers: string[]): Uint8Array | null {
  const uuid = identifiers.map((id) => id.replace(/^urn:uuid:/i, '').replace(/-/g, '')).find((id) => /^[0-9a-f]{32}$/i.test(id));
  if (!uuid) return null;
  return Uint8Array.from(uuid.match(/../g)!.map((h) => Number.parseInt(h, 16)));
}

export function xorPrefix(data: Uint8Array, key: Uint8Array, length: number): Uint8Array {
  const out = data.slice();
  const n = Math.min(length, out.length);
  for (let i = 0; i < n; i++) out[i] ^= key[i % key.length];
  return out;
}

/** Rewrites obfuscated fonts in place. Throws DrmError when a resource uses real encryption. */
export async function deobfuscateFonts(fs: BookFs, uniqueIdentifier: string, identifiers: string[]): Promise<void> {
  const encryptionPath = 'META-INF/encryption.xml';
  if (!fs.files.includes(encryptionPath)) return;
  const resources = parseEncryption(await fs.readText(encryptionPath));
  for (const { path, algorithm } of resources) {
    if (!fs.files.includes(path)) continue;
    let key: Uint8Array | null;
    let length: number;
    if (algorithm === IDPF_ALGORITHM) {
      key = await idpfKey(uniqueIdentifier);
      length = 1040;
    } else if (algorithm === ADOBE_ALGORITHM) {
      key = adobeKey(identifiers);
      length = 1024;
    } else {
      throw new DrmError();
    }
    if (!key) continue;
    await fs.writeBinary(path, xorPrefix(await fs.readBinary(path), key, length));
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
