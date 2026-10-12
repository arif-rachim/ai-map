#!/usr/bin/env bash
# AI Map installer for an airgapped Ubuntu server with Docker. Everything it needs is inside this bundle.
#
#   sudo ./install.sh                    install or update with defaults (port 80, /opt/aimap)
#   sudo ./install.sh --port 8080        other HTTP port
#   options: --port N  --app-dir DIR  --data-root DIR  --public-url URL  --photon-heap 4g  --skip-verify  --yes
#
# Safe to re-run: drawings in the database are never touched; an existing .env (passwords) is kept.
set -euo pipefail

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/aimap
DATA_ROOT=""
PORT=""
PUBLIC_URL=""
PHOTON_HEAP=""
VERIFY=1
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --data-root) DATA_ROOT="$2"; shift 2 ;;
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --photon-heap) PHOTON_HEAP="$2"; shift 2 ;;
    --skip-verify) VERIFY=0; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
DATA_ROOT="${DATA_ROOT:-$APP_DIR/data}"

# ---- output helpers ------------------------------------------------------------------------------
if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
step() { echo "${B}==> $*${N}"; }
ok() { echo "    ${G}✓${N} $*"; }
warn() { echo "    ${Y}!${N} $*"; WARNINGS+=("$*"); }
die() { echo "${R}ERROR:${N} $*" >&2; exit 1; }
WARNINGS=()
human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 bytes"; }
json_field() { sed -n "s/^  \"$1\": \"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}$/\1/p" "$BUNDLE/manifest.json" | head -1; }

[[ -f "$BUNDLE/manifest.json" && -f "$BUNDLE/SHA256SUMS" ]] || die "manifest.json / SHA256SUMS not found next to install.sh; run it from inside the bundle folder"
TYPE=$(json_field type)
BUNDLE_VERSION=$(json_field version)
BUNDLE_ARCH=$(json_field arch)
REQUIRED_DISK=$(json_field requiredDiskBytes)

echo "${B}AI Map installer${N} — bundle ${TYPE} ${BUNDLE_VERSION} (${BUNDLE_ARCH:-amd64})"
echo "    app dir: $APP_DIR    data: $DATA_ROOT"

# ---- 1. preflight ---------------------------------------------------------------------------------
step "Checking the server"
if [[ $EUID -ne 0 ]]; then
  mkdir -p "$APP_DIR" "$DATA_ROOT" 2>/dev/null && [[ -w "$APP_DIR" && -w "$DATA_ROOT" ]] || die "run with sudo (or choose writable --app-dir/--data-root)"
  warn "not running as root: the aimapctl command will not be installed system-wide"
fi

# Read os-release in a subshell: it defines VERSION, ID, ... which must not leak into this script.
os_id=$( (. /etc/os-release 2>/dev/null; echo "${ID:-}") )
os_name=$( (. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown OS}") )
if [[ "$os_id" == ubuntu ]]; then
  ok "$os_name"
else
  warn "this installer is tested on Ubuntu; detected $os_name"
fi

case "$(uname -m)" in x86_64) HOST_ARCH=amd64 ;; aarch64|arm64) HOST_ARCH=arm64 ;; *) HOST_ARCH=$(uname -m) ;; esac
[[ "$HOST_ARCH" == "${BUNDLE_ARCH:-amd64}" ]] || die "bundle is for ${BUNDLE_ARCH}, this server is ${HOST_ARCH}"
ok "architecture $HOST_ARCH"

command -v docker >/dev/null || die "Docker is not installed. Install Docker Engine (e.g. from offline .deb packages) first."
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon (is it running? are you root or in the docker group?)"
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
  ok "Docker Compose plugin $(docker compose version --short 2>/dev/null)"
elif command -v docker-compose >/dev/null && docker-compose version 2>/dev/null | grep -q 'v2\|version 2\|v[3-9]'; then
  COMPOSE=(docker-compose)
  ok "docker-compose $(docker-compose version --short 2>/dev/null)"
else
  [[ -x "$BUNDLE/bin/docker-compose" ]] || die "Docker Compose v2 is missing and the bundle has no bin/docker-compose"
  if [[ $EUID -eq 0 ]]; then
    install -D -m 0755 "$BUNDLE/bin/docker-compose" /usr/local/lib/docker/cli-plugins/docker-compose
    COMPOSE=(docker compose)
    ok "installed bundled Docker Compose plugin $(docker compose version --short)"
  else
    # Kept next to the app (not in the bundle folder, which may be deleted) so aimapctl can use it too.
    mkdir -p "$APP_DIR/bin"
    install -m 0755 "$BUNDLE/bin/docker-compose" "$APP_DIR/bin/docker-compose"
    COMPOSE=("$APP_DIR/bin/docker-compose")
    warn "using bundled docker-compose in $APP_DIR/bin (not installed system-wide)"
  fi
fi
compose() { (cd "$APP_DIR" && "${COMPOSE[@]}" "$@"); }

