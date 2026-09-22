#!/usr/bin/env bash
# Fonts (glyph PBFs incl. Arabic ranges) and sprites for the Protomaps basemap style.
set -euo pipefail
source "$(dirname "$0")/../config.env"
tmp="$WORK_DIR/basemaps-assets"
rm -rf "$tmp" && mkdir -p "$tmp"
curl -fL "https://codeload.github.com/protomaps/basemaps-assets/tar.gz/refs/heads/${BASEMAPS_ASSETS_REF}" | tar xz -C "$tmp" --strip-components=1
rm -rf "$OUT_DIR/assets" && mkdir -p "$OUT_DIR/assets"
# Upstream dedups some font folders with relative symlinks (e.g. Devanagari -> Noto Sans Regular).
# -L materialises them: exFAT/FAT media cannot store symlinks, and the installer only copies regular files.
cp -rL "$tmp/fonts" "$OUT_DIR/assets/fonts"
cp -rL "$tmp/sprites" "$OUT_DIR/assets/sprites"
du -sh "$OUT_DIR/assets"
