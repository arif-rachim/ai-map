import { create } from 'zustand';
import { parseEmbedUrl, resolveControls, type EmbedUrlParams, type MarkerInput } from '@ai-map/shared';
import type { DataCapabilities, MapFeature, MapLayer, ServerMessage } from '@ai-map/shared';
import type { CoordFormat } from '@ai-map/shared';
import type { DistanceUnit } from '@ai-map/shared';
import type { Theme } from './lib/basemap';
import type { ThemePreference } from '@ai-map/shared';

export type DrawTool = 'rectangle' | 'polygon' | 'circle' | 'line' | 'point' | 'text' | 'milsymbol';
export type MeasureTool = 'distance' | 'area' | 'rings';
export interface MeasureState {
  /** Vertices of the measured line (distance) or ring (area). */
  coords: [number, number][] | null;
  center: [number, number] | null;
  radii: string;
}

export interface ConfirmDialog {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const systemTheme = (): Theme => (darkQuery?.matches ? 'dark' : 'light');
const resolveTheme = (t: ThemePreference): Theme => (t === 'auto' ? systemTheme() : t);

export interface Interaction {
  interactive: boolean;
  minZoom: number | null;
  maxZoom: number | null;
  maxBounds: [number, number, number, number] | null;
}

export type Tool = { type: 'none' } | { type: 'draw'; kind: DrawTool } | { type: 'measure'; kind: MeasureTool };

/** Embed mode (/embed): URL parameters given by the embedding page. Visible controls live in the store. */
export interface EmbedConfig {
  enabled: boolean;
  params: EmbedUrlParams;
}

export function detectEmbed(loc: { pathname: string; search: string }): EmbedConfig {
  const enabled = loc.pathname.replace(/\/+$/, '').endsWith('/embed');
  return { enabled, params: enabled ? parseEmbedUrl(loc.search) : {} };
}

export const embed: EmbedConfig = detectEmbed(location);

function loadPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(`aimap.${key}`) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string): void {
  if (embed.enabled) return; // embedded maps must not change the full app's saved preferences
  try {
    localStorage.setItem(`aimap.${key}`, value);
  } catch {
    // storage unavailable
  }
}

interface State {
  capabilities: DataCapabilities | null;
  online: boolean;
  layers: MapLayer[];
  features: Record<string, MapFeature>;
  hiddenLayerIds: string[];
  activeLayerId: string | null;
  selectedId: string | null;
  editingId: string | null;
  tool: Tool;
  unit: DistanceUnit;
  coordFormat: CoordFormat;
  /** Preference (auto follows the OS); `resolvedTheme` is what is rendered. */
  theme: ThemePreference;
  resolvedTheme: Theme;
  sidebarOpen: boolean;
  /** Pending confirmation dialog. */
  dialog: ConfirmDialog | null;
  milSidc: string;
  hillshade: boolean;
  contours: boolean;
  terrain3d: boolean;
  /** Elevation (m) under the cursor; null when unknown. */
  cursorElevation: number | null;
  /** Point highlighted on the map while hovering an elevation profile. */
  profileHover: [number, number] | null;
  measure: MeasureState;
  /** Visible UI control ids (see resolveControls). */
  controls: Set<string>;
  /** End-user editing disabled (embed readonly). */
  readonly: boolean;
  interaction: Interaction;
  /** Temporary markers set by an embedding host page. */
  markers: MarkerInput[];
  /** Incremented on every full (re)load so observers can tell a reload from individual changes. */
  loadGeneration: number;
  cursor: [number, number] | null;
  zoom: number;
  notice: string | null;

