# AI Map — offline vector map for airgapped networks

AI Map is a self-hosted web map for closed, airgapped networks, where online map services cannot be reached. It serves a detailed vector basemap for the GCC, North Africa, the Levant, Iraq, Iran, Turkey, Yemen and Sudan (plus the rest of the world at low detail), and adds search for places, addresses, airports and coordinates, distance and area measurement with elevation profiles, terrain (hillshade, contours and 3D), and shared real-time drawing with MIL-STD-2525D/E military symbols. All map data is prepared in advance on an internet-connected build machine, packed into a transfer bundle and installed on the offline server with one script, so no request ever leaves the server at run time. The frontend is React with MapLibre GL reading PMTiles, the backend is Fastify on PostgreSQL/PostGIS with a Photon geocoder, and the whole stack runs in Docker Compose behind nginx. Other applications can embed the map in an iframe, drive it through a JavaScript SDK, or use its REST, WebSocket, TileJSON and OGC API - Features endpoints.

> Status: early development (single initial commit, September 2026). The API has no authentication and is meant for a trusted LAN.

## Features

- Offline vector basemap from Protomaps PMTiles: region at zoom 0 to 15, world at zoom 0 to 7, with light and dark styles
- Unified search: places and addresses (Photon), airports (OurAirports, by name or ICAO/IATA code) and typed coordinates
- Measurement of distance and area, with elevation profiles sampled from the terrain tiles
- Terrain layer (phase 2 data): hillshade, contour lines and 3D terrain
- Shared drawing layers stored in PostGIS; changes are broadcast to all open clients over WebSocket
- MIL-STD-2525D/E symbols rendered with milsymbol
- Import GeoJSON into a layer; export a layer as GeoJSON or KML
- English-only interface, map labels and search results
- Integration: iframe embed with a postMessage SDK, REST API with OpenAPI docs, WebSocket events, TileJSON/vector tiles and OGC API - Features
- Deployment as one self-contained bundle installed with `sudo ./install.sh`; update bundles for app code or map data only

## Tech stack

TypeScript · React · MapLibre GL · PMTiles · Terra Draw · turf · milsymbol · i18next · Vite · Fastify · PostgreSQL/PostGIS · Photon · Docker Compose · nginx · Vitest · Playwright


| Part | Tech |
|---|---|
| `apps/web` | React + MapLibre GL + PMTiles, Terra Draw, turf, milsymbol, i18next (English) |
| `apps/api` | Fastify + PostgreSQL/PostGIS: `/api/v1` REST + OpenAPI, WebSocket events, unified search, elevation, tiles/styles, OGC API - Features |
| `packages/shared` | Schemas, coordinates, measurement, basemap style builder, elevation sampling, GeoJSON/KML, embed protocol |
| `packages/sdk` | `aimap-sdk.js` for other apps: REST/WebSocket client, iframe embed controller, MapLibre drawings layer |
| `data-pipeline` | Builds offline data on an internet-connected machine |
| `deploy` | Dockerfiles, nginx, docker-compose, transfer bundle + installer |

## Project structure

```text
apps/api/          Fastify server: routes/ (core, services, tiles, exchange, ogc), PostGIS repo, WebSocket hub, migrations/
apps/web/          React + MapLibre client: components/ (map, search, measure, layers, symbols), lib/ (basemap, terrain, embed bridge)
packages/shared/   code shared by web, API and SDK (schemas, coordinates, measurement, style builder, export)
packages/sdk/      aimap-sdk.js and examples/ (embed, MapLibre, tutorial)
data-pipeline/     build.sh and scripts/ that download and build the offline data (config.env holds the settings)
deploy/            Dockerfiles, docker-compose.yml, nginx.conf, make-bundle.sh, install.sh, aimapctl
docs/              INTEGRATION, RUNBOOK, TUTORIAL, GIS-CHECKLIST
e2e/               Playwright browser tests
```

## Development

Requirements: Node 24, Docker.

API environment variables: `PORT`, `HOST`, `DATABASE_URL`, `DATA_DIR`, `PHOTON_URL`, `PUBLIC_URL`, `MIGRATIONS_DIR`. Deployment settings (`deploy/.env.example`): `DATA_ROOT`, `HTTP_PORT`, `POSTGRES_PASSWORD`, `PHOTON_HEAP`, `AIMAP_UID`, `AIMAP_GID`, `AIMAP_VERSION`, `PUBLIC_URL`.

```bash
npm install
cd data-pipeline && ./build.sh tools region tiles airports assets   # add "photon" for address search
docker run -d --name aimap-db -e POSTGRES_USER=aimap -e POSTGRES_PASSWORD=aimap -e POSTGRES_DB=aimap -p 5432:5432 postgis/postgis:16-3.5
DATA_DIR=../../dist-data npm run dev:api     # http://localhost:3000
npm run dev:web                              # http://localhost:5173
```

Quick dev extract instead of the whole region: `REGION_BBOX=54.2,24.2,55.7,25.5 ./build.sh tiles`.

Photon for local dev (after `./build.sh photon`):
`docker run -d -p 2322:2322 -v $PWD/dist-data/photon:/p -v $PWD/work/photon-db:/db eclipse-temurin:21-jre java -jar /p/photon.jar serve -data-dir /db -listen-ip 0.0.0.0`

Build the SDK once before `dev:web` so `/sdk/` works: `npm run build -w @ai-map/sdk`.

### Tests

| Suite | Command | Needs |
|---|---|---|
| Unit: shared (coordinates, measurement, controls, URLs, style, elevation, GeoJSON/KML) | `npm test -w @ai-map/shared` | — |
| Unit: web (layout, store, embed bridge) | `npm test -w @ai-map/web` | — |
| Unit: SDK (client, WebSocket, embed controller, drawings) | `npm test -w @ai-map/sdk` | — |
| API integration | `DATABASE_URL=postgres://aimap:aimap@localhost:5432/aimap DATA_DIR=../../dist-data npm test -w @ai-map/api` | PostGIS; map data optional (tests skip with a reason) |
| All unit + API suites | `npm test` | as above |
| End-to-end (browser) | `npm run test:e2e` (`E2E_BASE_URL=http://server:8080` for an installed stack) | running stack, Chrome (`CHROME_PATH`) |

## Integration with other applications

Embed (`/embed` + postMessage SDK), MapLibre style + live drawings, REST API with OpenAPI docs (`/api/v1/docs/`), WebSocket events, vector tiles/TileJSON and OGC API - Features for GIS. See [docs/INTEGRATION.md](docs/INTEGRATION.md) and the examples at `/sdk/examples/`.

## Deployment

One self-contained bundle, one command on the airgapped Ubuntu server: `sudo ./install.sh`. See [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Using the map from other applications

Tutorial for iframe users and JavaScript developers: [docs/TUTORIAL.md](docs/TUTORIAL.md), interactive at `/sdk/examples/tutorial.html`.

On a running server, `/` is a start page with the tutorial and all documentation (rendered from `docs/` at build time under `/docs/`); the map application itself is at `/map`.
