import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Opens a host page on the map server with the SDK loaded and an embedded map. */
async function host(page: Page, options: Record<string, unknown> = {}) {
  await page.goto('/sdk/examples/index.html');
  await page.addScriptTag({ url: '/sdk/aimap-sdk.js' });
  await page.evaluate((opts) => {
    document.body.innerHTML = '<div id="host" style="position:fixed; inset:0"></div>';
    const w = window as unknown as { AiMap: any; embed: any; events: { event: string; data: any }[] };
    w.events = [];
    w.embed = w.AiMap.AiMapEmbed.create('#host', { baseUrl: location.origin, center: [46.6753, 24.7136], zoom: 11, ...opts });
    for (const ev of ['ready', 'click', 'moveend', 'select', 'featureCreated', 'featureUpdated', 'featureDeleted', 'measure']) {
      w.embed.on(ev, (data: unknown) => w.events.push({ event: ev, data }));
    }
  }, options);
  await expect.poll(() => events(page).then((e) => e.some((x) => x.event === 'ready'))).toBe(true);
  return page.frameLocator('#host iframe');
}

const call = (page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(([m, a]) => (window as any).embed[m as string](...(a as unknown[])), [method, args] as const);
const events = (page: Page) => page.evaluate(() => (window as any).events as { event: string; data: any }[]);
const eventNames = async (page: Page) => (await events(page)).map((e) => e.event);

test.describe('embed URL parameters', () => {
  const cases: { name: string; params: Record<string, unknown>; visible: string[]; hidden: string[] }[] = [
    { name: 'pure map', params: { controls: [] }, visible: [], hidden: ['.search', '.toolbar', '.sidebar', '.status-pill', '.maplibregl-ctrl-zoom-in', '.maplibregl-ctrl-compass', '.maplibregl-ctrl-scale', '.sidebar-toggle'] },
    {
      name: 'individual buttons',
      params: { controls: ['draw.point', 'draw.polygon', 'measure.distance', 'zoom'] },
      visible: ['[data-control="draw.point"]', '[data-control="draw.polygon"]', '[data-control="measure.distance"]', '.maplibregl-ctrl-zoom-in'],
      hidden: ['[data-control="draw.line"]', '[data-control="measure.area"]', '.search', '.options-button', '.maplibregl-ctrl-compass'],
    },
    {
      name: 'exclusions',
      params: { controls: ['-draw', '-status', '-scale'] },
      visible: ['.search', '[data-control="measure.distance"]', '.sidebar', '.options-button', '.maplibregl-ctrl-zoom-in'],
      hidden: ['[data-control="draw.point"]', '.status-pill', '.maplibregl-ctrl-scale'],
    },
    { name: 'read-only hides drawing and an otherwise empty toolbar', params: { controls: ['draw', 'layers'], readonly: true }, visible: ['.sidebar'], hidden: ['.toolbar', '.add-layer', '.layer-actions'] },
  ];
  for (const c of cases) {
    test(`controls: ${c.name}`, async ({ page }) => {
      const map = await host(page, c.params);
      await map.locator('.maplibregl-canvas').waitFor();
      for (const sel of c.visible) await expect(map.locator(sel).first(), sel).toBeVisible();
      for (const sel of c.hidden) await expect(map.locator(sel), sel).toHaveCount(0);
      await expect(map.locator('.maplibregl-ctrl-attrib')).toHaveCount(0);
    });
  }

  test('appearance and units', async ({ page }) => {
    const map = await host(page, { theme: 'dark', unit: 'nm', coords: 'mgrs', controls: ['scale', 'status', 'settings', 'terrain'] });
    await expect(map.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await expect(map.locator('.maplibregl-ctrl-scale')).toContainText('nm');
    await map.locator('.map').hover();
    await expect(map.locator('.status-pill .coords')).toHaveText(/^\d{1,2}[A-Z] [A-Z]{2} \d{5} \d{5}$/);
    await map.locator('.options-button').click();
    await expect(map.locator('[data-control="settings.unit"] [aria-checked="true"]')).toHaveText('NM');
  });

  test('terrain options from the URL', async ({ page, data }) => {
    test.skip(!(await data.caps()).terrain, 'terrain data not installed');
    const map = await host(page, { hillshade: false, contours: true, terrain3d: true, controls: ['terrain'] });
    await map.locator('.options-button').click();
    await expect(map.locator('[data-control="terrain.hillshade"] [role="switch"]')).toHaveAttribute('aria-checked', 'false');
    await expect(map.locator('[data-control="terrain.contours"] [role="switch"]')).toHaveAttribute('aria-checked', 'true');
    await expect(map.locator('[data-control="terrain.3d"] [role="switch"]')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await call(page, 'getView')).pitch).toBeGreaterThan(30);
  });

  test('layers and select', async ({ page, data }) => {
    const shown = await data.layer();
    const hiddenLayer = await data.layer();
    const pin = await data.point(shown.id, 46.7, 24.7, 'Selected by URL');
    await data.point(hiddenLayer.id, 46.71, 24.71, 'Hidden');
    const map = await host(page, { layers: [shown.id], select: pin.id, controls: ['layers', 'featurePanel', 'select'] });
    await expect(map.locator('.feature-panel h2')).toContainText('Selected by URL');
    await expect(map.locator(`[data-layer-id="${hiddenLayer.id}"] .visibility`)).toHaveAttribute('aria-pressed', 'false');
    await expect(map.locator(`[data-layer-id="${shown.id}"] .visibility`)).toHaveAttribute('aria-pressed', 'true');
  });

  test('interaction lock and zoom limits', async ({ page }) => {
    const map = await host(page, { interactive: false, minZoom: 6, maxZoom: 12, controls: [] });
    const before = await call(page, 'getView');
    const box = (await page.locator('#host').boundingBox())!;
    await page.mouse.move(box.x + 700, box.y + 400);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 300, { steps: 10 });
    await page.mouse.up();
    await page.mouse.wheel(0, -800);
    await page.waitForTimeout(500);
    expect(await call(page, 'getView')).toEqual(before);
    await call(page, 'setView', { zoom: 2, animate: false });
    expect((await call(page, 'getView')).zoom).toBeGreaterThanOrEqual(6);
    await call(page, 'setView', { zoom: 18, animate: false });
    expect((await call(page, 'getView')).zoom).toBeLessThanOrEqual(12);
    await expect(map.locator('.search')).toHaveCount(0);
  });
});