mkdir -p "$APP_DIR" "$DATA_ROOT"
if [[ -d "$BUNDLE/data" && -n "$REQUIRED_DISK" && "$REQUIRED_DISK" != 0 ]]; then
  free=$(df -B1 --output=avail "$DATA_ROOT" | tail -1)
  (( free > REQUIRED_DISK )) || die "not enough disk space for $DATA_ROOT: need $(human "$REQUIRED_DISK"), free $(human "$free")"
  ok "disk space for data: $(human "$free") free, $(human "$REQUIRED_DISK") needed"
fi
if [[ -f "$BUNDLE/images.tar" ]]; then
  docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
  need=$(( $(stat -c %s "$BUNDLE/images.tar") * 5 / 2 ))
  free=$(df -B1 --output=avail "$docker_root" 2>/dev/null | tail -1 || echo 0)
  (( free > need )) || die "not enough disk space for Docker images in $docker_root: need $(human "$need"), free $(human "$free")"
  ok "disk space for images: $(human "$free") free in $docker_root"
fi

mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
mem_gb=$(( mem_kb / 1024 / 1024 ))
(( mem_gb >= 8 )) && ok "memory ${mem_gb} GB" || warn "only ${mem_gb} GB RAM; 16 GB or more is recommended"
cpus=$(nproc)
(( cpus >= 4 )) && ok "$cpus CPUs" || warn "only $cpus CPUs; 4 or more are recommended"

existing_port=$(sed -n 's/^HTTP_PORT=//p' "$APP_DIR/.env" 2>/dev/null || true)
PORT="${PORT:-${existing_port:-80}}"
if ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .; then
  if docker ps --format '{{.Names}} {{.Ports}}' | grep -q "aimap-web.*:$PORT->"; then
    ok "port $PORT is used by the current AI Map installation (will be updated)"
  else
    die "port $PORT is already in use by another program; choose one with --port"
  fi
else
  ok "port $PORT is free"
fi

if [[ $ASSUME_YES -eq 0 && -t 0 ]]; then
  read -r -p "Continue with the installation? [Y/n] " answer
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]] || die "cancelled"
fi

# ---- 2. verify ------------------------------------------------------------------------------------
if [[ $VERIFY -eq 1 ]]; then
  step "Verifying bundle integrity (this can take several minutes for large bundles)"
  (cd "$BUNDLE" && sha256sum --quiet -c SHA256SUMS) || die "checksum mismatch: the bundle is damaged or incomplete; copy it again"
  ok "all files intact"
else
  warn "checksum verification skipped (--skip-verify)"
fi

# ---- 3. images ------------------------------------------------------------------------------------
if [[ -f "$BUNDLE/images.tar" ]]; then
  step "Loading Docker images"
  docker load -i "$BUNDLE/images.tar" | sed 's/^/    /'
fi

# ---- 4. configuration -----------------------------------------------------------------------------
step "Writing configuration to $APP_DIR"
install -m 0644 "$BUNDLE/docker-compose.yml" "$APP_DIR/docker-compose.yml"
install -m 0755 "$BUNDLE/aimapctl" "$APP_DIR/aimapctl"
install -m 0644 "$BUNDLE/manifest.json" "$APP_DIR/installed-$TYPE-$BUNDLE_VERSION.json"

random_secret() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
set_env() {
  local key="$1" value="$2" file="$APP_DIR/.env"
  if grep -q "^$key=" "$file"; then sed -i "s|^$key=.*|$key=$value|" "$file"; else echo "$key=$value" >> "$file"; fi
}
if [[ ! -f "$APP_DIR/.env" ]]; then
  if [[ -z "$PHOTON_HEAP" ]]; then
    heap=$(( mem_gb / 6 )); (( heap < 2 )) && heap=2; (( heap > 8 )) && heap=8
    PHOTON_HEAP="${heap}g"
  fi
  cat > "$APP_DIR/.env" <<ENV
# AI Map configuration (created by install.sh $BUNDLE_VERSION). Apply changes with: aimapctl restart
DATA_ROOT=$DATA_ROOT
HTTP_PORT=$PORT
POSTGRES_PASSWORD=$(random_secret)
PHOTON_HEAP=$PHOTON_HEAP
# UID/GID owning DATA_ROOT/photon (the geocoder writes runtime files there).
AIMAP_UID=1000
AIMAP_GID=1000
# Optional base URL used in API links (TileJSON, styles, OGC), e.g. http://maps.example.local
PUBLIC_URL=$PUBLIC_URL
AIMAP_VERSION=latest
ENV
  chmod 600 "$APP_DIR/.env"
  ok "created .env with a generated database password"
else
  set_env HTTP_PORT "$PORT"
  set_env DATA_ROOT "$DATA_ROOT"
  [[ -n "$PUBLIC_URL" ]] && set_env PUBLIC_URL "$PUBLIC_URL"
  [[ -n "$PHOTON_HEAP" ]] && set_env PHOTON_HEAP "$PHOTON_HEAP"
  ok "kept existing .env (passwords unchanged)"
fi
if [[ -f "$BUNDLE/images.tar" ]]; then set_env AIMAP_VERSION "$BUNDLE_VERSION"; fi
set -a; . "$APP_DIR/.env"; set +a

