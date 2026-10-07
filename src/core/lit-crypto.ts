/**
 * The two primitives Microsoft Reader's "sealed" and "inscribed" LIT files use (src/core/lit.ts):
 * Microsoft's DES variant in ECB mode, and Microsoft's modified SHA-1 (ported from Calibre's lit/mssha1.py, GPL-3.0,
 * Marshall T. Vandegrift). Neither is available in Web Crypto.
 */

// --- Microsoft SHA-1 -----------------------------------------------------------------------------

const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
const fCh = (b: number, c: number, d: number) => ((b & (c ^ d)) ^ d) >>> 0;
const fParity = (b: number, c: number, d: number) => (b ^ c ^ d) >>> 0;
const fMaj = (b: number, c: number, d: number) => (((b | c) & d) | (b & c)) >>> 0;
const fMs = (b: number, c: number) => ((b + c) ^ c) >>> 0;

const ROUND_FUNCTIONS = Array.from({ length: 80 }, (_, t) => [fCh, fParity, fMaj, fParity][Math.floor(t / 20)]);
// Microsoft's changes to the standard schedule.
for (const t of [3, 10, 15, 51]) ROUND_FUNCTIONS[t] = fParity;
for (const t of [6, 42]) ROUND_FUNCTIONS[t] = fMs;
ROUND_FUNCTIONS[26] = fCh;
ROUND_FUNCTIONS[31] = fMaj;
ROUND_FUNCTIONS[68] = fCh;
const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

export function msSha1(data: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);

  // Initial state also differs from standard SHA-1.
  const h = [0x32107654, 0x23016745, 0xc4e680a2, 0xdc679823, 0xd0857a34];
  const w = new Uint32Array(80);
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let [a, b, c, d, e] = h;
    for (let t = 0; t < 80; t++) {
      const temp = (rotl(a, 5) + ROUND_FUNCTIONS[t](b, c, d) + e + w[t] + K[Math.floor(t / 20)]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  h.forEach((v, i) => outView.setUint32(i * 4, v));
  return out;
}

// --- Microsoft DES ----------------------------------------------------------------------------------
// Richard Outerbridge's public-domain D3DES (via Calibre's msdes module), with Microsoft's SP tables.

const PC1 = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const TOTROT = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28];
const PC2 = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];
const BYTEBIT = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01];

