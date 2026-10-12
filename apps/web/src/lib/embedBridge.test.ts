import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, resolveControls, type MapFeature, type MapLayer } from '@ai-map/shared';

vi.mock('./api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: {
      createFeature: vi.fn(),
      createLayer: vi.fn(),
      updateFeature: vi.fn(),
      deleteFeature: vi.fn(),
    },
  };
});

import { api, ApiError } from './api';
import { embedHandlers as h, parseTool, startEmbedBridge } from './embedBridge';
import { markMapReady, mapRef } from '../mapRef';
import { useStore } from '../store';
import { initI18n } from '../i18n';

beforeAll(async () => {
  await initI18n();
});

const layer = (id: string): MapLayer => ({ id, name: id, visible: true, sortOrder: 0, createdAt: '', updatedAt: '' });
const feature = (id: string, layerId: string, version = 1): MapFeature => ({
  id,
  layerId,
  kind: 'point',
  geometry: { type: 'Point', coordinates: [46, 24] },
  name: id,
  description: '',
  style: DEFAULT_STYLE,
  radiusM: null,
  center: null,
  sidc: null,
  version,
  createdAt: '',
  updatedAt: '',
});

function fakeMap() {
  const handlers: Record<string, ((e?: unknown) => void)[]> = {};
  return {
    getCenter: () => ({ lng: 46.5, lat: 24.5 }),
    getZoom: () => 9,
    getBearing: () => 0,
    getPitch: () => 10,
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    getLayer: () => null,
    queryRenderedFeatures: () => [],
    on: (type: string, cb: (e?: unknown) => void) => ((handlers[type] ??= []).push(cb), undefined),
    fire: (type: string, e?: unknown) => handlers[type]?.forEach((cb) => cb(e)),
  };
}

