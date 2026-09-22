import ms from 'milsymbol';
import type { FeatureCollection, Geometry as GeoJsonGeometry } from 'geojson';
import type { FilterSpecification, GeoJSONSource, LayerSpecification, Map as MlMap } from 'maplibre-gl';
import type { MapFeature } from '@ai-map/shared/schemas';
import type { AiMapClient } from './client';

export const MIL_IMAGE_PREFIX = 'mil|';

export function milImageId(sidc: string, size: number): string {
  return `${MIL_IMAGE_PREFIX}${sidc}|${Math.round(size)}`;
}

const registered = new WeakSet<MlMap>();

/** Renders MIL-STD-2525D/E symbols on demand for icon-image ids created with `milImageId`. */
export function registerMilSymbolImages(map: MlMap): void {
  if (registered.has(map)) return;
  registered.add(map);
  map.on('styleimagemissing', (e) => {
    if (!e.id.startsWith(MIL_IMAGE_PREFIX)) return;
    const [, sidc = '', size = '36'] = e.id.split('|');
    const ratio = window.devicePixelRatio || 1;
    const canvas = new ms.Symbol(sidc, { size: Number(size) * ratio }).asCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx || map.hasImage(e.id)) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    map.addImage(e.id, { width: canvas.width, height: canvas.height, data: new Uint8Array(data.data.buffer) }, { pixelRatio: ratio });
  });
}

/** Flattens stored features into a FeatureCollection for data-driven styling. */
export function toRenderCollection(features: MapFeature[], selectedId: string | null = null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: f.geometry as GeoJsonGeometry,
      properties: {
        id: f.id,
        layerId: f.layerId,
        kind: f.kind,
        name: f.name,
        description: f.description,
        selected: f.id === selectedId,
        milImage: f.kind === 'milsymbol' && f.sidc ? milImageId(f.sidc, f.style.iconSize) : '',
        ...f.style,
      },
    })),
  };
}

const FONT = ['Noto Sans Regular'];

/**
 * MapLibre layers that draw features exactly like the AI Map app (fills, lines, dashed lines, pins,
 * text, MIL-STD symbols, labels). Layer ids are `${prefix}fill`, `${prefix}line`, ...
 */
export function drawingLayers(sourceId: string, prefix: string): LayerSpecification[] {
  const polygons: FilterSpecification = ['==', ['geometry-type'], 'Polygon'];
  const lineish: FilterSpecification = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'LineString']];
  return [
    { id: `${prefix}fill`, type: 'fill', source: sourceId, filter: polygons, paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] } },
    {
      id: `${prefix}selected`,
      type: 'line',
      source: sourceId,
      filter: ['all', lineish, ['==', ['get', 'selected'], true]],
      paint: { 'line-color': '#facc15', 'line-width': ['+', ['get', 'strokeWidth'], 6], 'line-opacity': 0.8 },
    },
    {
      id: `${prefix}line`,
      type: 'line',
      source: sourceId,
      filter: ['all', lineish, ['!=', ['get', 'strokeDash'], true]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'strokeColor'], 'line-width': ['get', 'strokeWidth'], 'line-opacity': ['get', 'strokeOpacity'] },
    },
    {
      id: `${prefix}line-dash`,
      type: 'line',
      source: sourceId,
      filter: ['all', lineish, ['==', ['get', 'strokeDash'], true]],
      paint: { 'line-color': ['get', 'strokeColor'], 'line-width': ['get', 'strokeWidth'], 'line-opacity': ['get', 'strokeOpacity'], 'line-dasharray': [3, 2] },
    },
    {
      id: `${prefix}point`,
      type: 'circle',
      source: sourceId,
      filter: ['==', ['get', 'kind'], 'point'],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], true], 9, 7],
        'circle-color': ['get', 'fillColor'],
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], true], '#facc15', '#ffffff'],
        'circle-stroke-width': 2.5,
      },
    },
    {
      id: `${prefix}milsymbol`,
      type: 'symbol',
      source: sourceId,
      filter: ['==', ['get', 'kind'], 'milsymbol'],
      layout: { 'icon-image': ['get', 'milImage'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    },
    {
      id: `${prefix}text`,
      type: 'symbol',
      source: sourceId,
      filter: ['==', ['get', 'kind'], 'text'],
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': ['get', 'textSize'], 'text-allow-overlap': true },
      paint: {
        'text-color': ['get', 'textColor'],
        'text-halo-color': ['case', ['==', ['get', 'selected'], true], '#facc15', '#ffffff'],
        'text-halo-width': 2,
      },
    },
    {
      id: `${prefix}label`,
      type: 'symbol',
      source: sourceId,
      filter: ['all', ['!=', ['get', 'kind'], 'text'], ['!=', ['get', 'name'], '']],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT,
        'text-size': 12,
        'text-offset': ['case', ['==', ['get', 'kind'], 'milsymbol'], ['literal', [0, 2.4]], ['literal', [0, 1.2]]],
        'text-anchor': 'top',
      },
      paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    },
  ];
}

export interface DrawingsOptions {
  /** Only show these layers (ids). Default: all. */
  layerIds?: string[];
  /** Source/layer id prefix (default "aimap-drawings"). */
  id?: string;
  /** Insert the layers below this existing layer id. */
  beforeId?: string;
  /** Called after every data change (initial load, real-time update). */
  onChange?: (features: MapFeature[]) => void;
}

export interface DrawingsController {
  /** Current features (after filtering). */
  features(): MapFeature[];
  setLayerIds(layerIds: string[] | undefined): void;
  /** Rendered layer ids, e.g. for `map.on('click', ids, ...)`. */
  layerIds: string[];
  destroy(): void;
}

/**
 * Shows the shared drawings (read-only, live) on your own MapLibre map.
 *
 * ```js
 * const map = new maplibregl.Map({ container: 'map', style: client.styleUrl() });
 * map.on('load', () => AiMap.addDrawings(map, client, { layerIds: ['…'] }));
 * ```
 */
export async function addDrawings(map: MlMap, client: AiMapClient, options: DrawingsOptions = {}): Promise<DrawingsController> {
  const id = options.id ?? 'aimap-drawings';
  const all = new Map<string, MapFeature>();
  let filter = options.layerIds;
  const visible = () => [...all.values()].filter((f) => !filter || filter.includes(f.layerId));

  registerMilSymbolImages(map);
  map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const layers = drawingLayers(id, `${id}-`);
  for (const l of layers) map.addLayer(l, options.beforeId);

  const render = () => {
    const features = visible();
    (map.getSource(id) as GeoJSONSource | undefined)?.setData(toRenderCollection(features));
    options.onChange?.(features);
  };
  const reload = async () => {
    const list = await client.features();
    all.clear();
    for (const f of list) all.set(f.id, f);
    render();
  };

  const sub = client.subscribe(
    (m) => {
      if (m.type === 'feature.created' || m.type === 'feature.updated') {
        all.set(m.feature.id, m.feature);
      } else if (m.type === 'feature.deleted') {
        all.delete(m.id);
      } else if (m.type === 'layer.deleted') {
        for (const [fid, f] of all) {
          if (f.layerId === m.id) all.delete(fid);
        }
      } else {
        return; // layer created/updated: nothing to draw
      }
      render();
    },
    { onOpen: () => void reload() },
  );
  await reload();

  return {
    features: visible,
    setLayerIds(ids) {
      filter = ids;
      render();
    },
    layerIds: layers.map((l) => l.id),
    destroy() {
      sub.close();
      for (const l of layers) if (map.getLayer(l.id)) map.removeLayer(l.id);
      if (map.getSource(id)) map.removeSource(id);
    },
  };
}
