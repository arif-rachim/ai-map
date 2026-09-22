#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../config.env"
mkdir -p "$OUT_DIR/airports"
curl -fL -o "$OUT_DIR/airports/airports.csv.part" https://davidmegginson.github.io/ourairports-data/airports.csv
mv "$OUT_DIR/airports/airports.csv.part" "$OUT_DIR/airports/airports.csv"
ls -lh "$OUT_DIR/airports"
