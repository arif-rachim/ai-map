import type { MapLayer } from '@ai-map/shared';
import i18n from '../i18n';
import { api } from './api';
import { useStore } from '../store';

/** Layer for new drawings: the active layer, else the first loaded layer. Drawing needs a loaded layer. */
export async function ensureLayerId(): Promise<string> {
  const s = useStore.getState();
  if (s.activeLayerId && s.loadedLayerIds.includes(s.activeLayerId)) return s.activeLayerId;
  const first = s.layers.find((l) => s.loadedLayerIds.includes(l.id));
  if (first) {
    s.setActiveLayer(first.id);
    return first.id;
  }
  throw new Error(i18n.t('layers.needLayer'));
}

/** Matches requested ids or names (case-insensitive) against the layer list. */
export function resolveLayerRefs(refs: string[], layers: MapLayer[]): string[] {
  return refs.flatMap((ref) => {
    const byId = layers.find((l) => l.id === ref);
    if (byId) return [byId.id];
    const name = ref.toLowerCase();
    return layers.filter((l) => l.name.toLowerCase() === name).map((l) => l.id);
  });
}

/** (Re)loads the layer list and the drawings of the loaded layers. */
export async function resyncLayers(): Promise<void> {
  const layers = await api.layers();
  const s = useStore.getState();
  if (s.pendingLayerRequest) s.setLoadedLayers(resolveLayerRefs(s.pendingLayerRequest, layers));
  const ids = useStore.getState().loadedLayerIds.filter((id) => layers.some((l) => l.id === id));
  const features = (await Promise.all(ids.map((id) => api.features(id)))).flat();
  useStore.getState().loadAll(layers, features);
}

export async function loadLayer(id: string): Promise<void> {
  const s = useStore.getState();
  if (s.loadedLayerIds.includes(id)) return;
  s.setLoadedLayers([...s.loadedLayerIds, id]);
  try {
    useStore.getState().addFeatures(await api.features(id));
  } catch (err) {
    useStore.getState().setLoadedLayers(useStore.getState().loadedLayerIds.filter((x) => x !== id));
    throw err;
  }
}

export function unloadLayer(id: string): void {
  const s = useStore.getState();
  s.setLoadedLayers(s.loadedLayerIds.filter((x) => x !== id));
}

export async function setLayerLoaded(id: string, loaded: boolean): Promise<void> {
  if (loaded) await loadLayer(id);
  else unloadLayer(id);
}
