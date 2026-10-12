# Tutorial: using AI Map in other applications

This tutorial is for two kinds of users:

- **Part A — iframe users (no coding):** show the map on another web page with a single `<iframe>` tag and URL parameters.
- **Part B — JavaScript developers:** control the map from code (vehicle markers, saving objects, listening to clicks), or build your own MapLibre map.

An interactive version (with a URL builder and live demos) is available on the map server: **`http://<server>/sdk/examples/tutorial.html`**.
All examples below use `http://maps.local`; replace it with your server address. Everything works without internet access.

## Choosing an approach

| Need | Approach | Coding? |
|---|---|---|
| Show the map (with or without tools) in a dashboard or portal | A. iframe + URL parameters | No |
| Show the map **and** control it (markers, focus on a location, click events) | B1. iframe + `AiMapEmbed` SDK | A little JavaScript |
| Your application's own map, with the same basemap and drawings | B2. MapLibre + `addDrawings` SDK | JavaScript |
| A backend system (Java/.NET/Python/Node) reads or writes data | B3. REST API / `AiMapClient` | Yes |

---

## Part A — iframe users

### A1. Basic iframe

```html
<iframe src="http://maps.local/embed" style="width:100%; height:600px; border:0" title="Map"></iframe>
```

This shows the full map with every tool, the same as the main application (`http://maps.local/map`).

### A2. Initial position

| Parameter | Meaning | Example |
|---|---|---|
| `center` | Center point `longitude,latitude` | `center=46.6753,24.7136` (Riyadh) |
| `zoom` | 0 (world) – 19 (buildings) | `zoom=11` |
| `bearing` | Rotation (degrees) | `bearing=30` |
| `pitch` | Tilt 0–60 (3D) | `pitch=45` |

```html
<iframe src="http://maps.local/embed?center=55.2708,25.2048&zoom=12" ...></iframe>
```

> Mind the order: **longitude first, then latitude** (`center=55.27,25.20` for Dubai).

### A3. Appearance

| Parameter | Values |
|---|---|
| `theme` | `auto` (follows the system), `light`, `dark` |
| `unit` | Distance unit: `km`, `nm`, `mi` |
| `coords` | Coordinate format: `dd`, `dms`, `mgrs`, `utm` |
| `hillshade`, `contours`, `terrain3d` | `1` or `0` |

The interface and map labels are English only.

### A4. Choosing visible components (`controls`)

Without `controls`, every component is shown. With `controls`, **only the listed ones** are shown.

| Group | Contents (can be listed one by one) |
|---|---|
| `search` | Search box |
| `draw` | `draw.point`, `draw.line`, `draw.rectangle`, `draw.polygon`, `draw.circle`, `draw.text`, `draw.milsymbol` |
| `measure` | `measure.distance`, `measure.area`, `measure.rings` |
| `terrain` | `terrain.hillshade`, `terrain.contours`, `terrain.3d` |
| `settings` | `settings.unit`, `settings.coords`, `settings.theme` |
| `layers` | Layer list panel |
| `status` | Status pill (cursor coordinates, elevation, zoom) |
| `zoom`, `compass`, `scale` | Zoom buttons, compass, scale bar |
| `featurePanel` | Object detail panel when an object is clicked |
| `select` | Objects can be selected by clicking |
| `notices` | Notification messages |

Rules:

- `controls=none` → **plain map**, no components at all.
- `controls=search,zoom,layers` → only those.
- `controls=draw.point,draw.polygon,measure.distance` → only specific buttons.
- `controls=-draw,-status` → everything **except** the ones with a minus sign.
- `controls=draw,-draw.milsymbol` → every drawing tool except military symbols.

### A5. Read-only and locking the map

| Parameter | Meaning |
|---|---|
| `readonly=1` | Users cannot create/change/delete drawings (view only) |
| `interactive=0` | Users cannot pan or zoom the map (good for TV screens) |
| `minZoom`, `maxZoom` | Zoom limits |
| `maxBounds` | Area limit `west,south,east,north`, e.g. `maxBounds=34,12,60,32` |

### A6. Focusing on a layer or object

| Parameter | Meaning |
|---|---|
| `layers=<id>,<id>` | Only these layers are visible (layer IDs: see `http://maps.local/api/v1/layers`) |
| `select=<object id>` | Open and zoom to a specific object |

### A7. Ready-made recipes

