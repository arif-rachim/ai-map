import type { Feature, FeatureCollection } from 'geojson';
import type { ElevationProfile } from '@ai-map/shared';
import type { SearchResultItem } from '@ai-map/shared/embed';
import type {
  Airport,
  DataCapabilities,
  FeatureInput,
  FeaturePatch,
  LayerInput,
  LayerPatch,
  MapFeature,
  MapLayer,
  ServerMessage,
} from '@ai-map/shared/schemas';

export type { ElevationProfile, ProfilePoint } from '@ai-map/shared';
export type { Airport, DataCapabilities, FeatureInput, FeaturePatch, LayerInput, LayerPatch, MapFeature, MapLayer, ServerMessage } from '@ai-map/shared/schemas';

export class AiMapError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'AiMapError';
  }
}

export interface ImportResult {
  created: number;
  deleted: number;
  ids: string[];
  errors: { index: number; message: string }[];
}

export type NewFeature = Partial<FeatureInput> & Pick<FeatureInput, 'layerId' | 'kind' | 'geometry'>;

export interface Subscription {
  close(): void;
}

/** REST + WebSocket client for the AI Map server (`/api/v1`). Works in browsers and Node 18+. */
export class AiMapClient {
  readonly baseUrl: string;

  /** @param baseUrl server origin, e.g. "http://maps.local". Defaults to the current page origin in browsers. */
  constructor(baseUrl?: string) {
    const origin = baseUrl ?? (typeof location !== 'undefined' ? location.origin : '');
    if (!origin) throw new Error('AiMapClient: baseUrl is required outside a browser');
    this.baseUrl = origin.replace(/\/$/, '');
  }

  private url(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) q.set(k, String(v));
    const qs = q.toString();
    return `${this.baseUrl}/api/v1${path}${qs ? `?${qs}` : ''}`;
  }

  private async request<T>(method: string, path: string, opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown; contentType?: string } = {}): Promise<T> {
    const res = await fetch(this.url(path, opts.query), {
      method,
      headers: opts.body === undefined ? undefined : { 'content-type': opts.contentType ?? 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new AiMapError(res.status, (data as { message?: string } | null)?.message ?? res.statusText, data);
    return data as T;
  }

  // --- System & basemap -------------------------------------------------------------------------

  capabilities(): Promise<DataCapabilities> {
    return this.request('GET', '/capabilities');
  }

  /** MapLibre style URL: `new maplibregl.Map({ container, style: client.styleUrl() })`. */
  styleUrl(opts: { theme?: 'light' | 'dark'; lang?: 'en' | 'ar'; terrain?: 'none' | 'hillshade' | '3d' } = {}): string {
    return this.url(`/styles/${opts.theme ?? 'light'}.json`, { lang: opts.lang, terrain: opts.terrain });
  }

  tileJsonUrl(name: 'world' | 'region' | 'terrain'): string {
    return this.url(`/tiles/${name}.json`);
  }

  // --- Search & elevation -----------------------------------------------------------------------

  search(q: string, opts: { lang?: 'en' | 'ar'; limit?: number; types?: ('coordinates' | 'airport' | 'place')[] } = {}): Promise<SearchResultItem[]> {
    return this.request('GET', '/search', { query: { q, lang: opts.lang, limit: opts.limit, types: opts.types?.join(',') } });
  }

  searchAirports(q: string, limit = 10): Promise<Airport[]> {
    return this.request('GET', '/airports/search', { query: { q, limit } });
  }

  /** Airport by IATA or ICAO code; resolves null when unknown. */
  async airport(code: string): Promise<Airport | null> {
    try {
      return await this.request<Airport>('GET', `/airports/${encodeURIComponent(code)}`);
    } catch (err) {
      if (err instanceof AiMapError && err.status === 404) return null;
      throw err;
    }
  }

  async elevation(lon: number, lat: number): Promise<number | null> {
    return (await this.request<{ elevation: number | null }>('GET', '/elevation', { query: { lon, lat } })).elevation;
  }

  elevations(points: [number, number][]): Promise<{ lon: number; lat: number; elevation: number | null }[]> {
    return this.request('POST', '/elevation', { body: { points } });
  }

  elevationProfile(coordinates: [number, number][], opts: { samples?: number; greatCircle?: boolean } = {}): Promise<ElevationProfile> {
    return this.request('POST', '/elevation/profile', { body: { coordinates, ...opts } });
  }

  // --- Layers & features ------------------------------------------------------------------------

  layers(): Promise<MapLayer[]> {
    return this.request('GET', '/layers');
  }

  createLayer(input: Partial<LayerInput> & { name: string }): Promise<MapLayer> {
    return this.request('POST', '/layers', { body: input });
  }

  updateLayer(id: string, patch: LayerPatch): Promise<MapLayer> {
    return this.request('PATCH', `/layers/${id}`, { body: patch });
  }

  deleteLayer(id: string): Promise<void> {
    return this.request('DELETE', `/layers/${id}`);
  }

  features(query: { layerId?: string; bbox?: [number, number, number, number]; limit?: number; offset?: number } = {}): Promise<MapFeature[]> {
    return this.request('GET', '/features', { query: { ...query, bbox: query.bbox?.join(',') } });
  }

  feature(id: string): Promise<MapFeature> {
    return this.request('GET', `/features/${id}`);
  }

  createFeature(input: NewFeature): Promise<MapFeature> {
    return this.request('POST', '/features', { body: input });
  }

  /**
   * Updates a feature. Pass `version` for optimistic locking (409 → AiMapError with `body.current`);
   * without it the latest version is fetched first (last write wins).
   */
  async updateFeature(id: string, patch: Omit<FeaturePatch, 'version'> & { version?: number }): Promise<MapFeature> {
    const version = patch.version ?? (await this.feature(id)).version;
    return this.request('PATCH', `/features/${id}`, { body: { ...patch, version } });
  }

  deleteFeature(id: string): Promise<void> {
    return this.request('DELETE', `/features/${id}`);
  }

  // --- Exchange ---------------------------------------------------------------------------------

  exportUrl(layerId: string, format: 'geojson' | 'kml' = 'geojson'): string {
    return this.url(`/layers/${layerId}/export.${format}`);
  }

  /** GeoJSON FeatureCollection of features (optionally one layer / bbox). */
  featuresGeoJSON(query: { layerId?: string; bbox?: [number, number, number, number] } = {}): Promise<FeatureCollection> {
    return this.request('GET', '/features.geojson', { query: { layerId: query.layerId, bbox: query.bbox?.join(',') } });
  }

  importGeoJSON(layerId: string, data: FeatureCollection | Feature, mode: 'append' | 'replace' = 'append'): Promise<ImportResult> {
    return this.request('POST', `/layers/${layerId}/import`, { query: { mode }, body: data, contentType: 'application/geo+json' });
  }

  // --- Real-time --------------------------------------------------------------------------------

  /**
   * Streams layer/feature changes made by anyone. Reconnects automatically; `onOpen` fires on every
   * (re)connect — reload state there because messages sent while disconnected are not replayed.
   */
  subscribe(onMessage: (m: ServerMessage) => void, opts: { onOpen?: () => void; onClose?: () => void } = {}): Subscription {
    let socket: WebSocket | null = null;
    let closed = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/api/v1/events`;
    const open = () => {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        delay = 1000;
        opts.onOpen?.();
      };
      socket.onmessage = (e) => {
        try {
          onMessage(JSON.parse(String(e.data)) as ServerMessage);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        opts.onClose?.();
        if (closed) return;
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };
    open();
    return {
      close() {
        closed = true;
        clearTimeout(timer);
        socket?.close();
      },
    };
  }
}
