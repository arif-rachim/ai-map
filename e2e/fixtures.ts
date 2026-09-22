import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { DataCapabilities, MapFeature, MapLayer } from '@ai-map/shared';

export { expect };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Every page is watched: console errors, uncaught exceptions and requests to non-local hosts fail the test
 * (the product must work fully offline).
 */
export const test = base.extend<{ guard: void; data: TestData }>({
  guard: [
    async ({ context, baseURL }, use) => {
      const problems: string[] = [];
      const allowed = new Set([...LOCAL_HOSTS, new URL(baseURL!).hostname]);
      context.on('page', (page) => watch(page, problems, allowed));
      for (const page of context.pages()) watch(page, problems, allowed);
      await use();
      expect(problems, 'console errors or external requests').toEqual([]);
    },
    { auto: true },
  ],
  data: async ({ request }, use) => {
    const data = new TestData(request);
    await use(data);
    await data.cleanup();
  },
});

function watch(page: Page, problems: string[], allowed: Set<string>) {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && !allowed.has(u.hostname)) problems.push(`external request: ${u.origin}`);
  });
}

/** Creates layers/features through the public API and removes them afterwards. */
export class TestData {
  private layers: string[] = [];
  constructor(private readonly request: APIRequestContext) {}

  async caps(): Promise<DataCapabilities> {
    return (await this.request.get('/api/v1/capabilities')).json();
  }

  async layer(name = `e2e ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`): Promise<MapLayer> {
    const res = await this.request.post('/api/v1/layers', { data: { name } });
    expect(res.status()).toBe(201);
    const layer = (await res.json()) as MapLayer;
    this.layers.push(layer.id);
    return layer;
  }

  async point(layerId: string, lon: number, lat: number, name: string): Promise<MapFeature> {
    const res = await this.request.post('/api/v1/features', { data: { layerId, kind: 'point', geometry: { type: 'Point', coordinates: [lon, lat] }, name } });
    expect(res.status()).toBe(201);
    return res.json();
  }

  async features(layerId: string): Promise<MapFeature[]> {
    return (await this.request.get(`/api/v1/features?layerId=${layerId}`)).json();
  }

  async cleanup() {
    for (const id of this.layers) await this.request.delete(`/api/v1/layers/${id}`);
  }
}

export async function openMap(page: Page, path = '/') {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      // storage unavailable
    }
  });
  await page.goto(path);
  await waitMapReady(page);
}

/** Waits until the map, its overlays and the drawing tools accept input. */
export async function waitMapReady(page: Page) {
  await page.locator('.map[data-ready]').waitFor({ timeout: 30_000 });
}

/** Waits for the live connection (drawings loaded). */
export async function waitLive(page: Page) {
  await page.locator('.status-dot:not(.off)').waitFor();
}

export async function search(page: Page, q: string) {
  await page.locator('.search input').fill(q);
  await page.locator('.search-item').first().waitFor();
  await page.keyboard.press('Enter');
  await page.locator('.search-popup').waitFor();
  await waitMapStill(page);
}

/** Waits until the camera stops moving (e.g. the search fly-to); clicks during an animation only stop it. */
export async function waitMapStill(page: Page) {
  await page.waitForTimeout(100);
  await page.locator('.map:not([data-moving])').waitFor({ timeout: 15_000 });
}