/** Microsoft's DES SP tables (S-boxes combined with P), from ConvertLIT's spr.h (Dan A. Jackson, GPL-2.0-or-later) via Calibre. */
const SP = [
  // SP1
  0x02080800, 0x00080000, 0x02000002, 0x02080802, 0x02000000, 0x00080802, 0x00080002, 0x02000002,
  0x00080802, 0x02080800, 0x02080000, 0x00000802, 0x02000802, 0x02000000, 0x00000000, 0x00080002,
  0x00080000, 0x00000002, 0x02000800, 0x00080800, 0x02080802, 0x02080000, 0x00000802, 0x02000800,
  0x00000002, 0x00000800, 0x00080800, 0x02080002, 0x00000800, 0x02000802, 0x02080002, 0x00000000,
  0x00000000, 0x02080802, 0x02000800, 0x00080002, 0x02080800, 0x00080000, 0x00000802, 0x02000800,
  0x02080002, 0x00000800, 0x00080800, 0x02000002, 0x00080802, 0x00000002, 0x02000002, 0x02080000,
  0x02080802, 0x00080800, 0x02080000, 0x02000802, 0x02000000, 0x00000802, 0x00080002, 0x00000000,
  0x00080000, 0x02000000, 0x02000802, 0x02080800, 0x00000002, 0x02080002, 0x00000800, 0x00080802,
  // SP2
  0x40108010, 0x00000000, 0x00108000, 0x40100000, 0x40000010, 0x00008010, 0x40008000, 0x00108000,
  0x00008000, 0x40100010, 0x00000010, 0x40008000, 0x00100010, 0x40108000, 0x40100000, 0x00000010,
  0x00100000, 0x40008010, 0x40100010, 0x00008000, 0x00108010, 0x40000000, 0x00000000, 0x00100010,
  0x40008010, 0x00108010, 0x40108000, 0x40000010, 0x40000000, 0x00100000, 0x00008010, 0x40108010,
  0x00100010, 0x40108000, 0x40008000, 0x00108010, 0x40108010, 0x00100010, 0x40000010, 0x00000000,
  0x40000000, 0x00008010, 0x00100000, 0x40100010, 0x00008000, 0x40000000, 0x00108010, 0x40008010,
  0x40108000, 0x00008000, 0x00000000, 0x40000010, 0x00000010, 0x40108010, 0x00108000, 0x40100000,
  0x40100010, 0x00100000, 0x00008010, 0x40008000, 0x40008010, 0x00000010, 0x40100000, 0x00108000,
  // SP3
  0x04000001, 0x04040100, 0x00000100, 0x04000101, 0x00040001, 0x04000000, 0x04000101, 0x00040100,
  0x04000100, 0x00040000, 0x04040000, 0x00000001, 0x04040101, 0x00000101, 0x00000001, 0x04040001,
  0x00000000, 0x00040001, 0x04040100, 0x00000100, 0x00000101, 0x04040101, 0x00040000, 0x04000001,
  0x04040001, 0x04000100, 0x00040101, 0x04040000, 0x00040100, 0x00000000, 0x04000000, 0x00040101,
  0x04040100, 0x00000100, 0x00000001, 0x00040000, 0x00000101, 0x00040001, 0x04040000, 0x04000101,
  0x00000000, 0x04040100, 0x00040100, 0x04040001, 0x00040001, 0x04000000, 0x04040101, 0x00000001,
  0x00040101, 0x04000001, 0x04000000, 0x04040101, 0x00040000, 0x04000100, 0x04000101, 0x00040100,
  0x04000100, 0x00000000, 0x04040001, 0x00000101, 0x04000001, 0x00040101, 0x00000100, 0x04040000,
  // SP4
  0x00401008, 0x10001000, 0x00000008, 0x10401008, 0x00000000, 0x10400000, 0x10001008, 0x00400008,
  0x10401000, 0x10000008, 0x10000000, 0x00001008, 0x10000008, 0x00401008, 0x00400000, 0x10000000,
  0x10400008, 0x00401000, 0x00001000, 0x00000008, 0x00401000, 0x10001008, 0x10400000, 0x00001000,
  0x00001008, 0x00000000, 0x00400008, 0x10401000, 0x10001000, 0x10400008, 0x10401008, 0x00400000,
  0x10400008, 0x00001008, 0x00400000, 0x10000008, 0x00401000, 0x10001000, 0x00000008, 0x10400000,
  0x10001008, 0x00000000, 0x00001000, 0x00400008, 0x00000000, 0x10400008, 0x10401000, 0x00001000,
  0x10000000, 0x10401008, 0x00401008, 0x00400000, 0x10401008, 0x00000008, 0x10001000, 0x00401008,
  0x00400008, 0x00401000, 0x10400000, 0x10001008, 0x00001008, 0x10000000, 0x10000008, 0x10401000,
  // SP5
  0x08000000, 0x00010000, 0x00000400, 0x08010420, 0x08010020, 0x08000400, 0x00010420, 0x08010000,
  0x00010000, 0x00000020, 0x08000020, 0x00010400, 0x08000420, 0x08010020, 0x08010400, 0x00000000,
  0x00010400, 0x08000000, 0x00010020, 0x00000420, 0x08000400, 0x00010420, 0x00000000, 0x08000020,
  0x00000020, 0x08000420, 0x08010420, 0x00010020, 0x08010000, 0x00000400, 0x00000420, 0x08010400,
  0x08010400, 0x08000420, 0x00010020, 0x08010000, 0x00010000, 0x00000020, 0x08000020, 0x08000400,
  0x08000000, 0x00010400, 0x08010420, 0x00000000, 0x00010420, 0x08000000, 0x00000400, 0x00010020,
  0x08000420, 0x00000400, 0x00000000, 0x08010420, 0x08010020, 0x08010400, 0x00000420, 0x00010000,
  0x00010400, 0x08010020, 0x08000400, 0x00000420, 0x00000020, 0x00010420, 0x08010000, 0x08000020,
  // SP6
  0x80000040, 0x00200040, 0x00000000, 0x80202000, 0x00200040, 0x00002000, 0x80002040, 0x00200000,
  0x00002040, 0x80202040, 0x00202000, 0x80000000, 0x80002000, 0x80000040, 0x80200000, 0x00202040,
  0x00200000, 0x80002040, 0x80200040, 0x00000000, 0x00002000, 0x00000040, 0x80202000, 0x80200040,
  0x80202040, 0x80200000, 0x80000000, 0x00002040, 0x00000040, 0x00202000, 0x00202040, 0x80002000,
  0x00002040, 0x80000000, 0x80002000, 0x00202040, 0x80202000, 0x00200040, 0x00000000, 0x80002000,
  0x80000000, 0x00002000, 0x80200040, 0x00200000, 0x00200040, 0x80202040, 0x00202000, 0x00000040,
  0x80202040, 0x00202000, 0x00200000, 0x80002040, 0x80000040, 0x80200000, 0x00202040, 0x00000000,
  0x00002000, 0x80000040, 0x80002040, 0x80202000, 0x80200000, 0x00002040, 0x00000040, 0x80200040,
  // SP7
  0x00004000, 0x00000200, 0x01000200, 0x01000004, 0x01004204, 0x00004004, 0x00004200, 0x00000000,
  0x01000000, 0x01000204, 0x00000204, 0x01004000, 0x00000004, 0x01004200, 0x01004000, 0x00000204,
  0x01000204, 0x00004000, 0x00004004, 0x01004204, 0x00000000, 0x01000200, 0x01000004, 0x00004200,
  0x01004004, 0x00004204, 0x01004200, 0x00000004, 0x00004204, 0x01004004, 0x00000200, 0x01000000,
  0x00004204, 0x01004000, 0x01004004, 0x00000204, 0x00004000, 0x00000200, 0x01000000, 0x01004004,
  0x01000204, 0x00004204, 0x00004200, 0x00000000, 0x00000200, 0x01000004, 0x00000004, 0x01000200,
  0x00000000, 0x01000204, 0x01000200, 0x00004200, 0x00000204, 0x00004000, 0x01004204, 0x01000000,
  0x01004200, 0x00000004, 0x00004004, 0x01004204, 0x01000004, 0x01004200, 0x01004000, 0x00004004,
  // SP8
  0x20800080, 0x20820000, 0x00020080, 0x00000000, 0x20020000, 0x00800080, 0x20800000, 0x20820080,
  0x00000080, 0x20000000, 0x00820000, 0x00020080, 0x00820080, 0x20020080, 0x20000080, 0x20800000,
  0x00020000, 0x00820080, 0x00800080, 0x20020000, 0x20820080, 0x20000080, 0x00000000, 0x00820000,
  0x20000000, 0x00800000, 0x20020080, 0x20800080, 0x00800000, 0x00020000, 0x20820000, 0x00000080,
  0x00800000, 0x00020000, 0x20000080, 0x20820080, 0x00020080, 0x20000000, 0x00000000, 0x00820000,
  0x20800080, 0x20020080, 0x20020000, 0x00800080, 0x20820000, 0x00000080, 0x00800080, 0x20020000,
  0x20820080, 0x00800000, 0x20800000, 0x20000080, 0x00820000, 0x00020080, 0x20020080, 0x20800000,
  0x00000080, 0x20820000, 0x00820080, 0x00000000, 0x20000000, 0x20800080, 0x00020000, 0x00820080,
].reduce<Uint32Array[]>((tables, value, i) => {
  if (i % 64 === 0) tables.push(new Uint32Array(64));
  tables[tables.length - 1][i % 64] = value;
  return tables;
}, []);

