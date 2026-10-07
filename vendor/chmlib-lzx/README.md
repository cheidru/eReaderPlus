# LZX decompressor (vendored from chmlib-ts)

`lzx.js` / `lzx.d.ts` are copied unmodified (source map comments removed) from chmlib-ts 0.3.0
(https://www.npmjs.com/package/chmlib-ts), a TypeScript port of chmlib by Jed Wing, with LZX code derived from
cabextract by Stuart Caie. Licensed under the GNU LGPL 2.1 (see `COPYING`).

chmlib-ts itself is a regular dependency (CHM import). Its package exports do not include the LZX module, which
the LIT reader (`src/core/lit.ts`) needs on its own, hence this copy.