test.describe('embed commands and events', () => {
  test('view, search, markers and tools', async ({ page }) => {
    const map = await host(page, { controls: ['measure', 'zoom'] });
    await call(page, 'setView', { center: [55.2708, 25.2048], zoom: 12, animate: false });
    const view = await call(page, 'getView');
    expect(view.center[0]).toBeCloseTo(55.2708, 3);
    await expect.poll(() => eventNames(page)).toContain('moveend');

    await call(page, 'fitBounds', [46.5, 24.5, 46.9, 24.9], { padding: 0 });
    await expect.poll(async () => (await call(page, 'getView')).center[1]).toBeCloseTo(24.7, 1);

    const results = await call(page, 'search', '24.7136, 46.6753');
    expect(results[0]).toMatchObject({ type: 'coordinates' });

    await call(page, 'setMarkers', [{ id: 'hq', lon: 46.7, lat: 24.7, label: 'HQ', sidc: '10031000001211000000' }, { id: 'truck', lon: 46.72, lat: 24.71, label: 'Truck' }]);
    await call(page, 'setView', { center: [46.71, 24.705], zoom: 14, animate: false });
    // A click on a host marker reports its id.
    await page.waitForTimeout(800);
    const frame = page.frames().find((f) => f.url().includes('/embed'))!;
    const pos = await frame.evaluate(() => {
      const c = document.querySelector('.maplibregl-canvas')!.getBoundingClientRect();
      return { w: c.width, h: c.height };
    });
    const vw = await call(page, 'getView');
    // Marker "truck" at 46.72,24.71 relative to center 46.71,24.705 at zoom 14: compute pixels via Web Mercator.
    const scale = (512 * 2 ** vw.zoom) / 360;
    const toY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const dx = (46.72 - vw.center[0]) * scale;
    const dy = -(toY(24.71) - toY(vw.center[1])) * ((512 * 2 ** vw.zoom) / (2 * Math.PI));
    const hostBox = (await page.locator('#host').boundingBox())!;
    await page.mouse.click(hostBox.x + pos.w / 2 + dx, hostBox.y + pos.h / 2 + dy);
    await expect.poll(async () => (await events(page)).filter((e) => e.event === 'click').at(-1)?.data.markerId).toBe('truck');

    await call(page, 'setMarkers', [{ id: 'hq', lon: 1, lat: 1 }], true);
    await call(page, 'removeMarkers', ['hq']);
    await call(page, 'removeMarkers');

    await call(page, 'setTool', 'measure:distance');
    await expect(map.locator('[data-control="measure.distance"]')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(hostBox.x + 500, hostBox.y + 400, { steps: 3 });
    await page.mouse.click(hostBox.x + 400, hostBox.y + 400);
    await page.mouse.move(hostBox.x + 600, hostBox.y + 450, { steps: 3 });
    await page.mouse.dblclick(hostBox.x + 700, hostBox.y + 450);
    await expect.poll(async () => (await events(page)).filter((e) => e.event === 'measure').at(-1)?.data.meters ?? 0).toBeGreaterThan(0);
    await call(page, 'setTool', 'none');
    await expect(call(page, 'setTool', 'draw:hexagon')).rejects.toThrow('Unknown tool');
  });

  test('features, layers and their events', async ({ page, data }) => {
    const layerA = await data.layer();
    const layerB = await data.layer();
    await host(page, { controls: ['layers', 'featurePanel', 'select'] });
    await expect.poll(async () => (await call(page, 'listLayers')).some((l: { id: string }) => l.id === layerB.id)).toBe(true);

    await call(page, 'setActiveLayer', layerB.id);
    const f = await call(page, 'addFeature', { kind: 'point', name: 'From host', geometry: { type: 'Point', coordinates: [46.7, 24.7] } });
    expect(f.layerId).toBe(layerB.id);
    expect((await call(page, 'listFeatures', layerB.id)).map((x: { id: string }) => x.id)).toContain(f.id);

    const updated = await call(page, 'updateFeature', f.id, { name: 'Renamed by host' });
    expect(updated.version).toBe(2);
    await call(page, 'selectFeature', f.id, true);
    await call(page, 'setLayerVisible', layerA.id, false);
    await expect(call(page, 'setLayerVisible', '00000000-0000-4000-8000-000000000000', false)).rejects.toThrow('Layer not found');

    // A change by another user arrives as an event too.
    const other = await data.point(layerA.id, 46.8, 24.8, 'From another user');
    await expect.poll(async () => (await events(page)).some((e) => e.event === 'featureCreated' && e.data.feature.id === other.id)).toBe(true);

    await call(page, 'deleteFeature', f.id);
    const names = await eventNames(page);
    for (const ev of ['featureCreated', 'featureUpdated', 'select', 'featureDeleted']) expect(names).toContain(ev);
  });

  test('options, controls and interaction at runtime', async ({ page }) => {
    const map = await host(page);
    await map.locator('.search').waitFor();
    await call(page, 'setOptions', { theme: 'dark', unit: 'mi' });
    await expect(map.locator('.app')).toHaveAttribute('data-theme', 'dark');

    expect(await call(page, 'setControls', ['none', 'zoom'], true)).toEqual({ controls: ['zoom'], readonly: true });
    await expect(map.locator('.search')).toHaveCount(0);
    await expect(map.locator('.maplibregl-ctrl-zoom-in')).toBeVisible();
    await expect(map.locator('.maplibregl-ctrl-compass')).toHaveCount(0);
    expect(await call(page, 'getControls')).toEqual({ controls: ['zoom'], readonly: true });
    await expect(call(page, 'setControls', ['zoom', 'bogus'])).rejects.toThrow('Unknown controls: bogus');

    await call(page, 'setInteraction', { maxBounds: [40, 20, 50, 28] });
    await call(page, 'setView', { center: [10, 10], animate: false });
    const v = await call(page, 'getView');
    expect(v.center[0]).toBeGreaterThanOrEqual(40);
    await call(page, 'setInteraction', { maxBounds: null });
    await expect(call(page, 'setInteraction', { minZoom: 99 })).rejects.toThrow('minZoom');

    await call(page, 'setControls', ['all'], false);
    await expect(map.locator('.search')).toBeVisible();
  });
});
