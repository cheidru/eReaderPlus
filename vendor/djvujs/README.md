# DjVu.js library (vendored)

`djvu.js` is the unmodified release build of the DjVu.js Library 0.5.4 by Dmitry Kulikov (RussCoder),
from https://github.com/RussCoder/djvujs/releases/tag/L.0.5.4_V.0.10.1
(SHA-256 `10a831d62cc7ced39c30c7350a11410402d082a0f0a5b073a88d3d7ca662add3`).

The library is licensed under the GNU General Public License, version 2 or (at your option) any later version.
See `LICENSE.md` and `GNU_GPL_v2`. Source: https://github.com/RussCoder/djvujs/tree/master/library/src

Because the app ships this library, distributed builds of eReaderPlus are subject to the GPL.

`scripts/build-inject.mjs` copies it to `__ereader__/djvu.js`, where both the app (DjVu import) and DjVu page
documents (rendering) load it.
