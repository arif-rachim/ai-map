import * as turf from '@turf/turf';
import {
  EMBED_PROTOCOL_VERSION,
  isEmbedMessage,
  lineSegments,
  resolveControls,
  unknownControls,
  ALL_CONTROLS,
  type EmbedCommandName,
  type EmbedCommands,
  type EmbedEventName,
  type EmbedEvents,
  type MapFeature,
  type MapView,
  type SearchResultItem,
} from '@ai-map/shared';
import { api, ApiError } from './api';
import { featureBounds } from './featureGeo';
import { ensureLayerId } from './layers';
import { DRAW_TOOLS, MEASURE_TOOLS } from './layout';
import { mapRef, whenMapReady } from '../mapRef';
import { useStore, type DrawTool, type MeasureTool, type Tool } from '../store';
import i18n, { applyDirection } from '../i18n';

type Handler<K extends EmbedCommandName> = (params: EmbedCommands[K]['params']) => Promise<EmbedCommands[K]['result']> | EmbedCommands[K]['result'];

function view(): MapView {
  const map = mapRef.current!;
  const c = map.getCenter();
  return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

function emit<K extends EmbedEventName>(event: K, data: EmbedEvents[K]): void {
  if (window.parent === window) return;
  // No authentication by design (LAN deployment): events go to whichever page embeds the map.
  window.parent.postMessage({ source: 'aimap', version: EMBED_PROTOCOL_VERSION, type: 'event', event, data }, '*');
}

function requireMap() {
  if (!mapRef.current) throw new Error('Map is not ready yet');
  return mapRef.current;
}

export function parseTool(tool: string): Tool {
  if (tool === 'none') return { type: 'none' };
  const [type, kind] = tool.split(':');
  if (type === 'draw' && (DRAW_TOOLS as string[]).includes(kind!)) return { type: 'draw', kind: kind as DrawTool };
  if (type === 'measure' && (MEASURE_TOOLS as string[]).includes(kind!)) return { type: 'measure', kind: kind as MeasureTool };
  throw new Error(`Unknown tool ${tool}`);
}

export const embedHandlers: { [K in EmbedCommandName]: Handler<K> } = {
  getView: () => view(),
  setView: (p) => {
    const map = requireMap();
    const target = { center: p.center, zoom: p.zoom, bearing: p.bearing, pitch: p.pitch };
    if (p.animate === false) map.jumpTo(target);
    else map.easeTo({ ...target, duration: 800 });
  },
  fitBounds: (p) => {
    requireMap().fitBounds(p.bounds, { padding: p.padding ?? 40, maxZoom: p.maxZoom ?? 16, duration: 800 });
  },
  search: async ({ q, limit }) => {
    const res = await fetch(`/api/v1/search?${new URLSearchParams({ q, lang: useStore.getState().uiLang, limit: String(limit ?? 10) })}`);
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return (await res.json()) as SearchResultItem[];
  },
  listLayers: () => useStore.getState().layers,
  listFeatures: ({ layerId } = {}) => Object.values(useStore.getState().features).filter((f) => !layerId || f.layerId === layerId),
  addFeature: async (p) => {
    const s = useStore.getState();
    const layerId = p.layerId ?? (await ensureLayerId());
    const f = await api.createFeature({ ...p, layerId });
    s.upsertFeature(f);
    return f;
  },
  updateFeature: async ({ id, patch }) => {
    const s = useStore.getState();
    const current = s.features[id];
    if (!current) throw new Error('Feature not found');
    const f = await api.updateFeature(id, { ...patch, version: patch.version ?? current.version });
    s.upsertFeature(f);
    return f;
  },
  deleteFeature: async ({ id }) => {
    await api.deleteFeature(id);
    useStore.getState().removeFeature(id);
  },
  selectFeature: ({ id, zoomTo }) => {
    const s = useStore.getState();
    if (id && !s.features[id]) throw new Error('Feature not found');
    s.select(id);
    if (id && zoomTo) requireMap().fitBounds(featureBounds(s.features[id]!), { padding: 80, maxZoom: 15, duration: 800 });
  },
  setLayerVisible: ({ layerId, visible }) => {
    const s = useStore.getState();
    if (!s.layers.some((l) => l.id === layerId)) throw new Error('Layer not found');
    if (s.hiddenLayerIds.includes(layerId) === visible) s.toggleLayerHidden(layerId);
  },
  setActiveLayer: ({ layerId }) => {
    const s = useStore.getState();
    if (!s.layers.some((l) => l.id === layerId)) throw new Error('Layer not found');
    s.setActiveLayer(layerId);
  },
  setTool: ({ tool }) => useStore.getState().setTool(parseTool(tool)),
  setOptions: (o) => {
    const s = useStore.getState();
    if (o.theme) s.setTheme(o.theme);
    if (o.labelLang) s.setLabelLang(o.labelLang);
    if (o.unit) s.setUnit(o.unit);
    if (o.coordFormat) s.setCoordFormat(o.coordFormat);
    for (const k of ['hillshade', 'contours', 'terrain3d'] as const) if (o[k] !== undefined) s.setTerrainOption(k, o[k]!);
    if (o.uiLang) {
      s.setUiLang(o.uiLang);
      applyDirection(o.uiLang);
      void i18n.changeLanguage(o.uiLang);
    }
  },
  setMarkers: ({ markers, replace }) => {
    const s = useStore.getState();
    const byId = new Map((replace ? [] : s.markers).map((m) => [m.id, m]));
    for (const m of markers) byId.set(m.id, m);
    s.setMarkers([...byId.values()]);
  },
  removeMarkers: ({ ids } = {}) => {
    const s = useStore.getState();
    s.setMarkers(ids ? s.markers.filter((m) => !ids.includes(m.id)) : []);
  },
  setControls: ({ controls, readonly }) => {
    const s = useStore.getState();
    if (controls) {
      const unknown = unknownControls(controls);
      if (unknown.length) throw new Error(`Unknown controls: ${unknown.join(', ')}`);
    }
    s.setControls(controls ? resolveControls(controls) : s.controls, readonly);
    return currentControls();
  },
  getControls: () => currentControls(),
  setInteraction: (p) => {
    for (const k of ['minZoom', 'maxZoom'] as const) {
      if (p[k] !== undefined && (!Number.isFinite(p[k]) || p[k]! < 0 || p[k]! > 24)) throw new Error(`${k} must be between 0 and 24`);
    }
    if (p.maxBounds && !(p.maxBounds[0] < p.maxBounds[2] && p.maxBounds[1] < p.maxBounds[3])) throw new Error('maxBounds must be minLon,minLat,maxLon,maxLat');
    useStore.getState().setInteraction(p);
  },
};

function currentControls() {
  const s = useStore.getState();
  // Stable order (declaration order) so hosts can compare results.
  return { controls: ALL_CONTROLS.filter((c) => s.controls.has(c)), readonly: s.readonly };
}

/** Connects the embedded map to its host page via window.postMessage. */
export function startEmbedBridge(): () => void {
  const onMessage = async (e: MessageEvent) => {
    const msg = e.data;
    if (!isEmbedMessage(msg) || msg.type !== 'command') return;
    const reply = (body: object) =>
      (e.source as WindowProxy | null)?.postMessage({ source: 'aimap', version: EMBED_PROTOCOL_VERSION, type: 'response', id: msg.id, ...body }, '*');
    const handler = embedHandlers[msg.command] as Handler<EmbedCommandName> | undefined;
    if (!handler) return reply({ ok: false, error: `Unknown command ${msg.command}` });
    try {
      reply({ ok: true, result: await handler(msg.params as never) });
    } catch (err) {
      const message = err instanceof ApiError && err.status === 409 ? 'Version conflict: feature was modified' : (err as Error).message;
      reply({ ok: false, error: message });
    }
  };
  window.addEventListener('message', onMessage);

  const unsubMap = whenMapReady((map) => {
    emit('ready', { version: EMBED_PROTOCOL_VERSION, view: view() });
    map.on('moveend', () => emit('moveend', view()));
    map.on('click', (ev) => {
      const layers = ['app:marker-dot', 'app:marker-symbol', 'app:f-milsymbol', 'app:f-point', 'app:f-text', 'app:f-line', 'app:f-line-dash', 'app:f-fill'].filter((id) =>
        map.getLayer(id),
      );
      const hits = map.queryRenderedFeatures(
        [
          [ev.point.x - 4, ev.point.y - 4],
          [ev.point.x + 4, ev.point.y + 4],
        ],
        { layers },
      );
      const marker = hits.find((h) => h.layer.id.startsWith('app:marker'));
      const feature = hits.find((h) => h.layer.id.startsWith('app:f-'));
      emit('click', {
        lon: ev.lngLat.lng,
        lat: ev.lngLat.lat,
        markerId: (marker?.properties?.markerId as string | undefined) ?? null,
        featureId: (feature?.properties?.id as string | undefined) ?? null,
      });
    });
  });

  const unsubStore = useStore.subscribe((s, prev) => {
    if (s.selectedId !== prev.selectedId) emit('select', { feature: s.selectedId ? (s.features[s.selectedId] ?? null) : null });

    // Feature lifecycle events, from this map or other users (real-time); a full reload is not reported.
    if (s.features !== prev.features && s.loadGeneration === prev.loadGeneration) {
      for (const [id, f] of Object.entries(s.features) as [string, MapFeature][]) {
        const old = prev.features[id];
        if (!old) emit('featureCreated', { feature: f });
        else if (old.version !== f.version) emit('featureUpdated', { feature: f });
      }
      for (const id of Object.keys(prev.features)) if (!s.features[id]) emit('featureDeleted', { id });
    }

    if (s.measure !== prev.measure && s.tool.type === 'measure') {
      const m = s.measure;
      if (s.tool.kind === 'distance' && m.coords && m.coords.length >= 2) {
        emit('measure', { tool: 'distance', meters: lineSegments(m.coords).reduce((a, x) => a + x.meters, 0), coordinates: m.coords });
      } else if (s.tool.kind === 'area' && m.coords && m.coords.length >= 3) {
        emit('measure', { tool: 'area', squareMeters: turf.area(turf.polygon([[...m.coords, m.coords[0]!]])), coordinates: m.coords });
      } else if (s.tool.kind === 'rings' && m.center) {
        emit('measure', { tool: 'rings', coordinates: [m.center] });
      }
    }
  });

  return () => {
    window.removeEventListener('message', onMessage);
    unsubMap();
    unsubStore();
  };
}
