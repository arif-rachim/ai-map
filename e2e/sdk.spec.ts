import type { Page } from '@playwright/test';
import { ADMIN_TOKEN, expect, test } from './fixtures';

/** A blank page on the map server with MapLibre + SDK loaded as ES modules, exposed on window. */
async function modulePage(page: Page) {
  await page.goto('/sdk/examples/index.html');
  await page.addStyleTag({ url: '/vendor/maplibre/maplibre-gl.css' });
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="map" style="position:fixed; inset:0"></div>';
    const w = window as any;
    w.maplibregl = await import('/vendor/maplibre/maplibre-gl.mjs' as string);
    w.sdk = await import('/sdk/aimap-sdk.mjs' as string);
    w.client = new w.sdk.AiMapClient(location.origin);
  });
}

test.describe('SDK with your own MapLibre map', () => {
  test('style document renders, including 3D terrain', async ({ page, data }) => {
    const caps = await data.caps();
    test.skip(!caps.region, 'map tiles not installed');
    await modulePage(page);
    const result = await page.evaluate(
      (terrain) =>
        new Promise<{ layers: number; terrain: boolean; sources: string[] }>((resolve, reject) => {
          const w = window as any;
          const map = new w.maplibregl.Map({ container: 'map', style: w.client.styleUrl({ theme: 'dark', terrain: terrain ? '3d' : 'none' }), center: [42.5, 18.2], zoom: 10 });
          w.map = map;
          map.on('error', (e: any) => reject(new Error(e.error?.message ?? 'map error')));
          map.once('idle', () => resolve({ layers: map.getStyle().layers.length, terrain: !!map.getTerrain(), sources: Object.keys(map.getStyle().sources) }));
        }),
      caps.terrain,
    );
    expect(result.layers).toBeGreaterThan(50);
    expect(result.sources).toEqual(expect.arrayContaining(['world', 'region']));
    expect(result.terrain).toBe(caps.terrain);
  });

  test('addDrawings shows shared drawings and follows live changes', async ({ page, data }) => {
    const layer = await data.layer();
    const other = await data.layer();
    const first = await data.point(layer.id, 46.7, 24.7, 'Existing pin');
    await data.point(other.id, 46.71, 24.71, 'Other layer');
    await modulePage(page);
    await page.evaluate(
      (layerId) =>
        new Promise<void>((resolve) => {
          const w = window as any;
          w.map = new w.maplibregl.Map({ container: 'map', style: { version: 8, sources: {}, layers: [] }, center: [46.7, 24.7], zoom: 12 });
          w.map.on('load', async () => {
            w.drawings = await w.sdk.addDrawings(w.map, w.client, { layerIds: [layerId] });
            resolve();
          });
        }),
      layer.id,
    );
    const names = () => page.evaluate(() => (window as any).drawings.features().map((f: { name: string }) => f.name).sort());
    const rendered = () => page.evaluate(() => new Set((window as any).map.querySourceFeatures('aimap-drawings').map((f: { properties: { id: string } }) => f.properties.id)).size);

    expect(await names()).toEqual(['Existing pin']);
    await data.point(layer.id, 46.72, 24.72, 'Live pin');
    await expect.poll(names).toEqual(['Existing pin', 'Live pin']);
    await page.request.delete(`/api/v1/features/${first.id}`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    await expect.poll(names).toEqual(['Live pin']);
    await expect.poll(rendered).toBe(1);

    await page.evaluate(() => (window as any).drawings.setLayerIds(undefined));
    await expect.poll(async () => (await names()).includes('Other layer')).toBe(true);

    await page.evaluate(() => (window as any).drawings.destroy());
    expect(await page.evaluate(() => !!(window as any).map.getSource('aimap-drawings'))).toBe(false);
  });

  test('client: search, airports, elevation and GeoJSON import/export', async ({ page, data }) => {
    const caps = await data.caps();
    const layer = await data.layer();
    await modulePage(page);
    const result = await page.evaluate(
      async ({ layerId, terrain, token }) => {
        const c = (window as any).client;
        // Reading needs no token; the import (a write) fails without one.
        const denied = await c.importGeoJSON(layerId, { type: 'FeatureCollection', features: [] }).then(() => 0, (e: { status: number }) => e.status);
        c.token = token;
        const imported = await c.importGeoJSON(layerId, {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [55.27, 25.2] }, properties: { name: 'Imported' } }],
        });
        const exported = await c.featuresGeoJSON({ layerId });
        return {
          coords: (await c.search('24.7136, 46.6753'))[0]?.type,
          airport: (await c.airport('OMDB'))?.iata ?? null,
          elevation: terrain ? await c.elevation(42.5053, 18.2164) : null,
          imported: imported.created,
          exported: exported.features.map((f: { properties: { name: string } }) => f.properties.name),
          exportUrl: c.exportUrl(layerId, 'kml'),
          denied,
        };
      },
      { layerId: layer.id, terrain: caps.terrain, token: ADMIN_TOKEN },
    );
    expect(result.denied).toBe(401);
    expect(result.coords).toBe('coordinates');
    expect(result.imported).toBe(1);
    expect(result.exported).toEqual(['Imported']);
    expect((await page.request.get(result.exportUrl)).status()).toBe(200);
    if (caps.terrain) expect(result.elevation).toBeGreaterThan(1500);
    if (result.airport !== null) expect(result.airport).toBe('DXB');
  });

  test('bundled examples work', async ({ page, data }) => {
    const caps = await data.caps();
    test.skip(!caps.region, 'map tiles not installed');
    await page.goto('/sdk/examples/maplibre.html');
    await page.locator('.maplibregl-canvas').waitFor();
    await page.locator('#q').fill('24.7136, 46.6753');
    await expect(page.locator('#results li').first()).toContainText('coordinates');

    await page.goto('/sdk/examples/tutorial.html');
    await expect(page.locator('#a pre code').first()).toContainText(`${new URL(page.url()).origin}/embed`);
    await page.locator('#playground').scrollIntoViewIfNeeded();
    await expect(page.locator('#pg-log')).toContainText('ready', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Vehicle markers' }).click();
    await expect(page.locator('#pg-log')).toContainText('✓ Vehicle markers');
  });
});
