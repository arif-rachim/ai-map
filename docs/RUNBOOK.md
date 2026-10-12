# Runbook: build, transfer, install, update

Two machines are involved:

- **Build machine** (internet): Linux, Docker, Node 24, `zstd`, `curl`, ~40 GB free disk, 16 GB RAM.
- **Airgapped server**: Linux, Docker with Compose v2, ≥8 cores, ≥32 GB RAM, ≥500 GB SSD.

Transfer medium limit: **50 GB per trip** (enforced by `make-bundle.sh`, override with `BUNDLE_MAX_GB`).

## 1. Build data (build machine)

```bash
npm install
cd data-pipeline
./build.sh all        # tools region tiles photon airports assets
```

Output in `dist-data/`:

| File | Source | Measured size (Sep 2026) |
|---|---|---|
| `tiles/region.pmtiles` | Protomaps daily planet, z0–15, clipped to the region polygon (+25 km buffer) | 5.3 GB |
| `tiles/world.pmtiles` | Protomaps daily planet, z0–7 | 180 MB |
| `tiles/terrain.pmtiles` (phase 2, `./build.sh terrain`) | Mapterhorn terrain (Copernicus DEM and others), Terrarium webp, z0–12, clipped to the region | 16 GB |
| `photon/photon-db.tar` | GraphHopper Photon 1.0 JSON dumps (en, ar), imported with Photon | 3.2 GB |
| `airports/airports.csv` | OurAirports | 12 MB |
| `assets/` | Protomaps fonts (incl. Arabic glyphs) and sprites | 15 MB |
| `meta/` | Region polygon, build info | small |

Settings live in `data-pipeline/config.env` (countries, zoom levels, languages, versions). Each step can be re-run on its own, e.g. `./build.sh tiles`.

## 2. Make a bundle (build machine)

```bash
cd deploy
./make-bundle.sh full      # everything in one bundle (~27 GB): app + base images + map + geocoder + terrain
./make-bundle.sh mvp       # without terrain (~10 GB)
./make-bundle.sh terrain   # app + terrain only (~17 GB)
./make-bundle.sh update    # later: app + refreshed map data (no base images)
./make-bundle.sh app       # code-only update (~100 MB)
```

The bundle folder `bundles/aimap-<type>-<version>/` is self-contained: `install.sh`, `aimapctl`, `INSTALL.txt`,
`docker-compose.yml`, `images.tar`, `data/`, `bin/docker-compose` (used only if the server lacks Compose v2),
`manifest.json` (sizes, disk space needed, data versions) and `SHA256SUMS`. The script builds and smoke-tests the images,
checks the 50 GB limit and fails before copying anything if it would be exceeded. Copy the whole folder to the medium.

## 3. Install / update (airgapped Ubuntu server with Docker)

```bash
cd /path/to/aimap-full-<version>
sudo ./install.sh                  # options: --port 8080 --app-dir /opt/aimap --data-root /data/aimap --public-url http://maps.local --yes
```

The installer:

1. checks the server: Ubuntu, CPU architecture, Docker running, Docker Compose (installs the bundled plugin if missing),
   free disk space for data and images, RAM/CPU, and that the HTTP port is free;
2. verifies every file against `SHA256SUMS`;
3. loads the Docker images;
4. writes `/opt/aimap/.env` with a random database password (kept on later runs) and a geocoder heap sized to the RAM;
5. copies map data atomically and swaps the geocoder index;
6. starts the services and waits until they are healthy, then reports which datasets are available;
7. prints the URLs and installs the `aimapctl` command.

Re-running with a newer bundle updates in place; drawings in the `aimap_pgdata` volume are never touched.

### Operations

```bash
aimapctl status            # containers + health
aimapctl health            # which datasets are installed
aimapctl logs api          # follow logs (web, api, db, photon)
aimapctl restart           # apply .env changes
aimapctl backup            # /opt/aimap/backups/aimap-<date>.dump
aimapctl restore FILE
aimapctl version
aimapctl uninstall [--purge]
```

## 4. Verify

- Status bar shows **Live** (WebSocket connected).
- `curl http://<server>/api/capabilities` → `{"region":true,"world":true,"terrain":false,"geocoder":true}`.
- Search `DXB`, `Riyadh`, `دبي`, `24.7136, 46.6753`, an MGRS grid reference (results are shown in English).
- Browser dev tools → Network: no request to any external host.
- `http://<server>/` shows the start page (tutorial and documentation); the map is at `http://<server>/map`.
- Integration endpoints: `http://<server>/api/v1/docs/` (API reference), `http://<server>/sdk/examples/` (embed and MapLibre examples), `http://<server>/api/v1/ogc` (GIS). See [INTEGRATION.md](INTEGRATION.md).
- If other systems reach the server under a different name than browsers do (e.g. through another proxy), set `PUBLIC_URL=http://<name>` for the `api` service so TileJSON/style/OGC links use it.
- With terrain: `capabilities` shows `"terrain":true`; the toolbar has hillshade / contour / 3D toggles, the status bar shows elevation under the cursor, and distance measurements show an elevation profile.

## Backup

Only the drawings need backup (map data can be rebuilt): `aimapctl backup`, restore with `aimapctl restore FILE`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Grey map | `ls /opt/aimap/data/tiles`; `docker compose logs web` |
| Address search says unavailable | `docker compose logs photon`; ownership of `/opt/aimap/data/photon` must match `AIMAP_UID` |
| Status "Reconnecting…" | `docker compose logs api`; database health |
| Airport search empty | API imports `airports.csv` only into an empty table; `update` bundles truncate it automatically |
