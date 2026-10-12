#!/usr/bin/env bash
# Fonts (glyph PBFs, English-only app: Arabic ranges removed) and sprites for the Protomaps basemap style.
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
# Arabic script blocks: U+0600-08FF and presentation forms U+FB50-FEFF (no Arabic UI or labels).
for range in 1536-1791 1792-2047 2048-2303 64256-64511 64512-64767 64768-65023 65024-65279; do
  find "$OUT_DIR/assets/fonts" -name "$range.pbf" -delete
done
du -sh "$OUT_DIR/assets"
