import { defineConfig } from 'vite';

// Library build: ESM (aimap-sdk.mjs) and UMD (aimap-sdk.js, global `AiMap`). maplibre-gl is never bundled.
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', name: 'AiMap', formats: ['es', 'umd'], fileName: (f) => (f === 'es' ? 'aimap-sdk.mjs' : 'aimap-sdk.js') },
    rollupOptions: { external: ['maplibre-gl'], output: { globals: { 'maplibre-gl': 'maplibregl' } } },
    sourcemap: true,
    minify: true,
    emptyOutDir: true,
  },
});
