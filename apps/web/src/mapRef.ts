import type { Map as MlMap } from 'maplibre-gl';
import type { TerraDraw } from 'terra-draw';

/** The single MapLibre instance, set by MapView once created. */
export const mapRef: { current: MlMap | null } = { current: null };

/** The Terra Draw instance bound to the map (drawing, measuring, shape editing). */
export const drawRef: { current: TerraDraw | null } = { current: null };

const readyListeners = new Set<(map: MlMap) => void>();
let readyMap: MlMap | null = null;

/** Runs `cb` once the map and app overlay layers are loaded (immediately if already loaded). */
export function whenMapReady(cb: (map: MlMap) => void): () => void {
  if (readyMap) cb(readyMap);
  else readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

export function markMapReady(map: MlMap | null): void {
  readyMap = map;
  if (!map) return;
  for (const cb of readyListeners) cb(map);
  readyListeners.clear();
}
