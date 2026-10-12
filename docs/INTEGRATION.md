# Integrating other applications

Everything is served by the map server itself (no internet). Replace `http://maps.local` with your server address.

| Need | Use | Entry point |
|---|---|---|
| Show the full map (search, measure, drawings) inside another web app | **Embed** + `AiMapEmbed` | `/embed`, `/sdk/aimap-sdk.js` |
| Build your own map with the same basemap and live drawings | **MapLibre style** + `addDrawings` | `/api/v1/styles/light.json`, `/sdk/aimap-sdk.mjs` |
| Call search / airports / elevation / drawings from any backend | **REST API** (+ WebSocket events) | `/api/v1`, docs at `/api/v1/docs/` |
| Open the basemap or drawings in GIS software | **Vector tiles (XYZ/TileJSON)**, **OGC API - Features**, GeoJSON/KML | `/api/v1/tiles`, `/api/v1/ogc` |

Start page with links to the map, tutorial and docs: **`http://maps.local/`** (the map itself is at `/map`). Live examples: **`http://maps.local/sdk/examples/`**. Interactive API reference: **`http://maps.local/api/v1/docs/`**.
Step-by-step tutorial (with an iframe URL builder and an SDK playground): **`http://maps.local/sdk/examples/tutorial.html`** · [TUTORIAL.md](TUTORIAL.md).

### Admin access and layers

- **Reading is open**: the map, layer list, drawings, search, tiles, OGC API.
- **Writing is for admins only**: creating, renaming and deleting layers, creating/changing/deleting drawings, and imports. Send `Authorization: Bearer <token>`, where the token is the server's `ADMIN_API_TOKEN` (shown by `aimapctl admin`) or a session token from `POST /api/v1/auth/login {"password": "..."}` (valid 12 h). Without it the API answers `401`.
- In the web app, admins log in with the lock button in the toolbar. Everyone else sees no drawing tools.
- **Layers are loaded on demand**: the map starts with no drawings; users tick the named layers they want in the Layers panel (remembered per browser). `?layers=<id or name>,...` on `/map` or `/embed` loads those layers, e.g. `/map?layers=abc`.

## 1. Embed the map (iframe)

Plain URL, no JavaScript needed:

```html
<iframe src="http://maps.local/embed?center=46.67,24.71&zoom=10&controls=search,layers&readonly=1" style="width:100%;height:600px;border:0"></iframe>
```

| Parameter | Meaning |
|---|---|
| `center=lon,lat`, `zoom`, `bearing`, `pitch` | Initial view |
| `theme=auto\|light\|dark` | Appearance (interface and map labels are English only) |
| `unit=km\|nm\|mi`, `coords=dd\|dms\|mgrs\|utm` | Units and coordinate format |
| `hillshade=0\|1`, `contours=0\|1`, `terrain3d=0\|1` | Terrain display |
| `controls=…` | Visible UI parts (see below; default all) |
| `readonly=1` | Hide drawing tools and all edit/delete actions for the user (host commands can still write) |
| `interactive=0` | User cannot pan/zoom/rotate (clicks still emit events) |
| `minZoom`, `maxZoom`, `maxBounds=w,s,e,n` | Zoom range and area limits |
| `layers=<id or name>,...` | Layers to load (none when omitted) |
| `select=<featureId>` | Select and zoom to a feature |

`controls` accepts groups and individual controls:

| Group | Individual controls |
|---|---|
| `search`, `layers`, `status`, `zoom`, `compass`, `scale`, `featurePanel`, `select`, `notices` | (single control) |
| `draw` | `draw.point`, `draw.line`, `draw.rectangle`, `draw.polygon`, `draw.circle`, `draw.text`, `draw.milsymbol` |
| `measure` | `measure.distance`, `measure.area`, `measure.rings` |
| `terrain` | `terrain.hillshade`, `terrain.contours`, `terrain.3d` |
| `settings` | `settings.unit`, `settings.coords`, `settings.theme` |

