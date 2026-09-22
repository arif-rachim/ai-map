#!/usr/bin/env bash
# Builds a self-contained transfer bundle for an airgapped Ubuntu + Docker server. Run on the ONLINE build machine.
#
#   ./make-bundle.sh full     everything: app + base images + map tiles + geocoder + airports + assets + terrain
#   ./make-bundle.sh mvp      same as full without terrain
#   ./make-bundle.sh terrain  app images (terrain support) + terrain DEM tiles
#   ./make-bundle.sh update   app images + refreshed map data (tiles, geocoder, airports, assets)
#   ./make-bundle.sh app      app images only (code update, no data)
#
# Output: bundles/aimap-<type>-<version>/ — copy the whole folder to the medium, then on the server:
#   cd aimap-<type>-<version> && sudo ./install.sh
set -euo pipefail
TYPE="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${DATA_DIR:-$ROOT/dist-data}"
MAX_GB="${BUNDLE_MAX_GB:-50}"
VERSION="${AIMAP_VERSION:-$(date -u +%Y%m%d%H%M)}"
ARCH="${TARGET_ARCH:-amd64}"
COMPOSE_VERSION="${COMPOSE_VERSION:-v5.5.1}"
BASE_IMAGES=(postgis/postgis:16-3.5 eclipse-temurin:21-jre)
MAP_DATA=(tiles/world.pmtiles tiles/region.pmtiles photon/photon-db.tar photon/photon.jar airports/airports.csv assets meta)

usage() { sed -n '2,13p' "$0"; exit 1; }
case "$TYPE" in
  full)    with_images=1; with_base=1; data_files=("${MAP_DATA[@]}" tiles/terrain.pmtiles) ;;
  mvp)     with_images=1; with_base=1; data_files=("${MAP_DATA[@]}") ;;
  update)  with_images=1; with_base=0; data_files=("${MAP_DATA[@]}") ;;
  app)     with_images=1; with_base=0; data_files=() ;;
  terrain) with_images=1; with_base=0; data_files=(tiles/terrain.pmtiles meta) ;;
  *) usage ;;
esac
case "$ARCH" in amd64) compose_arch=x86_64 ;; arm64) compose_arch=aarch64 ;; *) echo "unsupported TARGET_ARCH $ARCH" >&2; exit 1 ;; esac

for cmd in docker node sha256sum curl; do
  command -v "$cmd" >/dev/null || { echo "missing required command: $cmd" >&2; exit 1; }
done

OUT="$ROOT/bundles/aimap-$TYPE-$VERSION"
[[ -e "$OUT" ]] && { echo "$OUT already exists" >&2; exit 1; }

# Check data exists and fits before doing expensive work.
total=0
for f in "${data_files[@]}"; do
  [[ -e "$DATA/$f" ]] || { echo "missing $DATA/$f - run data-pipeline/build.sh first" >&2; exit 1; }
  total=$((total + $(du -sbL "$DATA/$f" | cut -f1)))
done
data_total=$total
limit=$((MAX_GB * 1000 * 1000 * 1000))
if (( total > limit )); then
  echo "data alone is $((total / 1000 / 1000)) MB, over the ${MAX_GB} GB limit" >&2
  exit 1
fi

mkdir -p "$OUT/data" "$OUT/bin"
trap 'echo "bundle failed; removing $OUT" >&2; rm -rf "$OUT"' ERR

