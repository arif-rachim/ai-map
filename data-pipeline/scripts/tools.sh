#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../config.env"
T="$WORK_DIR/tools"
mkdir -p "$T"

for cmd in curl zstd docker node sha256sum; do
  command -v "$cmd" >/dev/null || { echo "missing required command: $cmd" >&2; exit 1; }
done

if ! "$T/pmtiles" version 2>/dev/null | grep -q "$PMTILES_VERSION"; then
  curl -fL "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz" \
    | tar xz -C "$T" pmtiles
fi
"$T/pmtiles" version

if [[ ! -f "$T/photon-${PHOTON_VERSION}.jar" ]]; then
  curl -fL -o "$T/photon-${PHOTON_VERSION}.jar.part" \
    "https://github.com/komoot/photon/releases/download/${PHOTON_VERSION}/photon-${PHOTON_VERSION}.jar"
  mv "$T/photon-${PHOTON_VERSION}.jar.part" "$T/photon-${PHOTON_VERSION}.jar"
fi
docker pull "$PHOTON_JAVA_IMAGE" >/dev/null
echo "tools ready in $T"
