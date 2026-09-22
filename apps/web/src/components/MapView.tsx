import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LayerSpecification, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { DEFAULT_STYLE, type DataCapabilities, type FeatureInput, type MapFeature } from '@ai-map/shared';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { ensureLayerId } from '../lib/layers';
import { buildStyle, TERRAIN_EXAGGERATION, TERRAIN_SOURCES } from '../lib/basemap';
import { isBasemapLayerId } from '@ai-map/shared';
import { demSource, elevationAt } from '../lib/terrain';
import { circleParams, roundGeometry } from '../lib/featureGeo';
import { toRenderCollection } from '@ai-map/sdk';
import { measureCollection } from '../lib/measureOverlay';
import { drawingLayers, milImageId, registerMilSymbolImages } from '@ai-map/sdk';
import { drawRef, mapRef, markMapReady } from '../mapRef';
import { embed, useStore, type DrawTool, type Tool } from '../store';

const FONT = ['Noto Sans Regular'];
const BASEMAP_SOURCES = new Set(['world', 'region', ...TERRAIN_SOURCES]);
const isBasemapLayer = (l: LayerSpecification) => isBasemapLayerId(l.id);

let protocolRegistered = false;
function registerGlobals(caps: DataCapabilities) {
  if (protocolRegistered) return;
  protocolRegistered = true;
  if (caps.terrain && caps.terrainMaxzoom !== null) demSource(caps.terrainMaxzoom).setupMaplibre(maplibregl);
  maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  try {
    maplibregl.setRTLTextPlugin('/vendor/mapbox-gl-rtl-text.js', true);
  } catch {
    // already set (HMR)
  }
}

const TD_MODE: Record<DrawTool | 'distance' | 'area' | 'rings', string> = {
  rectangle: 'rectangle',
  polygon: 'polygon',
  circle: 'circle',
  line: 'linestring',
  point: 'point',
  text: 'point',
  milsymbol: 'point',
  distance: 'linestring',
  area: 'polygon',
  rings: 'point',
};

const KIND_TO_TD_MODE: Record<MapFeature['kind'], string> = {
  rectangle: 'rectangle',
  polygon: 'polygon',
  circle: 'circle',
  line: 'linestring',
  point: 'point',
  text: 'point',
  milsymbol: 'point',
};

