import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { App } from './App';
import { initI18n } from './i18n';
import { useStore } from './store';

await initI18n();

if (import.meta.env.DEV) {
  // Debugging aid for development and browser tests only; stripped from production builds.
  const { drawRef, mapRef } = await import('./mapRef');
  Object.assign(window, { __aimap: { useStore, mapRef, drawRef } });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
