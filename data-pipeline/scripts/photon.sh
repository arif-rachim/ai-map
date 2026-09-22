#!/usr/bin/env bash
# Builds the Photon geocoder index from GraphHopper's prebuilt regional JSON dumps.
set -euo pipefail
source "$(dirname "$0")/../config.env"
BASE="https://download1.graphhopper.com/public"
DUMPS="$WORK_DIR/photon-dumps"
mkdir -p "$DUMPS" "$OUT_DIR/photon"

files=()
for d in $PHOTON_DUMPS; do
  name="photon-dump-$(basename "$d")-${PHOTON_DUMP_FORMAT}-latest.jsonl.zst"
  f="$DUMPS/$name"
  echo "download $d"
  if [[ -f "$f" ]]; then
    curl -fsSL -z "$f" -o "$f" "$BASE/$d/$name"   # re-download only if the server copy is newer
  else
    curl -fsSL -o "$f" "$BASE/$d/$name"
  fi
  expected=$(curl -fsSL "$BASE/$d/$name.md5" | awk '{print $1}')
  actual=$(md5sum "$f" | awk '{print $1}')
  [[ "$expected" == "$actual" ]] || { echo "md5 mismatch for $name" >&2; exit 1; }
  files+=("$f")
done

# Merge dumps: keep header + CountryInfo lines from the first file, then Place lines from all files.
merged="$WORK_DIR/photon-merged.jsonl"
{
  # head closes the pipe early; SIGPIPE on zstd is expected here.
  (set +o pipefail; zstd -dc "${files[0]}" | head -n 2)
  for f in "${files[@]}"; do zstd -dc "$f" | tail -n +3; done
} > "$merged"
echo "merged $(wc -l < "$merged") lines"

country_codes=$(echo "$REGION_COUNTRIES" | tr 'A-Z' 'a-z')
db="$WORK_DIR/photon-db"
rm -rf "$db"
docker run --rm -u "$(id -u):$(id -g)" \
  -v "$WORK_DIR:/work" -v "$WORK_DIR/tools:/tools:ro" \
  "$PHOTON_JAVA_IMAGE" \
  java -Xmx8g -jar "/tools/photon-${PHOTON_VERSION}.jar" import \
    -import-file /work/photon-merged.jsonl \
    -languages "$PHOTON_LANGUAGES" \
    -country-codes "$country_codes" \
    -data-dir /work/photon-db

# Ship as a single tar (easier to checksum and copy than thousands of index files).
tar -C "$WORK_DIR" -cf "$OUT_DIR/photon/photon-db.tar.part" photon-db
mv "$OUT_DIR/photon/photon-db.tar.part" "$OUT_DIR/photon/photon-db.tar"
cp "$WORK_DIR/tools/photon-${PHOTON_VERSION}.jar" "$OUT_DIR/photon/photon.jar"
rm -f "$merged"
ls -lh "$OUT_DIR/photon"