function overlayLayers(): LayerSpecification[] {
  return [
    ...(drawingLayers('app:features', 'app:f-') as LayerSpecification[]),
    {
      id: 'app:m-fill',
      type: 'fill',
      source: 'app:measure',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.15 },
    },
    {
      id: 'app:m-line',
      type: 'line',
      source: 'app:measure',
      filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']],
      paint: { 'line-color': '#2563eb', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
    },
    {
      id: 'app:m-vertex',
      type: 'circle',
      source: 'app:measure',
      filter: ['==', ['get', 'role'], 'vertex'],
      paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': '#2563eb', 'circle-stroke-width': 2 },
    },
    {
      id: 'app:m-label',
      type: 'symbol',
      source: 'app:measure',
      filter: ['==', ['get', 'role'], 'label'],
      layout: {
        'text-field': ['get', 'text'],
        'text-font': FONT,
        'text-size': ['case', ['==', ['get', 'primary'], true], 15, 12],
        'text-offset': [0, -1.2],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#1e3a8a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    },
  ];
}

const SCALE_UNITS = { km: 'metric', nm: 'nautical', mi: 'imperial' } as const;
const mapControls = new WeakMap<maplibregl.Map, { nav?: maplibregl.NavigationControl; scale?: maplibregl.ScaleControl; key: string }>();

/** Adds/removes zoom, compass and scale controls to match the visible controls and distance unit. */
function applyMapControls(map: maplibregl.Map) {
  const { controls, unit } = useStore.getState();
  const zoom = controls.has('zoom');
  const compass = controls.has('compass');
  const scale = controls.has('scale');
  const key = `${zoom}|${compass}|${scale}|${unit}`;
  const current = mapControls.get(map);
  if (current?.key === key) return;
  if (current?.nav) map.removeControl(current.nav);
  if (current?.scale) map.removeControl(current.scale);
  const next: { nav?: maplibregl.NavigationControl; scale?: maplibregl.ScaleControl; key: string } = { key };
  if (zoom || compass) {
    next.nav = new maplibregl.NavigationControl({ showZoom: zoom, showCompass: compass, visualizePitch: compass });
    map.addControl(next.nav, 'bottom-right');
  }
  if (scale) {
    next.scale = new maplibregl.ScaleControl({ unit: SCALE_UNITS[unit] });
    map.addControl(next.scale, 'bottom-left');
  }
  mapControls.set(map, next);
}

/** Applies user-interaction limits (lock, zoom range, bounds). Programmatic moves still work. */
function applyInteraction(map: maplibregl.Map) {
  const { interactive, minZoom, maxZoom, maxBounds } = useStore.getState().interaction;
  for (const handler of [map.dragPan, map.scrollZoom, map.boxZoom, map.dragRotate, map.keyboard, map.doubleClickZoom, map.touchZoomRotate, map.touchPitch]) {
    if (interactive) handler.enable();
    else handler.disable();
  }
  map.setMinZoom(minZoom ?? 0);
  map.setMaxZoom(maxZoom ?? 19);
  map.setMaxBounds(maxBounds ?? null);
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const caps = useStore((s) => s.capabilities);
  const theme = useStore((s) => s.resolvedTheme);
  const labelLang = useStore((s) => s.labelLang);
  const { t } = useTranslation();

  // Create the map once.
  useEffect(() => {
    if (!container.current || !caps) return;
    registerGlobals(caps);
    const { resolvedTheme: theme, labelLang, hillshade, contours, terrain3d } = useStore.getState();
    const map = new maplibregl.Map({
      container: container.current,
      style: buildStyle(theme, labelLang, caps, { hillshade, contours, terrain3d }),
      pitch: embed.params.pitch ?? (terrain3d && caps.terrain ? 50 : 0),
      center: embed.params.center ?? [42, 25],
      zoom: embed.params.zoom ?? 3.6,
      bearing: embed.params.bearing ?? 0,
      minZoom: useStore.getState().interaction.minZoom ?? 0,
      maxZoom: useStore.getState().interaction.maxZoom ?? 19,
      maxBounds: useStore.getState().interaction.maxBounds ?? undefined,
      // Attribution intentionally not shown in the UI (organization decision); tile metadata still carries it.
      attributionControl: false,
      doubleClickZoom: true,
    });
    mapRef.current = map;
    applyMapControls(map);
    applyInteraction(map);
    // Exposes camera movement for styling and end-to-end tests (clicks during an animation only stop it).
    map.on('movestart', () => container.current?.setAttribute('data-moving', 'true'));
    map.on('moveend', () => container.current?.removeAttribute('data-moving'));
    registerMilSymbolImages(map);

    let raf = 0;
    let elevationTimer: ReturnType<typeof setTimeout> | undefined;
    let elevationSeq = 0;
    map.on('mousemove', (e: MapMouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => useStore.getState().setCursor([e.lngLat.lng, e.lngLat.lat], map.getZoom()));
      if (caps.terrain && caps.terrainMaxzoom !== null) {
        const maxzoom = caps.terrainMaxzoom;
        clearTimeout(elevationTimer);
        elevationTimer = setTimeout(async () => {
          const seq = ++elevationSeq;
          // DEM at the finest zoom for accuracy; tiles are cached.
          const ele = await elevationAt(e.lngLat.lng, e.lngLat.lat, maxzoom, maxzoom);
          if (seq === elevationSeq) useStore.getState().setCursorElevation(ele);
        }, 80);
      }
    });
    map.on('zoomend', () => useStore.getState().setCursor(useStore.getState().cursor, map.getZoom()));

    map.on('load', () => {
      map.addSource('app:features', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('app:measure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('app:profile-hover', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('app:markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      for (const layer of overlayLayers()) map.addLayer(layer);
      map.addLayer({
        id: 'app:profile-hover',
        type: 'circle',
        source: 'app:profile-hover',
        paint: { 'circle-radius': 6, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
      // Host-page markers (embed API): dot or MIL-STD symbol, with optional label.
      map.addLayer({
        id: 'app:marker-dot',
        type: 'circle',
        source: 'app:markers',
        filter: ['==', ['get', 'milImage'], ''],
        paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
      });
      map.addLayer({
        id: 'app:marker-symbol',
        type: 'symbol',
        source: 'app:markers',
        filter: ['!=', ['get', 'milImage'], ''],
        layout: { 'icon-image': ['get', 'milImage'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      });
      map.addLayer({
        id: 'app:marker-label',
        type: 'symbol',
        source: 'app:markers',
        filter: ['!=', ['get', 'label'], ''],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': FONT,
          'text-size': 12,
          'text-anchor': 'top',
          'text-offset': ['case', ['!=', ['get', 'milImage'], ''], ['literal', [0, 2.4]], ['literal', [0, 1.1]]],
        },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });

      const selectFlags = {
        feature: { draggable: true, coordinates: { draggable: true, midpoints: true, deletable: true } },
      };
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({
          map,
          // Terra Draw treats any movement of 1px between press and release as a drag, which silently
          // swallows ordinary clicks with a little mouse/touchpad jitter. Use common click tolerances.
          minPixelDragDistance: 8,
          minPixelDragDistanceDrawing: 8,
          minPixelDragDistanceSelecting: 4,
        }),
        modes: [
          new TerraDrawRectangleMode(),
          new TerraDrawPolygonMode(),
          new TerraDrawCircleMode(),
          new TerraDrawLineStringMode(),
          new TerraDrawPointMode(),
          new TerraDrawSelectMode({
            flags: {
              polygon: selectFlags,
              linestring: selectFlags,
              rectangle: { feature: { draggable: true, coordinates: { draggable: true, resizable: 'opposite' } } },
              circle: { feature: { draggable: true, coordinates: { draggable: true, resizable: 'center-fixed' } } },
              point: { feature: { draggable: true } },
            },
          }),
        ],
      });
      draw.start();
      drawRef.current = draw;
      // A tool chosen while the map was still loading had no Terra Draw instance to act on; apply it now.
      if (useStore.getState().tool.type !== 'none') applyTool(useStore.getState().tool);

      draw.on('change', (ids) => {
        const s = useStore.getState();
        const tool = s.tool;
        if (tool.type !== 'measure' || tool.kind === 'rings') return;
        // Terra Draw also emits helper Point features (closing/snapping points) under the same mode.
        const wanted = tool.kind === 'area' ? 'Polygon' : 'LineString';
        const f = ids
          .map((id) => draw.getSnapshotFeature(id))
          .find((x) => x && x.properties.mode === TD_MODE[tool.kind] && x.geometry.type === wanted);
        if (!f) return;
        const coords = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates) as [number, number][];
        s.setMeasure({ coords: coords.map((c) => [c[0], c[1]]) });
      });

      draw.on('finish', (id, ctx) => {
        if (ctx.action !== 'draw') return;
        const f = draw.getSnapshotFeature(id);
        if (!f) return;
        draw.removeFeatures([id]);
        void handleFinished(f);
      });

      map.on('click', (e: MapMouseEvent) => {
        const s = useStore.getState();
        if (s.tool.type !== 'none' || s.editingId || !s.controls.has('select')) return;
        const hits = map.queryRenderedFeatures(
          [
            [e.point.x - 4, e.point.y - 4],
            [e.point.x + 4, e.point.y + 4],
          ],
          { layers: ['app:f-milsymbol', 'app:f-point', 'app:f-text', 'app:f-line', 'app:f-line-dash', 'app:f-fill'] },
        );
        s.select((hits[0]?.properties?.id as string | undefined) ?? null);
      });
      for (const id of ['app:f-fill', 'app:f-line', 'app:f-point', 'app:f-milsymbol', 'app:f-text']) {
        map.on('mouseenter', id, () => {
          const s = useStore.getState();
          if (s.tool.type === 'none' && s.controls.has('select')) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
      }

      syncFeatures();
      syncMeasure();
      syncMarkers();
      markMapReady(map);
      // Map, overlays and drawing tools are ready for input (used by styling hooks and browser tests).
      container.current?.setAttribute('data-ready', 'true');
    });

    return () => {
      markMapReady(null);
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [caps]);

  // Theme / label language: swap basemap layers, keep app sources and layers (incl. Terra Draw).
  const appliedStyle = useRef(`${theme}|${labelLang}`);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !caps) return;
    const apply = () => {
      const { resolvedTheme: theme, labelLang, hillshade, contours, terrain3d } = useStore.getState();
      const key = `${theme}|${labelLang}`;
      if (key === appliedStyle.current) return;
      if (!map.isStyleLoaded()) return void map.once('idle', apply);
      appliedStyle.current = key;
      map.setStyle(buildStyle(theme, labelLang, caps, { hillshade, contours, terrain3d }), {
        transformStyle: (prev, next): StyleSpecification => {
          if (!prev) return next;
          const keepSources = Object.fromEntries(Object.entries(prev.sources).filter(([k]) => !BASEMAP_SOURCES.has(k)));
          const keepLayers = prev.layers.filter((l) => !isBasemapLayer(l));
          return { ...next, sources: { ...next.sources, ...keepSources }, layers: [...next.layers, ...keepLayers] };
        },
      });
    };
    apply();
  }, [theme, labelLang, caps]);

  // Push store changes to map sources.
  useEffect(() => {
    const unsub = useStore.subscribe((s, prev) => {
      if (s.features !== prev.features || s.hiddenLayerIds !== prev.hiddenLayerIds || s.selectedId !== prev.selectedId || s.editingId !== prev.editingId) {
        syncFeatures();
      }
      if (s.measure !== prev.measure || s.unit !== prev.unit || s.tool !== prev.tool) syncMeasure();
      if (s.tool !== prev.tool) applyTool(s.tool);
      if (s.editingId !== prev.editingId) applyEditing(s.editingId, prev.editingId);
      if (s.markers !== prev.markers) syncMarkers();
      if (mapRef.current && (s.controls !== prev.controls || s.unit !== prev.unit)) applyMapControls(mapRef.current);
      if (mapRef.current && s.interaction !== prev.interaction) applyInteraction(mapRef.current);
      if (s.hillshade !== prev.hillshade) setVisible(['terrain:hillshade'], s.hillshade);
      if (s.contours !== prev.contours) setVisible(['terrain:contours', 'terrain:contour-labels'], s.contours);
      if (s.terrain3d !== prev.terrain3d) applyTerrain3d(s.terrain3d);
      if (s.profileHover !== prev.profileHover) {
        const src = mapRef.current?.getSource('app:profile-hover') as GeoJSONSource | undefined;
        src?.setData({
          type: 'FeatureCollection',
          features: s.profileHover ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: s.profileHover } }] : [],
        });
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useStore.getState();
      if (s.editingId) s.setEditing(null);
      else if (s.tool.type !== 'none') s.setTool({ type: 'none' });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unsub();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  function setVisible(ids: string[], visible: boolean) {
    const map = mapRef.current;
    if (!map) return;
    for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }

  function applyTerrain3d(on: boolean) {
    const map = mapRef.current;
    if (!map || !map.getSource('terrain-3d')) return;
    map.setTerrain(on ? { source: 'terrain-3d', exaggeration: TERRAIN_EXAGGERATION } : null);
    map.easeTo({ pitch: on ? 50 : 0, duration: 800 });
  }

  function syncMarkers() {
    const src = mapRef.current?.getSource('app:markers') as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: useStore.getState().markers.map((m) => ({
        type: 'Feature',
        id: m.id,
        geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
        properties: { markerId: m.id, label: m.label ?? '', color: m.color ?? '#2563eb', milImage: m.sidc ? milImageId(m.sidc, 36) : '' },
      })),
    });
  }

  function syncFeatures() {
    const src = mapRef.current?.getSource('app:features') as GeoJSONSource | undefined;
    if (!src) return;
    const s = useStore.getState();
    const visible = Object.values(s.features).filter((f) => !s.hiddenLayerIds.includes(f.layerId) && f.id !== s.editingId);
    src.setData(toRenderCollection(visible, s.selectedId));
  }

  function syncMeasure() {
    const src = mapRef.current?.getSource('app:measure') as GeoJSONSource | undefined;
    if (!src) return;
    const s = useStore.getState();
    src.setData(measureCollection(s.tool.type === 'measure' ? s.tool.kind : null, s.measure, s.unit));
  }

  function applyTool(tool: Tool) {
    const draw = drawRef.current;
    if (!draw) return;
    draw.setMode('static');
    draw.clear();
    if (tool.type !== 'none') draw.setMode(TD_MODE[tool.kind]);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = tool.type === 'none' ? '' : 'crosshair';
  }

  function applyEditing(id: string | null, prevId: string | null) {
    const draw = drawRef.current;
    if (!draw) return;
    if (prevId) {
      draw.setMode('static');
      draw.clear();
    }
    if (!id) return;
    const f = useStore.getState().features[id];
    if (!f) return;
    draw.setMode('select');
    const [result] = draw.addFeatures([
      { id: f.id, type: 'Feature', geometry: f.geometry, properties: { mode: KIND_TO_TD_MODE[f.kind] } } as GeoJSONStoreFeatures,
    ]);
    if (result?.valid) draw.selectFeature(f.id);
    else useStore.getState().notify(result?.reason ?? 'Cannot edit this geometry');
  }

  async function handleFinished(f: GeoJSONStoreFeatures) {
    const s = useStore.getState();
    const tool = s.tool;
    if (tool.type === 'measure') {
      if (tool.kind === 'rings' && f.geometry.type === 'Point') {
        s.setMeasure({ center: f.geometry.coordinates as [number, number] });
      } else if (f.geometry.type === 'LineString' || f.geometry.type === 'Polygon') {
        const coords = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates) as [number, number][];
        s.setMeasure({ coords: coords.map((c) => [c[0], c[1]]) });
      }
      return;
    }
    if (tool.type !== 'draw') return;
    const geometry = roundGeometry(f.geometry) as FeatureInput['geometry'];
    const input: Partial<FeatureInput> & Pick<FeatureInput, 'layerId' | 'kind' | 'geometry'> = {
      layerId: '',
      kind: tool.kind,
      geometry,
      style: { ...DEFAULT_STYLE },
    };
    if (tool.kind === 'circle' && geometry.type === 'Polygon') Object.assign(input, circleParams(geometry.coordinates));
    if (tool.kind === 'text') input.name = t('kinds.text');
    if (tool.kind === 'milsymbol') input.sidc = s.milSidc;
    if (tool.kind === 'point') input.style = { ...DEFAULT_STYLE, fillColor: '#dc2626' };
    try {
      input.layerId = await ensureLayerId();
      const created = await api.createFeature(input);
      s.upsertFeature(created);
      if (tool.kind !== 'milsymbol') {
        s.setTool({ type: 'none' });
        s.select(created.id);
      }
    } catch (err) {
      s.notify((err as Error).message);
    }
  }

  return <div ref={container} className="map" />;
}
