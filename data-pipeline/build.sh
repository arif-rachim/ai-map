#!/usr/bin/env bash
# Offline data build. Usage: ./build.sh [tools|region|tiles|photon|airports|assets|all]...
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
source "$HERE/config.env"
set +a
mkdir -p "$OUT_DIR" "$WORK_DIR/tools"

steps=("$@")
[[ ${#steps[@]} -eq 0 ]] && steps=(all)
[[ " ${steps[*]} " == *" all "* ]] && steps=(tools region tiles photon airports assets)

for step in "${steps[@]}"; do
  echo "==> $step"
  case "$step" in
    tools)    "$HERE/scripts/tools.sh" ;;
    region)   node "$HERE/scripts/region-polygon.mjs" ;;
    tiles)    "$HERE/scripts/tiles.sh" ;;
    photon)   "$HERE/scripts/photon.sh" ;;
    airports) "$HERE/scripts/airports.sh" ;;
    assets)   "$HERE/scripts/assets.sh" ;;
    terrain)  "$HERE/scripts/terrain.sh" ;;
    *) echo "unknown step: $step" >&2; exit 1 ;;
  esac
done
echo "==> done. Output in $OUT_DIR"
