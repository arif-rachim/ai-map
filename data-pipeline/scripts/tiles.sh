#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../config.env"
PMTILES="$WORK_DIR/tools/pmtiles"
mkdir -p "$OUT_DIR/tiles"

if [[ "$PROTOMAPS_BUILD" == "latest" ]]; then
  PROTOMAPS_BUILD=$(curl -fsSL https://build-metadata.protomaps.dev/builds.json \
    | node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(b.at(-1).key.replace(".pmtiles",""))')
fi
SRC="https://build.protomaps.com/${PROTOMAPS_BUILD}.pmtiles"
echo "source: $SRC"

tmp_world="$OUT_DIR/tiles/world.pmtiles.part"
"$PMTILES" extract "$SRC" "$tmp_world" --maxzoom="$WORLD_MAXZOOM" --download-threads=8
mv "$tmp_world" "$OUT_DIR/tiles/world.pmtiles"

tmp_region="$OUT_DIR/tiles/region.pmtiles.part"
if [[ -n "$REGION_BBOX" ]]; then
  "$PMTILES" extract "$SRC" "$tmp_region" --bbox="$REGION_BBOX" --maxzoom="$REGION_MAXZOOM" --download-threads=8
else
  [[ -f "$WORK_DIR/region.geojson" ]] || { echo "run the 'region' step first" >&2; exit 1; }
  "$PMTILES" extract "$SRC" "$tmp_region" --region="$WORK_DIR/region.geojson" --maxzoom="$REGION_MAXZOOM" --download-threads=8
fi
mv "$tmp_region" "$OUT_DIR/tiles/region.pmtiles"

mkdir -p "$OUT_DIR/meta"
cat > "$OUT_DIR/meta/tiles.json" <<JSON
{ "protomapsBuild": "$PROTOMAPS_BUILD", "regionMaxzoom": $REGION_MAXZOOM, "worldMaxzoom": $WORLD_MAXZOOM, "bbox": "$REGION_BBOX", "builtAt": "$(date -u +%FT%TZ)" }
JSON
ls -lh "$OUT_DIR/tiles"
