#!/usr/bin/env bash
# Phase 2 (Transfer 2): terrain DEM tiles for hillshade, contours, 3D terrain and elevation queries.
set -euo pipefail
source "$(dirname "$0")/../config.env"
PMTILES="$WORK_DIR/tools/pmtiles"
[[ -f "$WORK_DIR/region.geojson" ]] || { echo "run the 'region' step first" >&2; exit 1; }
mkdir -p "$OUT_DIR/tiles" "$OUT_DIR/meta"

tmp="$OUT_DIR/tiles/terrain.pmtiles.part"
"$PMTILES" extract "$TERRAIN_SOURCE" "$tmp" --region="$WORK_DIR/region.geojson" --maxzoom="$TERRAIN_MAXZOOM" --download-threads=8
mv "$tmp" "$OUT_DIR/tiles/terrain.pmtiles"

# Source attribution required by the DEM providers (Copernicus etc.).
curl -fsSL -o "$OUT_DIR/meta/terrain-attribution.json" https://download.mapterhorn.com/attribution.json || echo "warning: attribution.json not downloaded" >&2
cat > "$OUT_DIR/meta/terrain.json" <<JSON
{ "source": "$TERRAIN_SOURCE", "maxzoom": $TERRAIN_MAXZOOM, "encoding": "terrarium", "builtAt": "$(date -u +%FT%TZ)" }
JSON
ls -lh "$OUT_DIR/tiles/terrain.pmtiles"
