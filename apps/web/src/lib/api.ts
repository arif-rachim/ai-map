import type { Airport, DataCapabilities, SearchResultItem, FeatureInput, FeaturePatch, MapFeature, MapLayer, LayerInput, LayerPatch } from '@ai-map/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { message?: string } | null)?.message ?? res.statusText, data);
  return data as T;
}

export const api = {
  capabilities: () => request<DataCapabilities>('GET', '/api/v1/capabilities'),
  layers: () => request<MapLayer[]>('GET', '/api/v1/layers'),
  createLayer: (input: Partial<LayerInput> & { name: string }) => request<MapLayer>('POST', '/api/v1/layers', input),
  updateLayer: (id: string, patch: LayerPatch) => request<MapLayer>('PATCH', `/api/v1/layers/${id}`, patch),
  deleteLayer: (id: string) => request<void>('DELETE', `/api/v1/layers/${id}`),
  features: () => request<MapFeature[]>('GET', '/api/v1/features'),
  createFeature: (input: Partial<FeatureInput> & Pick<FeatureInput, 'layerId' | 'kind' | 'geometry'>) =>
    request<MapFeature>('POST', '/api/v1/features', input),
  updateFeature: (id: string, patch: FeaturePatch) => request<MapFeature>('PATCH', `/api/v1/features/${id}`, patch),
  deleteFeature: (id: string) => request<void>('DELETE', `/api/v1/features/${id}`),
  search: (q: string, lang: 'en' | 'ar', limit = 10, signal?: AbortSignal) =>
    fetch(`/api/v1/search?${new URLSearchParams({ q, lang, limit: String(limit), types: 'airport,place' })}`, { signal }).then((r) =>
      r.ok ? (r.json() as Promise<SearchResultItem[]>) : [],
    ),
  airports: (q: string, limit = 5, signal?: AbortSignal) =>
    fetch(`/api/v1/airports/search?${new URLSearchParams({ q, limit: String(limit) })}`, { signal }).then(
      (r) => (r.ok ? (r.json() as Promise<Airport[]>) : []),
    ),
};
