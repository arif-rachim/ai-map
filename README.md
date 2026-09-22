# AI Map — offline vector map for airgapped networks

Web map for a closed LAN: detailed vector basemap (GCC, North Africa, Levant, Iraq, Iran, Turkey, Yemen, Sudan; world at low detail), search (places, addresses, airports, coordinates), measurement with elevation profiles, terrain (hillshade, contours, 3D), and shared real-time drawing with MIL-STD-2525D/E symbols. No request ever leaves the server.

| Part | Tech |
|---|---|
| `apps/web` | React + MapLibre GL + PMTiles, Terra Draw, turf, milsymbol, i18next (EN/AR, RTL) |
| `apps/api` | Fastify + PostgreSQL/PostGIS: `/api/v1` REST + OpenAPI, WebSocket events, unified search, elevation, tiles/styles, OGC API - Features |
| `packages/shared` | Schemas, coordinates, measurement, basemap style builder, elevation sampling, GeoJSON/KML, embed protocol |
| `packages/sdk` | `aimap-sdk.js` for other apps: REST/WebSocket client, iframe embed controller, MapLibre drawings layer |
| `data-pipeline` | Builds offline data on an internet-connected machine |
| `deploy` | Dockerfiles, nginx, docker-compose, transfer bundle + installer |

## Development

Requirements: Node 24, Docker.

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
| End-to-end (browser) | `npm run test:e2e` (`E2E_BASE_URL=http://server:8080` for an installed stack) | running stack, Chrome (`CHROME_PATH`) |

## Integration with other applications

Embed (`/embed` + postMessage SDK), MapLibre style + live drawings, REST API with OpenAPI docs (`/api/v1/docs/`), WebSocket events, vector tiles/TileJSON and OGC API - Features for GIS. See [docs/INTEGRATION.md](docs/INTEGRATION.md) and the examples at `/sdk/examples/`.

## Deployment

One self-contained bundle, one command on the airgapped Ubuntu server: `sudo ./install.sh`. See [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Using the map from other applications

Tutorial for iframe users and JavaScript developers (Bahasa Indonesia): [docs/TUTORIAL.md](docs/TUTORIAL.md), interactive at `/sdk/examples/tutorial.html`.