if [[ $EUID -eq 0 ]]; then
  ln -sf "$APP_DIR/aimapctl" /usr/local/bin/aimapctl
  ok "installed the aimapctl command"
fi

# ---- 5. data --------------------------------------------------------------------------------------
photon_changed=0
if [[ -d "$BUNDLE/data" ]] && [[ -n "$(ls -A "$BUNDLE/data")" ]]; then
  step "Installing map data into $DATA_ROOT"
  while IFS= read -r -d '' f; do
    rel="${f#"$BUNDLE/data/"}"
    if [[ "$rel" == photon/photon-db.tar ]]; then
      photon_changed=1
      rm -rf "$DATA_ROOT/photon/photon-db.new" && mkdir -p "$DATA_ROOT/photon/photon-db.new"
      echo "    extracting geocoder index ($(human "$(stat -c %s "$f")"))"
      tar -xf "$f" -C "$DATA_ROOT/photon/photon-db.new" --strip-components=1
    else
      # Copy next to the target, then rename: running services never see a half-written file.
      mkdir -p "$DATA_ROOT/$(dirname "$rel")"
      size=$(stat -c %s "$f")
      (( size > 100000000 )) && echo "    copying $rel ($(human "$size"))"
      cp "$f" "$DATA_ROOT/$rel.new"
      mv -f "$DATA_ROOT/$rel.new" "$DATA_ROOT/$rel"
    fi
  done < <(find "$BUNDLE/data" -type f -print0)
  ok "data installed"
fi

if [[ $photon_changed -eq 1 ]]; then
  compose stop photon >/dev/null 2>&1 || true
  rm -rf "$DATA_ROOT/photon/photon-db.old"
  [[ -d "$DATA_ROOT/photon/photon-db" ]] && mv "$DATA_ROOT/photon/photon-db" "$DATA_ROOT/photon/photon-db.old"
  mv "$DATA_ROOT/photon/photon-db.new" "$DATA_ROOT/photon/photon-db"
  rm -rf "$DATA_ROOT/photon/photon-db.old"
fi
if [[ -d "$DATA_ROOT/photon" ]]; then
  chown -R "${AIMAP_UID:-1000}:${AIMAP_GID:-1000}" "$DATA_ROOT/photon" 2>/dev/null || warn "could not chown $DATA_ROOT/photon to ${AIMAP_UID:-1000}; the geocoder may fail to start"
fi

# ---- 6. start ---------------------------------------------------------------------------------------
step "Starting services"
compose up -d --remove-orphans 2>&1 | sed 's/^/    /'
if [[ "$TYPE" == update && -f "$BUNDLE/data/airports/airports.csv" ]]; then
  # Airports are imported only into an empty table; force a re-import of the refreshed file.
  compose exec -T db psql -U aimap -d aimap -c 'TRUNCATE airports' >/dev/null && compose restart api >/dev/null
fi

step "Waiting for the application to become healthy"
url="http://127.0.0.1:$PORT"
fetch() { if command -v curl >/dev/null; then curl -fsS --max-time 5 "$1"; else wget -qO- --timeout=5 "$1"; fi; }
healthy=0
for _ in $(seq 1 120); do
  if fetch "$url/api/v1/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 5
done
[[ $healthy -eq 1 ]] || { compose ps; die "the application did not become healthy within 10 minutes; see: aimapctl logs"; }
ok "web and API are up"

caps=""
for _ in $(seq 1 60); do
  caps=$(fetch "$url/api/v1/capabilities" 2>/dev/null || true)
  [[ "$caps" == *'"geocoder":true'* || -z "$(ls -A "$DATA_ROOT/photon" 2>/dev/null)" ]] && break
  sleep 5
done
check() { [[ "$caps" == *"\"$1\":true"* ]] && ok "$2" || warn "$2: not available"; }
check region "detailed map tiles"
check world "world overview tiles"
check terrain "terrain (hillshade, contours, 3D, elevation)"
check geocoder "address and place search"

# ---- summary ---------------------------------------------------------------------------------------
echo
echo "${G}${B}AI Map $BUNDLE_VERSION is running.${N}"
ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -v '^172\.\(1[6-9]\|2[0-9]\|3[01]\)\.' || true)
suffix=$([[ "$PORT" == 80 ]] && echo "" || echo ":$PORT")
for ip in ${ips:-127.0.0.1}; do
  echo "    Map:          http://$ip$suffix/map"
done
first_ip=$(echo "${ips:-127.0.0.1}" | head -1)
echo "    Start page:   http://$first_ip$suffix/   (tutorial and documentation)"
echo "    API docs:     http://$first_ip$suffix/api/v1/docs/"
echo "    Integration:  http://$first_ip$suffix/sdk/examples/"
echo
echo "    Manage with:  aimapctl status | logs | restart | backup | health   (in $APP_DIR)"
if (( ${#WARNINGS[@]} )); then
  echo
  echo "${Y}Warnings:${N}"
  printf '    - %s\n' "${WARNINGS[@]}"
fi