describe('embed command handlers', () => {
  let map: ReturnType<typeof fakeMap>;

  beforeEach(() => {
    map = fakeMap();
    mapRef.current = map as never;
    useStore.setState({
      layers: [layer('L1'), layer('L2')],
      features: { f1: feature('f1', 'L1'), f2: feature('f2', 'L2', 4) },
      activeLayerId: 'L1',
      hiddenLayerIds: [],
      selectedId: null,
      markers: [],
      controls: resolveControls(undefined),
      readonly: false,
      tool: { type: 'none' },
    });
    vi.mocked(api.createFeature).mockReset();
    vi.mocked(api.updateFeature).mockReset();
    vi.mocked(api.deleteFeature).mockReset();
  });

  it('reads and changes the view', () => {
    expect(h.getView()).toEqual({ center: [46.5, 24.5], zoom: 9, bearing: 0, pitch: 10 });
    h.setView({ zoom: 12, animate: false });
    expect(map.jumpTo).toHaveBeenCalledWith({ center: undefined, zoom: 12, bearing: undefined, pitch: undefined });
    h.setView({ center: [1, 2] });
    expect(map.easeTo).toHaveBeenCalled();
    h.fitBounds({ bounds: [1, 2, 3, 4] });
    expect(map.fitBounds).toHaveBeenCalledWith([1, 2, 3, 4], expect.objectContaining({ padding: 40, maxZoom: 16 }));
  });

  it('fails clearly when the map is not ready', () => {
    mapRef.current = null;
    expect(() => h.fitBounds({ bounds: [1, 2, 3, 4] })).toThrow('Map is not ready yet');
  });

  it('lists layers and features', () => {
    expect((h.listLayers() as MapLayer[]).map((l) => l.id)).toEqual(['L1', 'L2']);
    expect((h.listFeatures({ layerId: 'L2' }) as MapFeature[]).map((f) => f.id)).toEqual(['f2']);
    expect(h.listFeatures({}) as MapFeature[]).toHaveLength(2);
  });

  it('searches through the unified API', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify([{ type: 'place', name: 'Riyadh' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(h.search({ q: 'Riyadh', limit: 3 })).resolves.toEqual([{ type: 'place', name: 'Riyadh' }]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/v1/search?q=Riyadh');
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 500 }));
    await expect(h.search({ q: 'x' })).rejects.toThrow('Search failed (500)');
    vi.unstubAllGlobals();
  });

  it('adds features to the active layer by default', async () => {
    vi.mocked(api.createFeature).mockResolvedValue(feature('f3', 'L1'));
    await h.addFeature({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] } });
    expect(vi.mocked(api.createFeature).mock.calls[0]![0]).toMatchObject({ layerId: 'L1' });
    expect(useStore.getState().features.f3).toBeDefined();

    // Falls back to the first layer when the active one is gone ...
    useStore.setState({ activeLayerId: 'deleted' });
    await h.addFeature({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] } });
    expect(vi.mocked(api.createFeature).mock.calls[1]![0]).toMatchObject({ layerId: 'L1' });

    // ... and creates a "Default" layer when none exist.
    useStore.setState({ activeLayerId: null, layers: [] });
    vi.mocked(api.createLayer).mockResolvedValue(layer('LD'));
    await h.addFeature({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] } });
    expect(vi.mocked(api.createLayer)).toHaveBeenCalledWith({ name: 'Default' });
    expect(vi.mocked(api.createFeature).mock.calls[2]![0]).toMatchObject({ layerId: 'LD' });
    expect(useStore.getState().activeLayerId).toBe('LD');
  });

  it('updates with the latest known version unless one is given, and deletes', async () => {
    vi.mocked(api.updateFeature).mockResolvedValue(feature('f2', 'L2', 5));
    await h.updateFeature({ id: 'f2', patch: { name: 'x' } });
    expect(vi.mocked(api.updateFeature).mock.calls[0]).toEqual(['f2', { name: 'x', version: 4 }]);
    await h.updateFeature({ id: 'f2', patch: { name: 'y', version: 2 } });
    expect(vi.mocked(api.updateFeature).mock.calls[1]![1]).toMatchObject({ version: 2 });
    await expect(h.updateFeature({ id: 'nope', patch: {} })).rejects.toThrow('Feature not found');

    vi.mocked(api.deleteFeature).mockResolvedValue(undefined);
    await h.deleteFeature({ id: 'f1' });
    expect(useStore.getState().features.f1).toBeUndefined();
  });

  it('selects features (optionally zooming) and validates ids', () => {
    h.selectFeature({ id: 'f1', zoomTo: true });
    expect(useStore.getState().selectedId).toBe('f1');
    expect(map.fitBounds).toHaveBeenCalled();
    h.selectFeature({ id: null });
    expect(useStore.getState().selectedId).toBeNull();
    expect(() => h.selectFeature({ id: 'nope' })).toThrow('Feature not found');
  });

  it('changes layer visibility and the active layer, rejecting unknown layers', () => {
    h.setLayerVisible({ layerId: 'L2', visible: false });
    expect(useStore.getState().hiddenLayerIds).toEqual(['L2']);
    h.setLayerVisible({ layerId: 'L2', visible: false });
    expect(useStore.getState().hiddenLayerIds).toEqual(['L2']);
    h.setLayerVisible({ layerId: 'L2', visible: true });
    expect(useStore.getState().hiddenLayerIds).toEqual([]);
    expect(() => h.setLayerVisible({ layerId: 'nope', visible: false })).toThrow('Layer not found');
    h.setActiveLayer({ layerId: 'L2' });
    expect(useStore.getState().activeLayerId).toBe('L2');
    expect(() => h.setActiveLayer({ layerId: 'nope' })).toThrow('Layer not found');
  });

  it('parses tools strictly', () => {
    expect(parseTool('none')).toEqual({ type: 'none' });
    expect(parseTool('draw:circle')).toEqual({ type: 'draw', kind: 'circle' });
    expect(parseTool('measure:rings')).toEqual({ type: 'measure', kind: 'rings' });
    for (const bad of ['draw:hexagon', 'measure:', 'erase:point', '']) expect(() => parseTool(bad)).toThrow('Unknown tool');
    h.setTool({ tool: 'measure:area' });
    expect(useStore.getState().tool).toEqual({ type: 'measure', kind: 'area' });
  });

  it('applies options', () => {
    h.setOptions({ theme: 'dark', unit: 'nm', coordFormat: 'mgrs', hillshade: false, contours: true, terrain3d: true });
    expect(useStore.getState()).toMatchObject({
      theme: 'dark',
      resolvedTheme: 'dark',
      unit: 'nm',
      coordFormat: 'mgrs',
      hillshade: false,
      contours: true,
      terrain3d: true,
    });
  });

  it('merges, replaces and removes host markers', () => {
    h.setMarkers({ markers: [{ id: 'a', lon: 1, lat: 1 }, { id: 'b', lon: 2, lat: 2 }] });
    h.setMarkers({ markers: [{ id: 'a', lon: 5, lat: 5, label: 'moved' }] });
    expect(useStore.getState().markers).toEqual([{ id: 'a', lon: 5, lat: 5, label: 'moved' }, { id: 'b', lon: 2, lat: 2 }]);
    h.removeMarkers({ ids: ['a'] });
    expect(useStore.getState().markers.map((m) => m.id)).toEqual(['b']);
    h.setMarkers({ markers: [{ id: 'c', lon: 3, lat: 3 }], replace: true });
    expect(useStore.getState().markers.map((m) => m.id)).toEqual(['c']);
    h.removeMarkers({});
    expect(useStore.getState().markers).toEqual([]);
  });

  it('sets and reports controls, rejecting unknown names', () => {
    expect(h.setControls({ controls: ['none', 'zoom'], readonly: true })).toEqual({ controls: ['zoom'], readonly: true });
    expect(h.getControls()).toEqual({ controls: ['zoom'], readonly: true });
    expect(h.setControls({ readonly: false })).toEqual({ controls: ['zoom'], readonly: false });
    expect(() => h.setControls({ controls: ['zoom', 'hexagon'] })).toThrow('Unknown controls: hexagon');
  });

  it('validates and applies interaction limits', () => {
    h.setInteraction({ interactive: false, minZoom: 3, maxZoom: 12, maxBounds: [30, 10, 60, 35] });
    expect(useStore.getState().interaction).toEqual({ interactive: false, minZoom: 3, maxZoom: 12, maxBounds: [30, 10, 60, 35] });
    h.setInteraction({ maxBounds: null });
    expect(useStore.getState().interaction.maxBounds).toBeNull();
    expect(() => h.setInteraction({ minZoom: 30 })).toThrow('minZoom must be between 0 and 24');
    expect(() => h.setInteraction({ maxBounds: [60, 10, 30, 35] })).toThrow('maxBounds must be');
  });
});

