import type { FeatureInput, FeaturePatch, MapFeature, MapLayer } from './schemas';
import type { CoordFormat } from './coords';
import type { DistanceUnit } from './measure';
import type { LabelLang, ThemePreference } from './style';

/**
 * postMessage protocol between a host page and the embedded map (<iframe src="/embed">).
 * Every message carries `source: 'aimap'` and `version: 1`.
 */
export const EMBED_PROTOCOL_VERSION = 1;

export interface MapView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export type ToolName =
  | 'none'
  | 'draw:rectangle'
  | 'draw:polygon'
  | 'draw:circle'
  | 'draw:line'
  | 'draw:point'
  | 'draw:text'
  | 'draw:milsymbol'
  | 'measure:distance'
  | 'measure:area'
  | 'measure:rings';

export interface MarkerInput {
  /** Host-chosen id; re-adding the same id moves/updates the marker. */
  id: string;
  lon: number;
  lat: number;
  label?: string;
  color?: string;
  /** MIL-STD-2525D/E SIDC: draws the symbol instead of a dot. */
  sidc?: string;
}

export interface EmbedOptions {
  theme?: ThemePreference;
  labelLang?: LabelLang;
  uiLang?: 'en' | 'ar';
  unit?: DistanceUnit;
  coordFormat?: CoordFormat;
  hillshade?: boolean;
  contours?: boolean;
  terrain3d?: boolean;
}

export interface SearchResultItem {
  type: 'coordinates' | 'airport' | 'place';
  name: string;
  detail: string;
  lon: number;
  lat: number;
  bbox?: [number, number, number, number];
}

/** Commands: request params and result types. */
export interface EmbedCommands {
  getView: { params: void; result: MapView };
  setView: { params: Partial<MapView> & { animate?: boolean }; result: void };
  fitBounds: { params: { bounds: [number, number, number, number]; padding?: number; maxZoom?: number }; result: void };
  search: { params: { q: string; limit?: number }; result: SearchResultItem[] };
  listLayers: { params: void; result: MapLayer[] };
  listFeatures: { params: { layerId?: string }; result: MapFeature[] };
  /** Persists a feature (shared with all users). `layerId` defaults to the active layer. */
  addFeature: { params: Omit<Partial<FeatureInput>, 'kind' | 'geometry'> & Pick<FeatureInput, 'kind' | 'geometry'>; result: MapFeature };
  /** `version` defaults to the latest known version (last write wins). */
  updateFeature: { params: { id: string; patch: Omit<FeaturePatch, 'version'> & { version?: number } }; result: MapFeature };
  deleteFeature: { params: { id: string }; result: void };
  selectFeature: { params: { id: string | null; zoomTo?: boolean }; result: void };
  setLayerVisible: { params: { layerId: string; visible: boolean }; result: void };
  setActiveLayer: { params: { layerId: string }; result: void };
  setTool: { params: { tool: ToolName }; result: void };
  setOptions: { params: EmbedOptions; result: void };
  /** Temporary markers owned by the host page (not saved, not shared). */
  setMarkers: { params: { markers: MarkerInput[]; replace?: boolean }; result: void };
  removeMarkers: { params: { ids?: string[] }; result: void };
  /** Changes visible UI controls (same syntax as the `controls` URL parameter) and/or read-only mode. */
  setControls: { params: { controls?: string[]; readonly?: boolean }; result: { controls: string[]; readonly: boolean } };
  getControls: { params: void; result: { controls: string[]; readonly: boolean } };
  /** User interaction limits. `maxBounds: null` removes the bounds. */
  setInteraction: {
    params: { interactive?: boolean; minZoom?: number; maxZoom?: number; maxBounds?: [number, number, number, number] | null };
    result: void;
  };
}

export type EmbedCommandName = keyof EmbedCommands;

/** Events emitted by the embedded map. */
export interface EmbedEvents {
  ready: { version: number; view: MapView };
  click: { lon: number; lat: number; featureId: string | null; markerId: string | null };
  moveend: MapView;
  select: { feature: MapFeature | null };
  featureCreated: { feature: MapFeature };
  featureUpdated: { feature: MapFeature };
  featureDeleted: { id: string };
  measure: { tool: 'distance' | 'area' | 'rings'; meters?: number; squareMeters?: number; coordinates?: [number, number][] };
}

export type EmbedEventName = keyof EmbedEvents;