**Plain map for a dashboard** (map only, no buttons):
```
http://maps.local/embed?controls=none&center=46.67,24.71&zoom=10
```

**Read-only monitoring map** (search, view layers, no editing):
```
http://maps.local/embed?controls=search,layers,zoom,status,featurePanel,select&readonly=1
```

**TV screen / kiosk** (locked, dark, 3D relief):
```
http://maps.local/embed?controls=none&interactive=0&theme=dark&terrain3d=1&pitch=50&center=42.5,18.2&zoom=10
```

**Working map for field teams** (no military symbols, no settings):
```
http://maps.local/embed?controls=-draw.milsymbol,-settings&unit=km&coords=mgrs
```

**Restricted area** (GCC only, minimum zoom 5):
```
http://maps.local/embed?maxBounds=34,12,60,32&minZoom=5&center=48,24&zoom=5
```

---

## Part B — JavaScript developers

### B0. Loading the SDK (offline, from the map server)

As a classic script (global variable `AiMap`):
```html
<script src="http://maps.local/sdk/aimap-sdk.js"></script>
```
As an ES module:
```js
import { AiMapEmbed, AiMapClient, addDrawings } from 'http://maps.local/sdk/aimap-sdk.mjs';
```
TypeScript types: `http://maps.local/sdk/aimap-sdk.d.ts`.

### B1. An embedded map controlled from code

```html
<div id="map" style="height:600px"></div>
<script src="http://maps.local/sdk/aimap-sdk.js"></script>
<script>
  const map = AiMap.AiMapEmbed.create('#map', {
    baseUrl: 'http://maps.local',
    center: [46.6753, 24.7136],
    zoom: 11,
    controls: ['search', 'zoom', 'layers'],
    readonly: true,
  });

  map.ready.then(() => console.log('map ready'));
  map.on('click', (e) => console.log('clicked at', e.lat, e.lon));
</script>
```

Every Part A parameter can be used as an option (`theme`, `controls`, `interactive`, `maxBounds`, and so on).

#### Commands (all return a Promise)

| Command | Example |
|---|---|
| Move to a location | `map.setView({ center: [55.27, 25.2], zoom: 12 })` |
| Zoom to an area | `map.fitBounds([46.5, 24.5, 46.9, 24.9])` |
| Current position | `const v = await map.getView()` |
| Search | `const results = await map.search('Riyadh')` |
| Temporary markers owned by your page | `map.setMarkers([{ id: 'truck-7', lon: 46.7, lat: 24.7, label: 'Truck 7' }])` |
| Remove markers | `map.removeMarkers(['truck-7'])` or `map.removeMarkers()` |
| Save an object (shared with all users) | `await map.addFeature({ kind: 'point', geometry: {...}, name: 'Post 1' })` |
| Change / delete an object | `map.updateFeature(id, { name: 'Post 1B' })`, `map.deleteFeature(id)` |
| Select an object | `map.selectFeature(id, true)` |
| Layers | `map.listLayers()`, `map.setLayerVisible(id, false)`, `map.setActiveLayer(id)` |
| Tools | `map.setTool('measure:distance')`, `map.setTool('draw:polygon')`, `map.setTool('none')` |
| Appearance | `map.setOptions({ theme: 'dark', unit: 'nm', terrain3d: true })` |
| Components at runtime | `map.setControls(['none'])`, `map.setControls(['all', '-draw'], true)` |
| Locking / limits | `map.setInteraction({ interactive: false, maxBounds: [34, 12, 60, 32] })` |

#### Events

| Event | Data |
|---|---|
| `ready` | initial position |
| `click` | `lon`, `lat`, `featureId`, `markerId` |
| `moveend` | position after the map was moved |
| `select` | the selected object (or `null`) |
| `featureCreated`, `featureUpdated`, `featureDeleted` | object changes, **including by other users** |
| `measure` | measurement result (`meters`, `squareMeters`) |

#### Example: real-time vehicle positions

```js
const map = AiMap.AiMapEmbed.create('#map', { baseUrl: 'http://maps.local', controls: ['zoom', 'layers'], readonly: true });
await map.ready;

async function refresh() {
  const vehicles = await fetch('/api/vehicles').then((r) => r.json()); // your own system
  await map.setMarkers(
    vehicles.map((v) => ({ id: v.id, lon: v.lon, lat: v.lat, label: v.name, color: v.active ? '#34c759' : '#8e8e93' })),
    true, // replace: remove markers that no longer exist
  );
}
setInterval(refresh, 5000);
map.on('click', (e) => e.markerId && console.log('vehicle clicked:', e.markerId));
```

