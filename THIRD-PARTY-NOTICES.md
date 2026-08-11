# Third-party notices

OTOWAD is licensed under GPL-3.0-or-later (see [LICENSE](LICENSE)).

## Why the project is GPL

The optional audio-import compatibility path bundles **FFmpeg/WASM**, whose core is
distributed under **GPL-2.0-or-later**. The shipped application therefore falls under GPL
as a whole. GPL-3.0 is permitted here because the FFmpeg core is licensed "or later".

The FFmpeg core is loaded only after the browser's native Web Audio decoder reports an
unsupported encoding. Common formats (WAV, MP3, AAC, FLAC) go through the browser and never
touch FFmpeg. The fallback is a lazily fetched asset, not part of the initial page load.

## Distributed at runtime

These files are served by the deployed application and are also present in this repository
under `ui/public/third-party/`:

| Component | Version | License | Notice |
| --- | --- | --- | --- |
| `@ffmpeg/core` | 0.12.10 | GPL-2.0-or-later | [ffmpeg-wasm-NOTICE.txt](ui/public/third-party/ffmpeg-wasm-NOTICE.txt) |
| `@ffmpeg/ffmpeg` | 0.12.15 | MIT | same notice |
| `@ffmpeg/types` | 0.12.4 | MIT | same notice |

[`ui/public/third-party/ffmpeg-wasm-NOTICE.txt`](ui/public/third-party/ffmpeg-wasm-NOTICE.txt)
records the upstream release tag, the exact source commit, the npm tarball integrity hashes,
and the SHA-256 of the WASM bytes, so the corresponding source for the distributed binary can
be located. [`ui/public/third-party/GPL-2.0.txt`](ui/public/third-party/GPL-2.0.txt) carries the
GPL v2 text that the FFmpeg core requires.

The build fails if either notice is missing, or if the raw FFmpeg WASM appears in the
distributed output (see `ui/scripts/check-ffmpeg-precache.mjs`).

## Build-time only

Development dependencies are **not distributed**, so their terms do not apply to the shipped
application. Two are worth naming because they are copyleft:

- `sharp` / `libvips` (LGPL-3.0-or-later) — generates PWA icons. Absent from `dist/`.
- `@pandacss/*` (no license field declared) — CSS codegen. Absent from `dist/`.

Every other dependency, in both the Rust and npm trees, is permissively licensed
(MIT, Apache-2.0, ISC, BSD, Zlib, MPL-2.0).

## Verifying this yourself

```bash
# Rust
cd core && cargo metadata --format-version 1 | \
  python3 -c "import json,sys;[print(p['license'],p['name']) for p in json.load(sys.stdin)['packages']]"

# npm — production dependencies only
cd ui && npm ls --omit=dev --all
```