  setCapabilities: (c: DataCapabilities) => void;
  setOnline: (v: boolean) => void;
  loadAll: (layers: MapLayer[], features: MapFeature[]) => void;
  upsertFeature: (f: MapFeature) => void;
  removeFeature: (id: string) => void;
  upsertLayer: (l: MapLayer) => void;
  removeLayer: (id: string) => void;
  applyServerMessage: (m: ServerMessage) => void;
  toggleLayerHidden: (id: string) => void;
  setActiveLayer: (id: string) => void;
  select: (id: string | null) => void;
  setEditing: (id: string | null) => void;
  setTool: (t: Tool) => void;
  setUnit: (u: DistanceUnit) => void;
  setCoordFormat: (f: CoordFormat) => void;
  setTheme: (t: ThemePreference) => void;
  setSidebarOpen: (open: boolean) => void;
  confirm: (d: Omit<ConfirmDialog, 'resolve'>) => Promise<boolean>;
  closeDialog: (result: boolean) => void;
  setMilSidc: (s: string) => void;
  setTerrainOption: (key: 'hillshade' | 'contours' | 'terrain3d', value: boolean) => void;
  setCursorElevation: (e: number | null) => void;
  setProfileHover: (c: [number, number] | null) => void;
  setMeasure: (m: Partial<MeasureState>) => void;
  setMarkers: (markers: MarkerInput[]) => void;
  setControls: (controls: Set<string>, readonly?: boolean) => void;
  setInteraction: (i: Partial<Interaction>) => void;
  setCursor: (c: [number, number] | null, zoom: number) => void;
  notify: (msg: string | null) => void;
}

