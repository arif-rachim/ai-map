// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, type MapFeature, type ServerMessage } from '@ai-map/shared';
import type { AiMapClient } from './client';
import { addDrawings, drawingLayers, milImageId, toRenderCollection } from './drawings';

const f = (id: string, layerId: string, extra: Partial<MapFeature> = {}): MapFeature => ({
  id,
  layerId,
  kind: 'point',
  geometry: { type: 'Point', coordinates: [1, 1] },
  name: id,
  description: '',
  style: DEFAULT_STYLE,
  radiusM: null,
  center: null,
  sidc: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...extra,
});

function fakeMap() {
  const sources = new Map<string, { data: GeoJSON.FeatureCollection; setData: (d: GeoJSON.FeatureCollection) => void }>();
  const layers = new Map<string, unknown>();
  return {
    sources,
    layers,
    addSource: (id: string) => {
      const src = { data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection, setData: (d: GeoJSON.FeatureCollection) => (src.data = d) };
      sources.set(id, src);
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (l: { id: string }) => layers.set(l.id, l),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => layers.delete(id),
    on: vi.fn(),
    hasImage: () => false,
  };
}

describe('drawing render helpers', () => {
  it('flattens style and marks the selection', () => {
    const fc = toRenderCollection([f('a', 'L', { kind: 'milsymbol', sidc: '10031000001211000000' }), f('b', 'L')], 'b');
    expect(fc.features[0]!.properties).toMatchObject({ id: 'a', layerId: 'L', kind: 'milsymbol', milImage: milImageId('10031000001211000000', DEFAULT_STYLE.iconSize), strokeColor: DEFAULT_STYLE.strokeColor, selected: false });
    expect(fc.features[1]!.properties).toMatchObject({ selected: true, milImage: '' });
  });

  it('prefixes every layer id and uses the given source', () => {
    const ls = drawingLayers('src', 'x-');
    expect(ls.every((l) => l.id.startsWith('x-') && (l as { source: string }).source === 'src')).toBe(true);
    expect(ls.map((l) => l.id)).toEqual(['x-fill', 'x-selected', 'x-line', 'x-line-dash', 'x-point', 'x-milsymbol', 'x-text', 'x-label']);
  });
});

describe('addDrawings', () => {
  it('loads, filters, updates live and cleans up', async () => {
    const map = fakeMap();
    let push: (m: ServerMessage) => void = () => {};
    let onOpen: () => void = () => {};
    const close = vi.fn();
    const client = {
      features: vi.fn(async () => [f('a', 'L1'), f('b', 'L2')]),
      subscribe: (cb: (m: ServerMessage) => void, opts: { onOpen: () => void }) => {
        push = cb;
        onOpen = opts.onOpen;
        return { close };
      },
    } as unknown as AiMapClient;
    const changes: number[] = [];

    const ctl = await addDrawings(map as never, client, { layerIds: ['L1'], id: 'd', onChange: (fs) => changes.push(fs.length) });
    const data = () => map.sources.get('d')!.data.features.map((x) => x.properties!.id);
    expect(data()).toEqual(['a']);
    expect(ctl.layerIds).toHaveLength(8);

    push({ type: 'feature.created', feature: f('c', 'L1') });
    push({ type: 'feature.created', feature: f('d', 'L2') });
    expect(data()).toEqual(['a', 'c']);
    push({ type: 'feature.updated', feature: f('c', 'L1', { name: 'renamed', version: 2 }) });
    expect(map.sources.get('d')!.data.features[1]!.properties!.name).toBe('renamed');
    push({ type: 'feature.deleted', id: 'a' });
    expect(data()).toEqual(['c']);

    ctl.setLayerIds(undefined);
    expect(data().sort()).toEqual(['b', 'c', 'd']);
    push({ type: 'layer.deleted', id: 'L2' });
    expect(data()).toEqual(['c']);
    push({ type: 'layer.created', layer: { id: 'L3', name: 'x', visible: true, sortOrder: 0, createdAt: '', updatedAt: '' } });
    expect(ctl.features().map((x) => x.id)).toEqual(['c']);

    // Reconnect reloads the full list (missed messages are not replayed).
    onOpen();
    await vi.waitFor(() => expect(data()).toEqual(['a', 'b']));
    expect(changes.length).toBeGreaterThan(5);

    ctl.destroy();
    expect(close).toHaveBeenCalled();
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