`controls=none` is a pure map; `controls=all,-draw.text,-status` (or just `-draw.text,-status`) shows everything except those; unknown names are ignored in the URL and rejected by `setControls`.

Embedded maps do not change the full app's saved preferences.

### Control it from your page with the SDK

```html
<div id="map" style="height:600px"></div>
<script src="http://maps.local/sdk/aimap-sdk.js"></script>
<script>
  const map = AiMap.AiMapEmbed.create('#map', {
    baseUrl: 'http://maps.local',
    center: [46.67, 24.71], zoom: 10,
    controls: ['search', 'measure', 'layers'],
  });

  map.ready.then(async () => {
    // Temporary markers owned by your page (not saved, not shared)
    await map.setMarkers([
      { id: 'unit-1', lon: 46.68, lat: 24.72, label: 'Unit 1', sidc: '10031000001211000000' },
      { id: 'truck-7', lon: 46.64, lat: 24.69, label: 'Truck 7', color: '#16a34a' },
    ]);
  });

  map.on('click', (e) => console.log('clicked', e.lon, e.lat, e.featureId, e.markerId));
  map.on('select', (e) => console.log('selected', e.feature));
  map.on('featureCreated', (e) => console.log('someone drew', e.feature));
</script>
```

Commands (all return promises): `getView`, `setView`, `fitBounds`, `search`, `listLayers`, `listFeatures`, `addFeature`, `updateFeature`, `deleteFeature`, `selectFeature`, `setLayerVisible` (loads/unloads a layer), `setActiveLayer`, `setAuthToken(token)` (needed before `addFeature`/`updateFeature`/`deleteFeature`), `setTool` (`none`, `draw:rectangle|polygon|circle|line|point|text|milsymbol`, `measure:distance|area|rings`), `setOptions` (theme, unit, coordFormat, hillshade, contours, terrain3d), `setMarkers`, `removeMarkers`, `setControls(controls?, readonly?)`, `getControls`, `setInteraction({ interactive, minZoom, maxZoom, maxBounds })`.

When no drawing layer exists, the first saved feature creates a layer named "Default".

Events: `ready`, `click`, `moveend`, `select`, `featureCreated`, `featureUpdated`, `featureDeleted` (including changes by other users), `measure`.

Without the SDK, use `window.postMessage` directly — see `packages/shared/src/embed.ts` for the message format:
`{ source: 'aimap', version: 1, type: 'command', id, command, params }` → `{ source: 'aimap', version: 1, type: 'response', id, ok, result | error }`.

## 2. Your own MapLibre map

```js
import * as maplibregl from 'http://maps.local/vendor/maplibre/maplibre-gl.mjs'; // or your own maplibre-gl ≥ 4
import { AiMapClient, addDrawings } from 'http://maps.local/sdk/aimap-sdk.mjs';

const client = new AiMapClient('http://maps.local');
const map = new maplibregl.Map({
  container: 'map',
  style: client.styleUrl({ theme: 'light', terrain: 'hillshade' }), // terrain: none | hillshade | 3d
  center: [46.67, 24.71], zoom: 9,
});
map.on('load', async () => {
  const drawings = await addDrawings(map, client, { layerIds: undefined }); // live, read-only, same symbology
  map.on('click', drawings.layerIds, (e) => console.log(e.features[0].properties));
});
```

Styles: `/api/v1/styles/{light|dark}.json?terrain=none|hillshade|3d`. Labels are always English. Contour lines are generated in the browser by the full app and are not part of the style document.

TypeScript types: `/sdk/aimap-sdk.d.ts`. With npm in a monorepo, depend on `packages/sdk` instead.

> **Changed (admin-only editing, layers on demand):** writes now return `401` without an admin token (REST, SDK: `new AiMapClient(url, { token })` or `client.login(password)`, embed: `map.setAuthToken(token)`); embedded maps no longer show every layer by default (pass `layers=`), and `setLayerVisible` loads/unloads instead of hiding.

