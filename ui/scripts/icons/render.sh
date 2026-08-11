#!/usr/bin/env bash
# Rasterise the PWA icons from their SVG sources into ui/public/icons/.
#
# The PNGs are committed, so contributors only need this when the artwork
# actually changes. Requires rsvg-convert (librsvg).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/../../public/icons"
mkdir -p "$out"

if ! command -v rsvg-convert >/dev/null; then
  echo "rsvg-convert not found. Install librsvg (e.g. 'pacman -S librsvg')." >&2
  exit 1
fi

rsvg-convert -w 192 -h 192 "$here/icon.svg"          -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 "$here/icon.svg"          -o "$out/icon-512.png"
rsvg-convert -w 512 -h 512 "$here/icon-maskable.svg" -o "$out/icon-maskable-512.png"

# iOS ignores the manifest icons for the home screen and applies its own mask,
# which clips transparent corners to black. Flatten onto the app background so
# the rounded corners do not come back as black wedges.
rsvg-convert -w 180 -h 180 "$here/icon.svg" -o "$out/apple-touch-icon.png"
magick "$out/apple-touch-icon.png" -background '#070a18' -alpha remove -alpha off \
  "$out/apple-touch-icon.png"

echo "Wrote:"
ls -1 "$out"
