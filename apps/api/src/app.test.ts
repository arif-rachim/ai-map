import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MapFeature, MapLayer } from '@ai-map/shared';

// Integration tests against a real PostGIS. Run with: DATABASE_URL=postgres://... npm test -w @ai-map/api
const enabled = !!process.env.DATABASE_URL;
const ADMIN_TOKEN = 'test-admin-token';
const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };

describe.skipIf(!enabled)('api (PostGIS integration; set DATABASE_URL)', () => {
  let app: FastifyInstance;
  let layer: MapLayer;

  beforeAll(async () => {
    const { migrate } = await import('./db.js');
    const { buildApp } = await import('./app.js');
    await migrate(new URL('../migrations', import.meta.url).pathname);
    app = await buildApp({ logger: false, auth: { adminPassword: 'test-password', adminApiToken: ADMIN_TOKEN, secret: 'test-secret' } });
    const res = await app.inject({ method: 'POST', headers: admin, url: '/api/v1/layers', payload: { name: `test-${Date.now()}` } });
    expect(res.statusCode).toBe(201);
    layer = res.json();
  });

  afterAll(async () => {
    if (layer) await app.inject({ method: 'DELETE', headers: admin, url: `/api/v1/layers/${layer.id}` });
    await app?.close();
    const { pool } = await import('./db.js');
    await pool.end();
  });

  const polygon = { type: 'Polygon', coordinates: [[[46, 24], [47, 24], [47, 25], [46, 25], [46, 24]]] };

  it('lets everyone read but only admins write', async () => {
    expect((await app.inject({ url: '/api/v1/layers' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/auth/session' })).json()).toEqual({ admin: false, loginEnabled: true });
    const anon = await app.inject({ method: 'POST', url: '/api/v1/layers', payload: { name: 'nope' } });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['www-authenticate']).toBe('Bearer');
    for (const [method, url] of [['PATCH', `/api/v1/layers/${layer.id}`], ['DELETE', `/api/v1/layers/${layer.id}`], ['POST', '/api/v1/features'], ['POST', `/api/v1/layers/${layer.id}/import`]] as const) {
      expect((await app.inject({ method, url, payload: {} })).statusCode, `${method} ${url}`).toBe(401);
    }
    const wrongToken = { authorization: 'Bearer nope' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/layers', headers: wrongToken, payload: { name: 'x' } })).statusCode).toBe(401);

    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password: 'wrong' } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password: 'test-password' } });
    expect(login.statusCode).toBe(200);
    const session = { authorization: `Bearer ${login.json().token}` };
    expect((await app.inject({ url: '/api/v1/auth/session', headers: session })).json()).toMatchObject({ admin: true });
    const renamed = await app.inject({ method: 'PATCH', url: `/api/v1/layers/${layer.id}`, headers: session, payload: { name: layer.name } });
    expect(renamed.statusCode).toBe(200);
    // A tampered or expired session is rejected.
    const [v, exp, mac] = login.json().token.split('.');
    const forged = { authorization: `Bearer ${v}.${Number(exp) + 1}.${mac}` };
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/layers/${layer.id}`, headers: forged, payload: { name: 'x' } })).statusCode).toBe(401);
  });

  it('creates, updates with optimistic locking, and deletes a feature', async () => {
    const created = await app.inject({
      method: 'POST',
      headers: admin,
      url: '/api/v1/features',
      payload: { layerId: layer.id, kind: 'rectangle', geometry: polygon, name: 'Zone' },
    });
    expect(created.statusCode).toBe(201);
    const f = created.json<MapFeature>();
    expect(f.version).toBe(1);
    expect(f.style.strokeColor).toMatch(/^#/);
    expect(f.geometry).toEqual(polygon);

    const updated = await app.inject({ method: 'PATCH', headers: admin, url: `/api/v1/features/${f.id}`, payload: { version: 1, name: 'Zone B', style: { ...f.style, fillOpacity: 0.5 } } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<MapFeature>()).toMatchObject({ version: 2, name: 'Zone B', style: { fillOpacity: 0.5 } });

    const stale = await app.inject({ method: 'PATCH', headers: admin, url: `/api/v1/features/${f.id}`, payload: { version: 1, name: 'stale' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.name).toBe('Zone B');

    expect((await app.inject({ method: 'DELETE', headers: admin, url: `/api/v1/features/${f.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', headers: admin, url: `/api/v1/features/${f.id}` })).statusCode).toBe(404);
  });

  it('stores circle center and radius and milsymbol SIDC', async () => {
    const circle = await app.inject({
      method: 'POST',
      headers: admin,
      url: '/api/v1/features',
      payload: { layerId: layer.id, kind: 'circle', geometry: polygon, center: [46.5, 24.5], radiusM: 1234.5 },
    });
    expect(circle.json<MapFeature>()).toMatchObject({ center: [46.5, 24.5], radiusM: 1234.5 });
    const sym = await app.inject({
      method: 'POST',
      headers: admin,
      url: '/api/v1/features',
      payload: { layerId: layer.id, kind: 'milsymbol', geometry: { type: 'Point', coordinates: [46, 24] }, sidc: '10061000001211000000' },
    });
    expect(sym.json<MapFeature>().sidc).toBe('10061000001211000000');
  });

  it('rejects invalid input', async () => {
    const res = await app.inject({ method: 'POST', headers: admin, url: '/api/v1/features', payload: { layerId: layer.id, kind: 'circle', geometry: { type: 'Point', coordinates: [500, 0] } } });
    expect(res.statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', headers: admin, url: '/api/v1/features/not-a-uuid', payload: { version: 1 } })).statusCode).toBe(400);
  });

  it('cascades feature deletion with the layer', async () => {
    const tmp = (await app.inject({ method: 'POST', headers: admin, url: '/api/v1/layers', payload: { name: 'tmp' } })).json<MapLayer>();
    await app.inject({ method: 'POST', headers: admin, url: '/api/v1/features', payload: { layerId: tmp.id, kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] } } });
    expect((await app.inject({ method: 'DELETE', headers: admin, url: `/api/v1/layers/${tmp.id}` })).statusCode).toBe(204);
    const list = (await app.inject({ method: 'GET', url: `/api/v1/features?layerId=${tmp.id}` })).json<MapFeature[]>();
    expect(list).toHaveLength(0);
  });

  it('serves terrain DEM tiles when terrain.pmtiles is installed', async (t) => {
    const caps = (await app.inject({ url: '/api/v1/capabilities' })).json();
    if (!caps.terrain) return t.skip('terrain.pmtiles not installed in DATA_DIR');
    expect(caps.terrainMaxzoom).toBeGreaterThan(0);
    const root = await app.inject({ url: '/api/v1/tiles/terrain/0/0/0' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toMatch(/^image\//);
    expect((await app.inject({ url: `/api/v1/tiles/terrain/${caps.terrainMaxzoom + 1}/0/0` })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/tiles/terrain/a/0/0' })).statusCode).toBe(400);
  });

  it('exports and imports GeoJSON, exports KML, and replaces atomically', async () => {
    const tmp = (await app.inject({ method: 'POST', headers: admin, url: '/api/v1/layers', payload: { name: 'exchange' } })).json<MapLayer>();
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [55.27, 25.2] }, properties: { title: 'HQ', kind: 'milsymbol', sidc: '10031000001211000000' } },
        { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[55, 25], [56, 25]], [[55, 26], [56, 26]]] }, properties: { name: 'Route' } },
        { type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [] }, properties: {} },
      ],
    };
    const imported = await app.inject({ method: 'POST', url: `/api/v1/layers/${tmp.id}/import`, payload: fc, headers: { ...admin, 'content-type': 'application/geo+json' } });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ created: 3, deleted: 0 });
    expect(imported.json().errors).toHaveLength(1);

    const exported = await app.inject({ url: `/api/v1/layers/${tmp.id}/export.geojson` });
    expect(exported.headers['content-type']).toContain('application/geo+json');
    const body = exported.json();
    expect(body.features).toHaveLength(3);
    expect(body.features.find((f: { properties: { kind: string } }) => f.properties.kind === 'milsymbol').properties.sidc).toBe('10031000001211000000');

    const kml = await app.inject({ url: `/api/v1/layers/${tmp.id}/export.kml` });
    expect(kml.body).toContain('<kml');
    expect(kml.body).toContain('<name>HQ</name>');

    const replaced = await app.inject({ method: 'POST', headers: admin, url: `/api/v1/layers/${tmp.id}/import?mode=replace`, payload: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} } });
    expect(replaced.json()).toMatchObject({ created: 1, deleted: 3 });

    const bad = await app.inject({ method: 'POST', headers: admin, url: `/api/v1/layers/${tmp.id}/import`, payload: { hello: 'world' } });
    expect(bad.statusCode).toBe(400);
    await app.inject({ method: 'DELETE', headers: admin, url: `/api/v1/layers/${tmp.id}` });
  });

  it('serves OGC API - Features collections with paging', async () => {
    const tmp = (await app.inject({ method: 'POST', headers: admin, url: '/api/v1/layers', payload: { name: 'ogc' } })).json<MapLayer>();
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', headers: admin, url: '/api/v1/features', payload: { layerId: tmp.id, kind: 'point', geometry: { type: 'Point', coordinates: [10 + i, 10] } } });
    }
    const landing = (await app.inject({ url: '/api/v1/ogc' })).json();
    expect(landing.links.map((l: { rel: string }) => l.rel)).toEqual(expect.arrayContaining(['conformance', 'data', 'service-desc']));
    const cols = (await app.inject({ url: '/api/v1/ogc/collections' })).json();
    const col = cols.collections.find((c: { id: string }) => c.id === tmp.id);
    expect(col.extent.spatial.bbox[0]).toEqual([10, 10, 12, 10]);
    const page = (await app.inject({ url: `/api/v1/ogc/collections/${tmp.id}/items?limit=2` })).json();
    expect(page).toMatchObject({ type: 'FeatureCollection', numberMatched: 3, numberReturned: 2 });
    expect(page.links.some((l: { rel: string }) => l.rel === 'next')).toBe(true);
    const bboxed = (await app.inject({ url: `/api/v1/ogc/collections/${tmp.id}/items?bbox=10.5,9,12.5,11` })).json();
    expect(bboxed.numberMatched).toBe(2);
    const item = await app.inject({ url: `/api/v1/ogc/collections/${tmp.id}/items/${page.features[0].id}` });
    expect(item.statusCode).toBe(200);
    await app.inject({ method: 'DELETE', headers: admin, url: `/api/v1/layers/${tmp.id}` });
  });

  it('publishes OpenAPI, styles and TileJSON', async (t) => {
    const spec = (await app.inject({ url: '/api/v1/openapi.json' })).json();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/search']).toBeDefined();
    expect((await app.inject({ url: '/api/v1/docs' })).statusCode).toBeLessThan(400);
    const caps = (await app.inject({ url: '/api/v1/capabilities' })).json();
    if (!caps.region) return t.skip('region.pmtiles not installed in DATA_DIR');
    const style = (await app.inject({ url: '/api/v1/styles/dark.json', headers: { host: 'maps.local:8080' } })).json();
    expect(style.version).toBe(8);
    expect(style.sources.region.url).toBe('http://maps.local:8080/api/v1/tiles/region.json');
    const tj = (await app.inject({ url: '/api/v1/tiles/region.json', headers: { host: 'maps.local:8080' } })).json();
    expect(tj.tiles[0]).toBe('http://maps.local:8080/api/v1/tiles/region/{z}/{x}/{y}.mvt');
    expect(tj.vector_layers.length).toBeGreaterThan(0);
    const tile = await app.inject({ url: '/api/v1/tiles/region/0/0/0.mvt' });
    expect(tile.statusCode).toBe(200);
    expect(tile.headers['content-type']).toBe('application/vnd.mapbox-vector-tile');
  });

  it('computes elevation and profiles server-side', async (t) => {
    const caps = (await app.inject({ url: '/api/v1/capabilities' })).json();
    if (!caps.terrain) return t.skip('terrain.pmtiles not installed in DATA_DIR');
    const point = (await app.inject({ url: '/api/v1/elevation?lon=42.5053&lat=18.2164' })).json();
    expect(point.elevation).toBeGreaterThan(1500); // Abha, Asir mountains (~2,200 m)
    expect(point.elevation).toBeLessThan(3000);
    const sea = (await app.inject({ url: '/api/v1/elevation?lon=50.5&lat=26.8' })).json(); // Arabian Gulf
    expect(Math.abs(sea.elevation)).toBeLessThan(50);
    const profile = (
      await app.inject({ method: 'POST', url: '/api/v1/elevation/profile', payload: { coordinates: [[42.3, 18.2], [42.7, 18.25]], samples: 50 } })
    ).json();
    expect(profile.points).toHaveLength(50);
    expect(profile.max).toBeGreaterThan(profile.min);
  });

  it('runs unified search over coordinates and airports', async (t) => {
    const coord = (await app.inject({ url: '/api/v1/search?q=' + encodeURIComponent("25°12'17\"N 55°16'15\"E") })).json();
    expect(coord[0].type).toBe('coordinates');
    const { rows } = await (await import('./db.js')).pool.query<{ n: string }>('SELECT count(*) n FROM airports');
    if (Number(rows[0]!.n) === 0) return t.skip('airports table is empty (no airports.csv imported)');
    const res = (await app.inject({ url: '/api/v1/search?q=DXB&types=airport' })).json();
    expect(res[0]).toMatchObject({ type: 'airport', name: 'Dubai International Airport' });
    expect((await app.inject({ url: '/api/v1/airports/omdb' })).json().iata).toBe('DXB');
  });

  it('searches airports by IATA, ICAO and city', async (t) => {
    const { rows } = await (await import('./db.js')).pool.query<{ n: string }>('SELECT count(*) n FROM airports');
    if (Number(rows[0]!.n) === 0) return t.skip('airports table is empty (no airports.csv imported)');
    const iata = (await app.inject({ url: '/api/v1/airports/search?q=dxb&limit=1' })).json();
    expect(iata[0].icao).toBe('OMDB');
    const icao = (await app.inject({ url: '/api/v1/airports/search?q=OERK&limit=1' })).json();
    expect(icao[0].iata).toBe('RUH');
    const city = (await app.inject({ url: '/api/v1/airports/search?q=jeddah&limit=1' })).json();
    expect(city[0].iata).toBe('JED');
  });
  it('reads single layers and features, with 404s', async () => {
    const f = (await app.inject({ method: 'POST', headers: admin, url: '/api/v1/features', payload: { layerId: layer.id, kind: 'point', geometry: { type: 'Point', coordinates: [3, 3] } } })).json<MapFeature>();
    expect((await app.inject({ url: `/api/v1/layers/${layer.id}` })).json<MapLayer>().name).toBe(layer.name);
    expect((await app.inject({ url: `/api/v1/features/${f.id}` })).json<MapFeature>().id).toBe(f.id);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ url: `/api/v1/layers/${missing}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/features/${missing}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', headers: admin, url: `/api/v1/layers/${missing}`, payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/airports/ZZZZZZ' })).statusCode).toBe(404);
  });

  it('filters and pages features and GeoJSON by bbox', async () => {
    const tmp = (await app.inject({ method: 'POST', headers: admin, url: '/api/v1/layers', payload: { name: 'paging' } })).json<MapLayer>();
    for (const lon of [20, 21, 22, 40]) {
      await app.inject({ method: 'POST', headers: admin, url: '/api/v1/features', payload: { layerId: tmp.id, kind: 'point', geometry: { type: 'Point', coordinates: [lon, 5] }, name: String(lon) } });
    }
    const q = (s: string) => app.inject({ url: `/api/v1/features?layerId=${tmp.id}&${s}` }).then((r) => r.json<MapFeature[]>().map((f) => f.name));
    expect(await q('bbox=19,4,23,6')).toEqual(['20', '21', '22']);
    expect(await q('bbox=19,4,23,6&limit=2')).toEqual(['20', '21']);
    expect(await q('bbox=19,4,23,6&limit=2&offset=2')).toEqual(['22']);
    expect((await app.inject({ url: '/api/v1/features?bbox=5,5,1,1' })).statusCode).toBe(400);
    const gj = (await app.inject({ url: `/api/v1/features.geojson?layerId=${tmp.id}&bbox=39,4,41,6` })).json();
    expect(gj.features.map((x: { properties: { name: string } }) => x.properties.name)).toEqual(['40']);
    await app.inject({ method: 'DELETE', headers: admin, url: `/api/v1/layers/${tmp.id}` });
  });

  it('broadcasts changes over the WebSocket event stream', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`${address.replace('http', 'ws')}/api/v1/events`);
    const received: string[] = [];
    await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
    ws.onmessage = (e) => received.push(JSON.parse(String(e.data)).type);
    const created = (await app.inject({ method: 'POST', headers: admin, url: '/api/v1/features', payload: { layerId: layer.id, kind: 'point', geometry: { type: 'Point', coordinates: [4, 4] } } })).json<MapFeature>();
    await app.inject({ method: 'PATCH', headers: admin, url: `/api/v1/features/${created.id}`, payload: { version: 1, name: 'ws' } });
    await app.inject({ method: 'DELETE', headers: admin, url: `/api/v1/features/${created.id}` });
    await vi.waitFor(() => expect(received).toEqual(['feature.created', 'feature.updated', 'feature.deleted']));
    ws.close();
  });

  it('answers elevation for many points and profiles', async (t) => {
    const caps = (await app.inject({ url: '/api/v1/capabilities' })).json();
    if (!caps.terrain) return t.skip('terrain.pmtiles not installed in DATA_DIR');
    const res = (await app.inject({ method: 'POST', url: '/api/v1/elevation', payload: { points: [[42.5053, 18.2164], [50.5, 26.8]] } })).json();
    expect(res).toHaveLength(2);
    expect(res[0].elevation).toBeGreaterThan(1500);
    expect((await app.inject({ method: 'POST', url: '/api/v1/elevation', payload: { points: [] } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/v1/elevation?lon=500&lat=0' })).statusCode).toBe(400);
  });

  it('lists installed tilesets', async (t) => {
    const caps = (await app.inject({ url: '/api/v1/capabilities' })).json();
    if (!caps.region) return t.skip('region.pmtiles not installed in DATA_DIR');
    const list = (await app.inject({ url: '/api/v1/tiles', headers: { host: 'maps.local' } })).json();
    expect(list.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['world', 'region']));
    expect(list[0].tilejson).toMatch(/^http:\/\/maps\.local\/api\/v1\/tiles\/\w+\.json$/);
    expect((await app.inject({ url: '/api/v1/tiles/nope.json' })).statusCode).toBe(400);
  });

  it('searches places through the geocoder', async (t) => {
    const caps = (await app.inject({ url: '/api/v1/capabilities' })).json();
    if (!caps.geocoder) return t.skip('Photon geocoder not reachable at PHOTON_URL');
    const res = (await app.inject({ url: '/api/v1/search?q=Riyadh&limit=3' })).json();
    expect(res[0]).toMatchObject({ type: 'place', name: 'Riyadh' });
    const keys = res.map((r: { name: string; detail: string }) => `${r.name}|${r.detail}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe.skipIf(!enabled)('api without map data (PostGIS integration; set DATABASE_URL)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import('./app.js');
    app = await buildApp({ logger: false, dataDir: mkdtempSync(path.join(tmpdir(), 'aimap-empty-')) });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('reports missing datasets and answers 503/404 instead of failing', async () => {
    const caps = (await app.inject({ url: '/api/v1/capabilities' })).json();
    expect(caps).toMatchObject({ region: false, world: false, terrain: false, terrainMaxzoom: null });
    expect((await app.inject({ url: '/api/v1/elevation?lon=1&lat=1' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/v1/elevation/profile', payload: { coordinates: [[1, 1], [2, 2]] } })).statusCode).toBe(503);
    expect((await app.inject({ url: '/api/v1/tiles/region.json' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/tiles/region/0/0/0' })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/tiles' })).json()).toEqual([]);
    const style = (await app.inject({ url: '/api/v1/styles/light.json' })).json();
    expect(style.layers.map((l: { id: string }) => l.id)).toEqual(['background']);
  });
});
