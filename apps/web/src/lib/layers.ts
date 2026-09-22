import { api } from './api';
import { useStore } from '../store';

let creating: Promise<string> | null = null;

/**
 * Layer for new drawings: the active layer, else the first layer, else a new "Default" layer
 * (all layers can be deleted through the API, and saving must never fail silently because of it).
 */
export async function ensureLayerId(): Promise<string> {
  const s = useStore.getState();
  if (s.activeLayerId && s.layers.some((l) => l.id === s.activeLayerId)) return s.activeLayerId;
  if (s.layers[0]) {
    s.setActiveLayer(s.layers[0].id);
    return s.layers[0].id;
  }
  creating ??= api
    .createLayer({ name: 'Default' })
    .then((layer) => {
      const st = useStore.getState();
      st.upsertLayer(layer);
      st.setActiveLayer(layer.id);
      return layer.id;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}