describe('startEmbedBridge', () => {
  const posted: unknown[] = [];
  let stop: () => void;
  let map: ReturnType<typeof fakeMap>;

  beforeEach(() => {
    posted.length = 0;
    Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: (m: unknown) => posted.push(m) } });
    map = fakeMap();
    mapRef.current = map as never;
    useStore.setState({ layers: [layer('L1')], features: { f1: feature('f1', 'L1') }, selectedId: null, loadGeneration: 1, tool: { type: 'none' } });
    stop = startEmbedBridge();
  });

  afterEach(() => {
    stop();
    markMapReady(null);
    Object.defineProperty(window, 'parent', { configurable: true, value: window });
  });

  async function send(command: string, params?: unknown) {
    const replies: { id: string; ok: boolean; result?: unknown; error?: string }[] = [];
    const source = { postMessage: (m: never) => replies.push(m) };
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'aimap', version: 1, type: 'command', id: 'c1', command, params }, source: source as never }));
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    return replies[0]!;
  }

  it('answers commands, unknown commands and errors', async () => {
    await expect(send('listLayers')).resolves.toMatchObject({ id: 'c1', ok: true, result: [expect.objectContaining({ id: 'L1' })] });
    await expect(send('teleport')).resolves.toMatchObject({ ok: false, error: 'Unknown command teleport' });
    await expect(send('setActiveLayer', { layerId: 'x' })).resolves.toMatchObject({ ok: false, error: 'Layer not found' });
    vi.mocked(api.updateFeature).mockRejectedValueOnce(new ApiError(409, 'conflict', null));
    await expect(send('updateFeature', { id: 'f1', patch: { name: 'z' } })).resolves.toMatchObject({ ok: false, error: 'Version conflict: feature was modified' });
  });

  it('ignores messages that are not commands', async () => {
    window.dispatchEvent(new MessageEvent('message', { data: { hello: 'world' } }));
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'aimap', type: 'event', event: 'x' } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(posted).toEqual([]);
  });

  it('emits ready, moveend and click once the map is ready', () => {
    markMapReady(map as never);
    map.fire('moveend');
    map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 5, lat: 6 } });
    const events = posted.map((m) => (m as { event: string }).event);
    expect(events).toEqual(['ready', 'moveend', 'click']);
    expect(posted[2]).toMatchObject({ data: { lon: 5, lat: 6, featureId: null, markerId: null } });
  });

  it('emits selection and feature lifecycle events, but not for full reloads', () => {
    const s = useStore.getState();
    s.select('f1');
    s.upsertFeature(feature('f9', 'L1'));
    s.upsertFeature(feature('f9', 'L1', 2));
    s.removeFeature('f9');
    useStore.getState().loadAll([layer('L1')], [feature('f1', 'L1'), feature('fx', 'L1')]);
    const events = posted.map((m) => (m as { event: string }).event);
    expect(events).toEqual(['select', 'featureCreated', 'featureUpdated', 'featureDeleted']);
  });

  it('emits measurements', () => {
    const s = useStore.getState();
    s.setTool({ type: 'measure', kind: 'distance' });
    s.setMeasure({ coords: [[46, 24], [46.01, 24]] });
    const m = posted.find((x) => (x as { event: string }).event === 'measure') as { data: { tool: string; meters: number } };
    expect(m.data.tool).toBe('distance');
    expect(m.data.meters).toBeGreaterThan(1000);
    expect(m.data.meters).toBeLessThan(1030);
  });
});