Markers can be military symbols: `{ id: 'hq', lon: 46.7, lat: 24.7, sidc: '10031000001211000000', label: 'HQ' }`.

#### Example: saving an area from your system

```js
const zone = await map.addFeature({
  kind: 'polygon',
  name: 'Operations Zone A',
  geometry: { type: 'Polygon', coordinates: [[[46.6, 24.6], [46.8, 24.6], [46.8, 24.8], [46.6, 24.8], [46.6, 24.6]]] },
  style: { strokeColor: '#ff3b30', fillColor: '#ff3b30', fillOpacity: 0.15 },
});
await map.selectFeature(zone.id, true);
```

#### Example: a "presentation mode" button

```js
document.querySelector('#present').onclick = async () => {
  await map.setControls(['none']);
  await map.setInteraction({ interactive: false });
};
document.querySelector('#work').onclick = async () => {
  await map.setControls(['all']);
  await map.setInteraction({ interactive: true });
};
```

#### React example

```jsx
import { useEffect, useRef } from 'react';

export function MapView({ center }) {
  const box = useRef(null);
  const map = useRef(null);
  useEffect(() => {
    map.current = window.AiMap.AiMapEmbed.create(box.current, { baseUrl: 'http://maps.local', center, zoom: 10 });
    return () => map.current.destroy();
  }, []);
  useEffect(() => void map.current?.ready.then(() => map.current.setView({ center })), [center]);
  return <div ref={box} style={{ height: 500 }} />;
}
```

### B2. Your own MapLibre map

Use this when your application already has its own map.

```html
<link rel="stylesheet" href="http://maps.local/vendor/maplibre/maplibre-gl.css" />
<div id="map" style="height:600px"></div>
<script type="module">
  import * as maplibregl from 'http://maps.local/vendor/maplibre/maplibre-gl.mjs';
  import { AiMapClient, addDrawings } from 'http://maps.local/sdk/aimap-sdk.mjs';

  const client = new AiMapClient('http://maps.local');
  const map = new maplibregl.Map({
    container: 'map',
    style: client.styleUrl({ theme: 'light', terrain: 'hillshade' }), // terrain: none | hillshade | 3d
    center: [46.67, 24.71],
    zoom: 9,
  });

  map.on('load', async () => {
    // Shared drawings (pins, areas, symbols) are shown and kept up to date automatically.
    const drawings = await addDrawings(map, client, { layerIds: undefined });
    map.on('click', drawings.layerIds, (e) => alert(e.features[0].properties.name));
  });

  // Elevation and search
  map.on('click', async (e) => console.log('elevation', await client.elevation(e.lngLat.lng, e.lngLat.lat), 'm'));
  console.log(await client.search('Jeddah'));
</script>
```

### B3. From a backend (Node.js)

```js
import { AiMapClient } from './aimap-sdk.mjs'; // copy from http://maps.local/sdk/aimap-sdk.mjs

const client = new AiMapClient('http://maps.local');
const [layer] = await client.layers();
await client.createFeature({ layerId: layer.id, kind: 'point', name: 'Checkpoint 4', geometry: { type: 'Point', coordinates: [46.7, 24.7] } });

client.subscribe((message) => console.log(message.type), { onOpen: () => console.log('connected') });
```

Other languages (Java, .NET, Python): call the REST API directly. Full reference and client generators: `http://maps.local/api/v1/docs/` and `http://maps.local/api/v1/openapi.json`. More technical details: [INTEGRATION.md](INTEGRATION.md).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| The iframe is empty or grey | Open `http://maps.local/api/v1/health` from the same computer; run `aimapctl status` on the server |
| `map.ready` never resolves | `baseUrl` must exactly match the iframe `src` address (scheme, host, port) |
| Command fails with "Map is not ready yet" | Call commands after `await map.ready` |
| Command fails with "Unknown controls" | Wrong component name; see table A4 |
| `updateFeature` fails with "Version conflict" | Another user changed the object; fetch it again (`listFeatures`) and retry |
| An HTTPS page blocks an HTTP map | Serve the map and the page with the same scheme (browsers block *mixed content*) |
| Markers disappear after a page reload | Markers from `setMarkers` are temporary by design; use `addFeature` for permanent data |