export const useStore = create<State>((set, get) => ({
  capabilities: null,
  online: false,
  layers: [],
  features: {},
  hiddenLayerIds: [],
  activeLayerId: null,
  selectedId: null,
  editingId: null,
  tool: { type: 'none' },
  unit: embed.params.unit ?? loadPref<DistanceUnit>('unit', 'km'),
  coordFormat: embed.params.coords ?? loadPref<CoordFormat>('coordFormat', 'dd'),
  theme: embed.params.theme ?? loadPref<ThemePreference>('theme', 'auto'),
  resolvedTheme: resolveTheme(embed.params.theme ?? loadPref<ThemePreference>('theme', 'auto')),
  sidebarOpen: embed.enabled ? true : loadPref<string>('sidebarOpen', typeof innerWidth === 'number' && innerWidth < 760 ? 'false' : 'true') === 'true',
  dialog: null,
  milSidc: '10031000001211000000',
  hillshade: embed.params.hillshade ?? loadPref<string>('hillshade', 'true') === 'true',
  contours: embed.params.contours ?? loadPref<string>('contours', 'false') === 'true',
  terrain3d: embed.params.terrain3d ?? loadPref<string>('terrain3d', 'false') === 'true',
  cursorElevation: null,
  profileHover: null,
  measure: { coords: null, center: null, radii: loadPref('radii', '10, 25, 50') },
  controls: resolveControls(embed.params.controls),
  readonly: !!embed.params.readonly,
  interaction: {
    interactive: embed.params.interactive ?? true,
    minZoom: embed.params.minZoom ?? null,
    maxZoom: embed.params.maxZoom ?? null,
    maxBounds: embed.params.maxBounds ?? null,
  },
  markers: [],
  loadGeneration: 0,
  cursor: null,
  zoom: 0,
  notice: null,

  setCapabilities: (capabilities) => set({ capabilities }),
  setOnline: (online) => set({ online }),
  loadAll: (layers, features) =>
    set((s) => {
      const sorted = [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
      const active = sorted.some((l) => l.id === s.activeLayerId) ? s.activeLayerId : (sorted[0]?.id ?? null);
      const initialHidden = embed.params.layers
        ? sorted.filter((l) => !embed.params.layers!.includes(l.id)).map((l) => l.id)
        : sorted.filter((l) => !l.visible).map((l) => l.id);
      return {
        layers: sorted,
        features: Object.fromEntries(features.map((f) => [f.id, f])),
        hiddenLayerIds: s.layers.length ? s.hiddenLayerIds : initialHidden,
        activeLayerId: active,
        loadGeneration: s.loadGeneration + 1,
      };
    }),
  upsertFeature: (f) =>
    set((s) => {
      const existing = s.features[f.id];
      if (existing && existing.version > f.version) return s;
      return { features: { ...s.features, [f.id]: f } };
    }),
  removeFeature: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.features;
      return {
        features: rest,
        selectedId: s.selectedId === id ? null : s.selectedId,
        editingId: s.editingId === id ? null : s.editingId,
      };
    }),
  upsertLayer: (l) =>
    set((s) => {
      const layers = [...s.layers.filter((x) => x.id !== l.id), l].sort((a, b) => a.sortOrder - b.sortOrder);
      return { layers, activeLayerId: s.activeLayerId ?? l.id };
    }),
  removeLayer: (id) =>
    set((s) => {
      const layers = s.layers.filter((l) => l.id !== id);
      const features = Object.fromEntries(Object.entries(s.features).filter(([, f]) => f.layerId !== id));
      return {
        layers,
        features,
        activeLayerId: s.activeLayerId === id ? (layers[0]?.id ?? null) : s.activeLayerId,
        selectedId: s.selectedId && features[s.selectedId] ? s.selectedId : null,
      };
    }),
  applyServerMessage: (m) => {
    const s = get();
    switch (m.type) {
      case 'feature.created':
      case 'feature.updated':
        return s.upsertFeature(m.feature);
      case 'feature.deleted':
        return s.removeFeature(m.id);
      case 'layer.created':
      case 'layer.updated':
        return s.upsertLayer(m.layer);
      case 'layer.deleted':
        return s.removeLayer(m.id);
    }
  },
  toggleLayerHidden: (id) =>
    set((s) => ({
      hiddenLayerIds: s.hiddenLayerIds.includes(id) ? s.hiddenLayerIds.filter((x) => x !== id) : [...s.hiddenLayerIds, id],
    })),
  setActiveLayer: (activeLayerId) => set({ activeLayerId }),
  select: (selectedId) => set({ selectedId }),
  setEditing: (editingId) => set({ editingId }),
  setTool: (tool) => set((s) => ({ tool, editingId: null, measure: { ...s.measure, coords: null, center: null } })),
  setUnit: (unit) => (savePref('unit', unit), set({ unit })),
  setCoordFormat: (coordFormat) => (savePref('coordFormat', coordFormat), set({ coordFormat })),
  setTheme: (theme) => (savePref('theme', theme), set({ theme, resolvedTheme: resolveTheme(theme) })),
  setSidebarOpen: (sidebarOpen) => (savePref('sidebarOpen', String(sidebarOpen)), set({ sidebarOpen })),
  confirm: (d) =>
    new Promise<boolean>((resolve) => {
      get().dialog?.resolve(false);
      set({ dialog: { ...d, resolve } });
    }),
  closeDialog: (result) => {
    get().dialog?.resolve(result);
    set({ dialog: null });
  },
  setMilSidc: (milSidc) => set({ milSidc }),
  setTerrainOption: (key, value) => (savePref(key, String(value)), set({ [key]: value } as Pick<State, typeof key>)),
  setCursorElevation: (cursorElevation) => set({ cursorElevation }),
  setProfileHover: (profileHover) => set({ profileHover }),
  setMeasure: (m) => {
    if (m.radii !== undefined) savePref('radii', m.radii);
    set((s) => ({ measure: { ...s.measure, ...m } }));
  },
  setMarkers: (markers) => set({ markers }),
  setInteraction: (i) => set((s) => ({ interaction: { ...s.interaction, ...i } })),
  setControls: (controls, readonly) =>
    set((s) => {
      const ro = readonly ?? s.readonly;
      // Leaving read-only or hiding tools must not leave an invisible tool or edit session running.
      const toolHidden =
        (s.tool.type === 'draw' && (ro || !controls.has(`draw.${s.tool.kind}`))) || (s.tool.type === 'measure' && !controls.has(`measure.${s.tool.kind}`));
      return {
        controls,
        readonly: ro,
        ...(toolHidden ? { tool: { type: 'none' as const } } : {}),
        ...(ro ? { editingId: null } : {}),
        ...(!controls.has('featurePanel') && !controls.has('select') ? { selectedId: null } : {}),
      };
    }),
  setCursor: (cursor, zoom) => set({ cursor, zoom }),
  notify: (notice) => set({ notice }),
}));

// Follow OS appearance changes while the preference is "auto".
darkQuery?.addEventListener('change', () => {
  const s = useStore.getState();
  if (s.theme === 'auto') useStore.setState({ resolvedTheme: systemTheme() });
});
