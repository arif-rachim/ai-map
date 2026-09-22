import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:3000';

/** Dev only: serves ../../dist-data at /data with HTTP range support (nginx does this in production). */
function devData(): Plugin {
  const root = fileURLToPath(new URL('../../dist-data', import.meta.url));
  return {
    name: 'dev-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        const file = path.join(root, path.normalize(rel));
        if (!file.startsWith(root)) return next();
        let size: number;
        try {
          const st = statSync(file);
          if (!st.isFile()) return next();
          size = st.size;
        } catch {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Accept-Ranges', 'bytes');
        if (file.endsWith('.pbf')) res.setHeader('Content-Type', 'application/x-protobuf');
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
        if (m) {
          const start = m[1] ? Number(m[1]) : size - Number(m[2]);
          const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', end - start + 1);
          return createReadStream(file, { start, end }).pipe(res);
        }
        res.setHeader('Content-Length', size);
        createReadStream(file).pipe(res);
      });
    },
  };
}

const nm = (p: string) => fileURLToPath(new URL(`../../node_modules/${p}`, import.meta.url));

/**
 * Same-origin static copies of runtime files that libraries load by URL (no CDN in airgap):
 * - MapLibre v6 module worker (+ the shared chunk it imports), set via setWorkerUrl()
 * - Arabic/RTL text shaping plugin (package "exports" hides the prebuilt bundle)
 */
const VENDOR_FILES: Record<string, string> = {
  // Full MapLibre ESM build + CSS for SDK examples and external pages on the airgapped LAN.
  'vendor/maplibre/maplibre-gl.mjs': nm('maplibre-gl/dist/maplibre-gl.mjs'),
  'vendor/maplibre/maplibre-gl.css': nm('maplibre-gl/dist/maplibre-gl.css'),
  'vendor/maplibre/maplibre-gl-worker.mjs': nm('maplibre-gl/dist/maplibre-gl-worker.mjs'),
  'vendor/maplibre/maplibre-gl-shared.mjs': nm('maplibre-gl/dist/maplibre-gl-shared.mjs'),
  'vendor/mapbox-gl-rtl-text.js': nm('@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js'),
};

const SDK_DIRS: Record<string, string> = {
  sdk: fileURLToPath(new URL('../../packages/sdk/dist', import.meta.url)),
  'sdk/examples': fileURLToPath(new URL('../../packages/sdk/examples', import.meta.url)),
};

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ts': 'text/plain', '.map': 'application/json' };
const contentType = (f: string) => TYPES[path.extname(f)] ?? 'application/octet-stream';

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  } catch {
    return [];
  }
}

function vendorFiles(): Plugin {
  return {
    name: 'vendor-files',
    configureServer(server) {
      for (const [publicPath, file] of Object.entries(VENDOR_FILES)) {
        server.middlewares.use(`/${publicPath}`, (_req, res) => {
          res.setHeader('Content-Type', contentType(file));
          createReadStream(file).pipe(res);
        });
      }
      // SDK bundle (packages/sdk/dist, run `npm run build -w @ai-map/sdk`) and its examples.
      for (const [prefix, dir] of Object.entries(SDK_DIRS).reverse()) {
        server.middlewares.use(`/${prefix}/`, (req, res, next) => {
          const name = path.basename(decodeURIComponent((req.url ?? '').split('?')[0]!)) || 'index.html';
          if (!listFiles(dir).includes(name)) return next();
          res.setHeader('Content-Type', contentType(name));
          createReadStream(path.join(dir, name)).pipe(res);
        });
      }
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(VENDOR_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
      }
      for (const [prefix, dir] of Object.entries(SDK_DIRS)) {
        const files = listFiles(dir);
        if (prefix === 'sdk' && !files.includes('aimap-sdk.js')) this.error('SDK not built: run `npm run build -w @ai-map/sdk` first');
        for (const name of files) this.emitFile({ type: 'asset', fileName: `${prefix}/${name}`, source: readFileSync(path.join(dir, name)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), devData(), vendorFiles()],
  server: {
    proxy: {
      '/api': { target: api, ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 3000 },
});
