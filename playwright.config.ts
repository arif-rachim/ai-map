import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against a running stack (dev: `npm run dev:api` + `npm run dev:web`, or an installed server).
 *   E2E_BASE_URL   default http://localhost:5173
 *   E2E_ADMIN_TOKEN the server's ADMIN_API_TOKEN (tests create data and act as admin)
 *   CHROME_PATH    Chrome/Chromium binary (no browser download needed; works offline). Default /usr/bin/google-chrome
 * Tests that need map data (tiles, terrain, geocoder) skip with a reason when it is not installed.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
      // Software WebGL so MapLibre renders on machines without a GPU (CI, servers).
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