/** Key schedule, already "cooked" into the layout desfunc expects. */
function deskey(key: Uint8Array, decrypt: boolean): Uint32Array {
  const pc1m = PC1.map((l) => (key[l >> 3] & BYTEBIT[l & 7] ? 1 : 0));
  const pcr = new Array<number>(56);
  const raw = new Uint32Array(32);
  for (let i = 0; i < 16; i++) {
    const m = decrypt ? (15 - i) << 1 : i << 1;
    for (let j = 0; j < 28; j++) {
      const l = j + TOTROT[i];
      pcr[j] = pc1m[l < 28 ? l : l - 28];
    }
    for (let j = 28; j < 56; j++) {
      const l = j + TOTROT[i];
      pcr[j] = pc1m[l < 56 ? l : l - 28];
    }
    for (let j = 0; j < 24; j++) {
      if (pcr[PC2[j]]) raw[m] |= 1 << (23 - j);
      if (pcr[PC2[j + 24]]) raw[m + 1] |= 1 << (23 - j);
    }
  }
  const cooked = new Uint32Array(32);
  for (let i = 0; i < 32; i += 2) {
    const raw0 = raw[i];
    const raw1 = raw[i + 1];
    cooked[i] = ((raw0 & 0x00fc0000) << 6) | ((raw0 & 0x00000fc0) << 10) | ((raw1 & 0x00fc0000) >>> 10) | ((raw1 & 0x00000fc0) >>> 6);
    cooked[i + 1] = ((raw0 & 0x0003f000) << 12) | ((raw0 & 0x0000003f) << 16) | ((raw1 & 0x0003f000) >>> 4) | (raw1 & 0x0000003f);
  }
  return cooked;
}