if [[ $with_images == 1 ]]; then
  echo "==> building images (version $VERSION, linux/$ARCH)"
  # Cross-building needs BuildKit/buildx; a same-architecture build works with any Docker builder.
  host_arch=$(docker info --format '{{.Architecture}}' | sed 's/x86_64/amd64/; s/aarch64/arm64/')
  platform_args=()
  [[ "$host_arch" != "$ARCH" ]] && platform_args=(--platform "linux/$ARCH")
  docker build "${platform_args[@]}" -f "$ROOT/deploy/Dockerfile.api" -t "aimap-api:$VERSION" -t aimap-api:latest "$ROOT"
  docker build "${platform_args[@]}" -f "$ROOT/deploy/Dockerfile.web" -t "aimap-web:$VERSION" -t aimap-web:latest "$ROOT"

  echo "==> smoke-testing api image"
  # Without a database the API must fail on the connection, never on loading its own bundle.
  smoke=$(timeout 30 docker run --rm -e DATABASE_URL=postgres://smoke:smoke@127.0.0.1:1/smoke "aimap-api:$VERSION" 2>&1 || true)
  if grep -qE "SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find (module|package)|ReferenceError" <<<"$smoke"; then
    echo "$smoke" | tail -20 >&2
    echo "api image failed to start" >&2
    exit 1
  fi
  grep -q "ECONNREFUSED" <<<"$smoke" || { echo "$smoke" | tail -20 >&2; echo "unexpected api smoke-test output" >&2; exit 1; }

  images=("aimap-api:$VERSION" "aimap-api:latest" "aimap-web:$VERSION" "aimap-web:latest")
  if [[ $with_base == 1 ]]; then
    for img in "${BASE_IMAGES[@]}"; do docker pull --platform "linux/$ARCH" "$img"; done
    images+=("${BASE_IMAGES[@]}")
  fi
  echo "==> saving images"
  docker save -o "$OUT/images.tar" "${images[@]}"
  total=$((total + $(stat -c %s "$OUT/images.tar")))
fi

# Docker Compose v2 as a standalone binary, installed by install.sh only if the server lacks the plugin.
compose_cache="$ROOT/work/tools/docker-compose-$COMPOSE_VERSION-$compose_arch"
if [[ ! -x "$compose_cache" ]]; then
  echo "==> downloading docker compose $COMPOSE_VERSION ($compose_arch)"
  mkdir -p "$ROOT/work/tools"
  curl -fL -o "$compose_cache.part" "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$compose_arch"
  chmod +x "$compose_cache.part" && mv "$compose_cache.part" "$compose_cache"
fi
cp "$compose_cache" "$OUT/bin/docker-compose"

echo "==> bundle size: $((total / 1000 / 1000)) MB (limit ${MAX_GB} GB)"
if (( total > limit )); then
  echo "bundle exceeds ${MAX_GB} GB; use separate 'mvp' and 'terrain' bundles or raise BUNDLE_MAX_GB" >&2
  exit 1
fi

echo "==> copying data"
for f in "${data_files[@]}"; do
  mkdir -p "$OUT/data/$(dirname "$f")"
  # -L, never -r alone: the bundle must stay symlink-free so it can be copied to exFAT/FAT media,
  # and so the checksum pass below (find -type f) covers every file it ships.
  cp -rL "$DATA/$f" "$OUT/data/$f"
done
if [[ -n "$(find "$OUT" -type l -print -quit)" ]]; then
  echo "bundle contains symlinks, which do not survive a copy to exFAT/FAT media:" >&2
  find "$OUT" -type l -printf '  %p -> %l\n' >&2
  exit 1
fi
cp "$ROOT/deploy/install.sh" "$ROOT/deploy/aimapctl" "$ROOT/deploy/docker-compose.yml" "$ROOT/deploy/.env.example" "$OUT/"
chmod +x "$OUT/install.sh" "$OUT/aimapctl"
sed -e "s/{{TYPE}}/$TYPE/g" -e "s/{{VERSION}}/$VERSION/g" "$ROOT/deploy/INSTALL.txt" > "$OUT/INSTALL.txt"

echo "==> checksums"
(cd "$OUT" && find . -type f ! -name SHA256SUMS ! -name manifest.json -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
node -e '
  const fs = require("fs"), path = require("path");
  const [out, type, version, arch, dataBytes] = process.argv.slice(1);
  const files = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => {
    const [sha256, file] = l.split(/\s+\.\//);
    return { file, sha256, bytes: fs.statSync(path.join(out, file)).size };
  });
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(out, "data/meta", f), "utf8")); } catch { return undefined; } };
  const manifest = {
    type, version, arch, createdAt: new Date().toISOString(),
    totalBytes: files.reduce((a, f) => a + f.bytes, 0),
    // Space the installation needs on the server: data (the geocoder tar is extracted, about the same size again) + images.
    requiredDiskBytes: Math.round(Number(dataBytes) * 1.25 + files.filter((f) => f.file === "images.tar").reduce((a, f) => a + f.bytes * 2.5, 0)),
    tiles: read("tiles.json"), terrain: read("terrain.json"),
    files,
  };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
' "$OUT" "$TYPE" "$VERSION" "$ARCH" "$data_total"
trap - ERR
du -sh "$OUT"
echo "==> bundle ready: $OUT"
echo "    copy the folder to the server, then: cd $(basename "$OUT") && sudo ./install.sh"