> **Removed (English only):** the Arabic interface and every language option are gone: `ui`/`lang` in embed URLs, `uiLang`/`labelLang` in `setOptions`, the `settings.ui`/`settings.labels` controls (`setControls` now rejects them as unknown), and `lang` in the SDK `styleUrl()`/`search()` and in REST `/search` and `/styles`. The REST endpoints and embed URLs silently ignore a leftover `lang`/`ui` parameter.

## 3. REST API (any language)

Base URL `http://maps.local/api/v1`, JSON, WGS84 lon/lat. Full reference: `/api/v1/docs/` and `/api/v1/openapi.json` (OpenAPI 3.0 — generate clients for Java/.NET/Python from it).

```bash
# Search: coordinates (DD/DMS/MGRS/UTM), airports, places/addresses
curl 'http://maps.local/api/v1/search?q=Riyadh&limit=5'
curl 'http://maps.local/api/v1/airports/OMDB'

# Elevation
curl 'http://maps.local/api/v1/elevation?lon=42.5053&lat=18.2164'
curl -X POST http://maps.local/api/v1/elevation/profile -H 'content-type: application/json' \
  -d '{"coordinates":[[42.3,18.2],[42.7,18.25]],"samples":100}'

# Drawings
curl http://maps.local/api/v1/layers
TOKEN=<ADMIN_API_TOKEN>   # writes need an admin token
curl -X POST http://maps.local/api/v1/features -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "layerId": "<layer-id>", "kind": "point", "name": "Checkpoint 4",
  "geometry": { "type": "Point", "coordinates": [46.7, 24.7] } }'
curl -X PATCH http://maps.local/api/v1/features/<id> -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"version": 1, "name": "Checkpoint 4B"}'
```

Updates use optimistic locking: send the `version` you last read; `409` means someone changed it (the response contains `current`).

### Bulk exchange

```bash
curl -o layer.geojson http://maps.local/api/v1/layers/<id>/export.geojson
curl -o layer.kml     http://maps.local/api/v1/layers/<id>/export.kml
# Import (append or replace atomically). Properties: kind, name|title, description, style, radiusM, center, sidc
curl -X POST 'http://maps.local/api/v1/layers/<id>/import?mode=replace' -H 'content-type: application/geo+json' --data-binary @units.geojson
```

### Real-time events

WebSocket `ws://maps.local/api/v1/events` pushes JSON messages:
`feature.created`, `feature.updated` (with `feature`), `feature.deleted` (with `id`), `layer.created|updated|deleted`.
Messages sent while disconnected are not replayed: reload with `GET /features` after reconnecting (the SDK's `client.subscribe(onMessage, { onOpen })` does the reconnect).

## 4. GIS software

- **Basemap (vector)**: QGIS → *Vector Tiles* → *New Generic Connection*: URL `http://maps.local/api/v1/tiles/region/{z}/{x}/{y}.mvt`, max zoom 15, *Style URL* `http://maps.local/api/v1/styles/light.json`. World overview: `.../tiles/world/{z}/{x}/{y}.mvt` (max zoom 7). TileJSON: `/api/v1/tiles/{world|region|terrain}.json`.
- **Terrain DEM**: `http://maps.local/api/v1/tiles/terrain/{z}/{x}/{y}.webp` (Terrarium encoding, 512 px, max zoom 12). In QGIS use an XYZ connection with *Interpretation: Terrarium terrain RGB* (recent QGIS versions; the build must support WebP). For plain values use `GET /api/v1/elevation`.
- **Manual acceptance checklist** for QGIS / ArcGIS Pro: [GIS-CHECKLIST.md](GIS-CHECKLIST.md).
- **Drawings**: *OGC API - Features* (QGIS "WFS / OGC API - Features", ArcGIS Pro "OGC API", GDAL/`ogr2ogr`): `http://maps.local/api/v1/ogc`. One collection per layer, read-only, GeoJSON, `bbox`/`limit`/`offset` paging.
- **Files**: GeoJSON / KML export per layer (see above) for Google Earth and other tools.

A pre-rendered raster WMTS (for older ArcGIS/ArcMap) is not included; it needs a server-side renderer and can be added if required.