const rotl32 = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

function desfunc(block: Uint32Array, keys: Uint32Array, sp: Uint32Array[]): void {
  let left = block[0];
  let right = block[1];
  let work = ((left >>> 4) ^ right) & 0x0f0f0f0f;
  right ^= work;
  left ^= work << 4;
  work = ((left >>> 16) ^ right) & 0x0000ffff;
  right ^= work;
  left ^= work << 16;
  work = ((right >>> 2) ^ left) & 0x33333333;
  left ^= work;
  right ^= work << 2;
  work = ((right >>> 8) ^ left) & 0x00ff00ff;
  left ^= work;
  right ^= work << 8;
  right = rotl32(right, 1);
  work = (left ^ right) & 0xaaaaaaaa;
  left ^= work;
  right ^= work;
  left = rotl32(left, 1);

  const f = (half: number, k: number): number => {
    let w = (rotl32(half, 28) ^ keys[k]) >>> 0;
    let value = sp[6][w & 0x3f] | sp[4][(w >>> 8) & 0x3f] | sp[2][(w >>> 16) & 0x3f] | sp[0][(w >>> 24) & 0x3f];
    w = (half ^ keys[k + 1]) >>> 0;
    value |= sp[7][w & 0x3f] | sp[5][(w >>> 8) & 0x3f] | sp[3][(w >>> 16) & 0x3f] | sp[1][(w >>> 24) & 0x3f];
    return value;
  };
  for (let k = 0; k < 32; k += 4) {
    left = (left ^ f(right, k)) >>> 0;
    right = (right ^ f(left, k + 2)) >>> 0;
  }

  right = rotl32(right, 31);
  work = (left ^ right) & 0xaaaaaaaa;
  left ^= work;
  right ^= work;
  left = rotl32(left, 31);
  work = ((left >>> 8) ^ right) & 0x00ff00ff;
  right ^= work;
  left ^= work << 8;
  work = ((left >>> 2) ^ right) & 0x33333333;
  right ^= work;
  left ^= work << 2;
  work = ((right >>> 16) ^ left) & 0x0000ffff;
  left ^= work;
  right ^= work << 16;
  work = ((right >>> 4) ^ left) & 0x0f0f0f0f;
  left ^= work;
  right ^= work << 4;
  block[0] = right >>> 0;
  block[1] = left >>> 0;
}

/** ECB over whole 8-byte blocks (a trailing partial block is zero-padded), with the given SP tables. */
export function desEcb(key: Uint8Array, data: Uint8Array, decrypt: boolean, sp: Uint32Array[] = SP): Uint8Array {
  const keys = deskey(key, decrypt);
  const out = new Uint8Array(Math.ceil(data.length / 8) * 8);
  out.set(data);
  const view = new DataView(out.buffer);
  const block = new Uint32Array(2);
  for (let at = 0; at < out.length; at += 8) {
    block[0] = view.getUint32(at);
    block[1] = view.getUint32(at + 4);
    desfunc(block, keys, sp);
    view.setUint32(at, block[0]);
    view.setUint32(at + 4, block[1]);
  }
  return out;
}

/** Microsoft DES decryption, as used by LIT files. */
export const desDecrypt = (key: Uint8Array, data: Uint8Array) => desEcb(key, data, true);
