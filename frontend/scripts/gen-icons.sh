#!/usr/bin/env bash
# Regenerate committed PWA icons from the source SVGs. Needs librsvg + imagemagick
# (`brew install librsvg imagemagick`). Run from frontend/: `bash scripts/gen-icons.sh`
# (or `just icons`). Square, never pre-rounded — iOS/Android round icons themselves.
set -euo pipefail
cd "$(dirname "$0")/../static"

BG="#0f0f0f"
rsvg-convert -w 192 -h 192 -b "$BG" favicon.svg       -o icon-192.png
rsvg-convert -w 512 -h 512 -b "$BG" favicon.svg       -o icon-512.png
rsvg-convert -w 32  -h 32  -b "$BG" favicon.svg       -o favicon-32.png
rsvg-convert -w 192 -h 192 -b "$BG" icon-maskable.svg -o icon-192-maskable.png
rsvg-convert -w 512 -h 512 -b "$BG" icon-maskable.svg -o icon-512-maskable.png
# apple-touch-icon: opaque, no alpha (Apple guidance), square.
rsvg-convert -w 180 -h 180 -b "$BG" favicon.svg -o /tmp/dice-ati.png
magick /tmp/dice-ati.png -background "$BG" -flatten -alpha off -type TrueColor PNG24:apple-touch-icon.png
echo "icons regenerated in $(pwd)"