export type EmbedMessage =
  | { source: 'aimap'; version: number; type: 'command'; id: string; command: EmbedCommandName; params?: unknown }
  | { source: 'aimap'; version: number; type: 'response'; id: string; ok: true; result?: unknown }
  | { source: 'aimap'; version: number; type: 'response'; id: string; ok: false; error: string }
  | { source: 'aimap'; version: number; type: 'event'; event: EmbedEventName; data: unknown };

export function isEmbedMessage(data: unknown): data is EmbedMessage {
  return typeof data === 'object' && data !== null && (data as { source?: unknown }).source === 'aimap';
}

/** URL query parameters understood by /embed. */
export interface EmbedUrlParams {
  center?: [number, number];
  zoom?: number;
  bearing?: number;
  pitch?: number;
  theme?: ThemePreference;
  lang?: LabelLang;
  ui?: 'en' | 'ar';
  /** Visible drawing layers (others hidden). */
  layers?: string[];
  /** Visible UI controls; see `resolveControls` (groups, leaves like `draw.point`, `none`, `all`, `-exclusions`). Default: all. */
  controls?: string[];
  /** Hides editing for the end user (host commands can still write). */
  readonly?: boolean;
  select?: string;
  hillshade?: boolean;
  contours?: boolean;
  terrain3d?: boolean;
  unit?: DistanceUnit;
  coords?: CoordFormat;
  /** false: no pan/zoom/rotate by the user (clicks still emit events). */
  interactive?: boolean;
  minZoom?: number;
  maxZoom?: number;
  /** minLon, minLat, maxLon, maxLat */
  maxBounds?: [number, number, number, number];
}

const BOOL_TRUE = ['1', 'true', 'yes', 'on'];
const BOOL_FALSE = ['0', 'false', 'no', 'off'];

export function parseEmbedUrl(search: string): EmbedUrlParams {
  const q = new URLSearchParams(search);
  const num = (k: string) => (q.has(k) && q.get(k) !== '' && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const list = (k: string) => (q.has(k) ? q.get(k)!.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  const numbers = (k: string, n: number) => {
    const v = list(k)?.map(Number);
    return v && v.length === n && v.every(Number.isFinite) ? v : undefined;
  };
  const bool = (k: string) => (BOOL_TRUE.includes(q.get(k) ?? '') ? true : BOOL_FALSE.includes(q.get(k) ?? '') ? false : undefined);
  const pick = <T extends string>(k: string, allowed: readonly T[]) => (allowed.includes(q.get(k) as T) ? (q.get(k) as T) : undefined);
  const bounds = numbers('maxBounds', 4) as [number, number, number, number] | undefined;
  return {
    center: numbers('center', 2) as [number, number] | undefined,
    zoom: num('zoom'),
    bearing: num('bearing'),
    pitch: num('pitch'),
    theme: pick('theme', ['auto', 'light', 'dark']),
    lang: pick('lang', ['en', 'ar']),
    ui: pick('ui', ['en', 'ar']),
    layers: list('layers'),
    controls: list('controls'),
    readonly: bool('readonly') ?? false,
    select: q.get('select') || undefined,
    hillshade: bool('hillshade'),
    contours: bool('contours'),
    terrain3d: bool('terrain3d'),
    unit: pick('unit', ['km', 'nm', 'mi']),
    coords: pick('coords', ['dd', 'dms', 'mgrs', 'utm']),
    interactive: bool('interactive'),
    minZoom: num('minZoom'),
    maxZoom: num('maxZoom'),
    maxBounds: bounds && bounds[0] < bounds[2] && bounds[1] < bounds[3] ? bounds : undefined,
  };
}

export function buildEmbedUrl(base: string, p: EmbedUrlParams): string {
  const q = new URLSearchParams();
  if (p.center) q.set('center', p.center.join(','));
  for (const k of ['zoom', 'bearing', 'pitch', 'minZoom', 'maxZoom'] as const) if (p[k] !== undefined) q.set(k, String(p[k]));
  for (const k of ['theme', 'lang', 'ui', 'unit', 'coords', 'select'] as const) if (p[k]) q.set(k, p[k]!);
  if (p.layers) q.set('layers', p.layers.join(','));
  // An empty list is meaningful (pure map), so it is written as "none".
  if (p.controls) q.set('controls', p.controls.length ? p.controls.join(',') : 'none');
  if (p.readonly) q.set('readonly', '1');
  for (const k of ['hillshade', 'contours', 'terrain3d', 'interactive'] as const) if (p[k] !== undefined) q.set(k, p[k] ? '1' : '0');
  if (p.maxBounds) q.set('maxBounds', p.maxBounds.join(','));
  const qs = q.toString();
  return `${base.replace(/\/$/, '')}/embed${qs ? `?${qs}` : ''}`;
}
