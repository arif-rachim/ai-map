import { ADMIN_TOKEN, expect, openMap, search, test, waitLive, waitMapReady } from './fixtures';

test.describe('full app', () => {
  test('viewers see layers but no editing; admins log in with the password', async ({ page, data }) => {
    const layer = await data.layer();
    await data.point(layer.id, 46.7, 24.7, 'Visible to viewers');
    await openMap(page, '/map', { admin: false });
    await waitLive(page);
    await expect(page.locator('[data-control="draw.point"]')).toHaveCount(0);
    await expect(page.locator('.add-layer')).toHaveCount(0);
    // Nothing is loaded until the user ticks a layer.
    const row = page.locator('.layer-item', { hasText: layer.name });
    await expect(row.locator('.layer-load')).not.toBeChecked();
    await expect(page.locator('.feature-item', { hasText: 'Visible to viewers' })).toHaveCount(0);
    await row.locator('.layer-load').check();
    await expect(page.locator('.feature-item', { hasText: 'Visible to viewers' })).toBeVisible();
    await expect(row.locator('.layer-actions')).toHaveCount(0);
    // The choice is remembered in this browser (openMap's init script clears storage on reload, so read it).
    expect(await page.evaluate(() => localStorage.getItem('aimap.loadedLayers'))).toContain(layer.id);
    await expect(page.locator('.admin-button')).toBeVisible();
  });

  test('loads layers by name from the URL', async ({ page, data }) => {
    const layer = await data.layer();
    await data.point(layer.id, 46.7, 24.7, 'Loaded by name');
    await openMap(page, `/map?layers=${encodeURIComponent(layer.name)}`, { admin: false });
    await waitLive(page);
    await expect(page.locator('.feature-item', { hasText: 'Loaded by name' })).toBeVisible();
  });

  test('renders the floating UI without attribution', async ({ page }) => {
    await openMap(page);
    await expect(page.locator('.search-field')).toBeVisible();
    await expect(page.locator('.toolbar [data-control="draw.point"]')).toBeVisible();
    await expect(page.locator('.sidebar .layers-panel')).toBeVisible();
    await expect(page.locator('.status-pill')).toBeVisible();
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible();
    await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveCount(0);
    await waitLive(page);
  });

  test('search result pin can be removed, cleared, or saved and deleted', async ({ page, data }) => {
    const layer = await data.layer();
    await openMap(page);
    await waitLive(page);
    await page.locator('.layers-panel').getByRole('button', { name: layer.name, exact: false }).first().click();
    const markers = page.locator('.maplibregl-marker');

    await search(page, '24.7136, 46.6753');
    await expect(markers).toHaveCount(1);
    await page.locator('.search-popup').getByRole('button', { name: 'Remove' }).click();
    await expect(markers).toHaveCount(0);

    await search(page, '25.2048, 55.2708');
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(markers).toHaveCount(0);

    await search(page, '23.5880, 58.3829');
    await page.locator('.maplibregl-popup-close-button').click();
    await expect(markers).toHaveCount(1);
    await markers.click();
    await page.locator('.search-popup').getByRole('button', { name: 'Save as Pin' }).click();
    await expect(page.locator('.feature-panel')).toBeVisible();
    await expect(markers).toHaveCount(0);
    await expect.poll(() => data.features(layer.id).then((f) => f.length)).toBe(1);

    await page.locator('.feature-panel').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.feature-panel')).toHaveCount(0);
    await expect.poll(() => data.features(layer.id).then((f) => f.length)).toBe(0);
  });

  test('search results appear above the layers panel', async ({ page }) => {
    await openMap(page);
    await page.locator('.search input').fill('24.7, 46.6');
    await page.locator('.search-item').first().waitFor();
    const onTop = await page.evaluate(() => {
      const r = document.querySelector('.search-results')!.getBoundingClientRect();
      return !!document.elementFromPoint(r.x + 30, r.y + 30)?.closest('.search-results');
    });
    expect(onTop).toBe(true);
  });

  test('draws a rectangle, renames it, edits its shape and deletes it', async ({ page, data }) => {
    const layer = await data.layer();
    await openMap(page);
    await waitLive(page);
    await page.locator('.layers-panel').getByRole('button', { name: layer.name }).first().click();
    await search(page, '24.7136, 46.6753');
    await page.locator('.search-popup').getByRole('button', { name: 'Remove' }).click();

    const map = (await page.locator('.map').boundingBox())!;
    const cx = map.x + map.width / 2;
    const cy = map.y + map.height / 2;
    await page.locator('[data-control="draw.rectangle"]').click();
    // Real pointers hover the map before clicking; Terra Draw starts shapes from pointer-move state.
    await page.mouse.move(cx, cy + 100, { steps: 3 });
    await page.mouse.click(cx - 200, cy + 60);
    await page.mouse.move(cx - 80, cy + 160, { steps: 4 });
    await page.mouse.click(cx - 80, cy + 160);

    const panel = page.locator('.feature-panel');
    await expect(panel).toBeVisible();
    await panel.getByLabel('Name').fill('Zone Alpha');
    await expect.poll(() => data.features(layer.id).then((f) => f[0]?.name)).toBe('Zone Alpha');
    await expect(page.locator('.feature-item', { hasText: 'Zone Alpha' })).toBeVisible();

    const before = (await data.features(layer.id))[0]!;
    await panel.getByRole('button', { name: 'Edit Shape' }).click();
    await page.mouse.move(cx - 140, cy + 110);
    await page.mouse.down();
    await page.mouse.move(cx - 40, cy + 110, { steps: 10 });
    await page.mouse.up();
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => data.features(layer.id).then((f) => f[0]!.version)).toBe(before.version + 1);

    await panel.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => data.features(layer.id).then((f) => f.length)).toBe(0);
  });

  test('a click with slight pointer movement still draws (drag tolerance)', async ({ page, data }) => {
    const layer = await data.layer();
    await openMap(page);
    await waitLive(page);
    await page.locator('.layers-panel').getByRole('button', { name: layer.name }).first().click();
    await page.locator('[data-control="draw.rectangle"]').click();
    // Real mice and touchpads move a few pixels between press and release.
    for (const [x, y] of [[520, 500], [650, 600]]) {
      await page.mouse.move(x, y, { steps: 3 });
      await page.mouse.down();
      await page.mouse.move(x + 3, y + 2);
      await page.mouse.up();
    }
    await expect(page.locator('.feature-panel')).toBeVisible();
    await expect.poll(() => data.features(layer.id).then((f) => f.length)).toBe(1);
  });

  test('a tool chosen before the map finished loading works', async ({ page, data }) => {
    const layer = await data.layer();
    await page.addInitScript((token) => {
      try {
        localStorage.clear();
        localStorage.setItem('aimap.adminToken', token);
      } catch {
        // storage unavailable
      }
    }, ADMIN_TOKEN);
    await page.goto(`/map?layers=${layer.id}`);
    // Selected as early as possible, then never touched again: the map must pick it up once loaded.
    await page.locator('[data-control="draw.point"]').click();
    await waitMapReady(page);
    await waitLive(page);
    await page.locator('.layers-panel').getByRole('button', { name: layer.name }).first().click();
    await expect(page.locator('[data-control="draw.point"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.map:not([data-moving])').waitFor();
    await page.mouse.move(700, 500, { steps: 3 });
    await page.mouse.click(700, 500);
    await expect(page.locator('.feature-panel')).toBeVisible();
    await expect.poll(() => data.features(layer.id).then((f) => f.length)).toBe(1);
  });

  test('measures distance with segments and an elevation profile', async ({ page, data }) => {
    const caps = await data.caps();
    await openMap(page);
    await search(page, '18.2164, 42.5053');
    await page.locator('.search-popup').getByRole('button', { name: 'Remove' }).click();
    const map = (await page.locator('.map').boundingBox())!;
    await page.locator('[data-control="measure.distance"]').click();
    await page.mouse.move(map.x + 500, map.y + 500, { steps: 3 });
    await page.mouse.click(map.x + 400, map.y + 500);
    await page.mouse.move(map.x + 600, map.y + 540, { steps: 4 });
    await page.mouse.click(map.x + 650, map.y + 560);
    await page.mouse.move(map.x + 800, map.y + 480, { steps: 4 });
    await page.mouse.dblclick(map.x + 900, map.y + 450);
    const panel = page.locator('.measure-panel');
    await expect(panel.locator('.hero-value')).toHaveText(/\d+(\.\d+)? (km|m)/);
    await expect(panel.locator('.segments-table tbody tr')).toHaveCount(2);
    if (caps.terrain) await expect(panel.locator('.profile-stats')).toContainText('Highest');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('shares drawings live between users', async ({ browser, page, data, baseURL }) => {
    const layer = await data.layer();
    await openMap(page, '/map', { layers: [layer.id] });
    await waitLive(page);
    const other = await browser.newPage({ baseURL });
    await openMap(other, '/map', { admin: false, layers: [layer.id] });
    await waitLive(other);
    await data.point(layer.id, 46.7, 24.7, 'Checkpoint 4');
    await expect(page.locator('.feature-item', { hasText: 'Checkpoint 4' })).toBeVisible();
    await expect(other.locator('.feature-item', { hasText: 'Checkpoint 4' })).toBeVisible();
    await other.close();
  });

  test('map display options: appearance override and units (English only)', async ({ page }) => {
    await openMap(page);
    await page.locator('.options-button').click();
    const options = page.getByRole('dialog', { name: 'Map display' });
    await options.locator('[data-control="settings.theme"]').getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await options.locator('[data-control="settings.unit"]').getByRole('radio', { name: 'NM' }).click();
    await expect(page.locator('.maplibregl-ctrl-scale')).toContainText('nm');
    // No interface language choice: the app is English, left-to-right.
    await expect(options.locator('[data-control="settings.ui"]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('follows the system appearance by default', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark', baseURL });
    const page = await ctx.newPage();
    await openMap(page);
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await ctx.close();
  });
});
