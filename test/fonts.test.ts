import { describe, expect, it } from 'vitest';
import { memoryBookFs } from '../src/core/bookfs';
import { deobfuscateFonts, DrmError, IDPF_ALGORITHM, xorPrefix } from '../src/core/fonts';

const encryption = (algorithm: string) => `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="${algorithm}"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/f.otf"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`;

describe('font de-obfuscation', () => {
  it('reverses IDPF obfuscation (XOR with SHA-1 of the identifier)', async () => {
    const font = new Uint8Array(2000).map((_, i) => i % 251);
    const key = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode('urn:uuid:abc')));
    const fs = memoryBookFs({
      'META-INF/encryption.xml': encryption(IDPF_ALGORITHM),
      'OEBPS/fonts/f.otf': xorPrefix(font, key, 1040),
    });
    await deobfuscateFonts(fs, ' urn:uuid:abc\n', []);
    expect(await fs.readBinary('OEBPS/fonts/f.otf')).toEqual(font);
  });

  it('refuses DRM-encrypted books', async () => {
    const fs = memoryBookFs({
      'META-INF/encryption.xml': encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc'),
      'OEBPS/fonts/f.otf': new Uint8Array(10),
    });
    await expect(deobfuscateFonts(fs, 'x', [])).rejects.toBeInstanceOf(DrmError);
  });
});
