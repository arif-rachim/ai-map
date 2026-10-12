import type { LayerSpecification, SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { layers, namedFlavor } from '@protomaps/basemaps';

export type Theme = 'light' | 'dark';
/** User preference; `auto` follows the operating system appearance. */
export type ThemePreference = Theme | 'auto';

export interface TerrainOptions {
  hillshade: boolean;
  contours: boolean;
  terrain3d: boolean;
}

/** Terrain DEM tiles are Terrarium-encoded, 512 px. */
export const TERRAIN_TILE_SIZE = 512;
export const TERRAIN_SOURCES = ['terrain-dem', 'terrain-3d', 'contours'];
export const TERRAIN_EXAGGERATION = 1.5;
export const BASEMAP_ATTRIBUTION = '© OpenStreetMap contributors, Protomaps';
export const TERRAIN_ATTRIBUTION = 'Terrain: Mapterhorn (Copernicus DEM and others)';

/** Contour interval per zoom as [minor, major] meters; major lines are labelled. */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  5: [500, 1000],
  8: [200, 1000],
  10: [100, 500],
  11: [50, 250],
  12: [20, 100],
  13: [10, 50],
};

/** A vector source given either as a TileJSON / pmtiles:// URL or as XYZ tile templates. */
export interface TileSourceRef {
  url?: string;
  tiles?: string[];
  maxzoom?: number;
  bounds?: [number, number, number, number];
}

export interface BasemapStyleOptions {
  theme: Theme;
  glyphs: string;
  /** Sprite base URL without theme suffix, e.g. https://host/data/assets/sprites/v4 */
  sprite: string;
  world?: TileSourceRef;
  region?: TileSourceRef;
  terrain?: TileSourceRef & { maxzoom: number };
  /** Vector tile URL template produced client-side by maplibre-contour; omit where not available. */
  contoursTileUrl?: string;
  terrainOptions: TerrainOptions;
}

/** Labels are always English. */
function prefixed(source: string, theme: Theme, dropBackground: boolean): LayerSpecification[] {
  return layers(source, namedFlavor(theme), { lang: 'en' })
    .filter((l) => !(dropBackground && l.type === 'background'))
    .map((l) => ({ ...l, id: `${source}:${l.id}` }) as LayerSpecification);
}

function vectorSource(ref: TileSourceRef, attribution: string): SourceSpecification {
  return { type: 'vector', ...(ref.url ? { url: ref.url } : { tiles: ref.tiles ?? [] }), ...(ref.maxzoom !== undefined && !ref.url ? { maxzoom: ref.maxzoom } : {}), attribution };
}

export function isBasemapLayerId(id: string): boolean {
  return id === 'background' || id.startsWith('world:') || id.startsWith('region:') || id.startsWith('terrain:');
}

/**
 * World tiles (z0-7, overzoomed beyond) are drawn first; the detailed region tiles are drawn on top,
 * so inside the region the region's fills cover the coarser world data and its labels.
 * Terrain relief sits above land/water fills but below roads, boundaries and labels.
 */
export function buildBasemapStyle(o: BasemapStyleOptions): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  const styleLayers: LayerSpecification[] = [];
  const { theme } = o;

  if (o.world) {
    sources.world = vectorSource(o.world, BASEMAP_ATTRIBUTION);
    styleLayers.push(...prefixed('world', theme, false));
  }
  if (o.region) {
    sources.region = vectorSource(o.region, BASEMAP_ATTRIBUTION);
    styleLayers.push(...prefixed('region', theme, !!o.world));
  }
  if (!o.world && !o.region) {
    styleLayers.push({ id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#1f2937' : '#e5e7eb' } });
  }

  let terrainSpec: StyleSpecification['terrain'];
  if (o.terrain) {
    const t = o.terrainOptions;
    const dem = {
      type: 'raster-dem' as const,
      ...(o.terrain.url ? { url: o.terrain.url } : { tiles: o.terrain.tiles ?? [], maxzoom: o.terrain.maxzoom }),
      tileSize: TERRAIN_TILE_SIZE,
      encoding: 'terrarium' as const,
      ...(o.terrain.bounds && !o.terrain.url ? { bounds: o.terrain.bounds } : {}),
    };
    // Separate sources for hillshade and 3D mesh, as recommended by MapLibre.
    sources['terrain-dem'] = { ...dem, attribution: TERRAIN_ATTRIBUTION };
    sources['terrain-3d'] = dem;

    const dark = theme === 'dark';
    const relief: LayerSpecification[] = [
      {
        id: 'terrain:hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        layout: { visibility: t.hillshade ? 'visible' : 'none' },
        paint: {
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': dark ? '#000000' : '#473b24',
          'hillshade-highlight-color': dark ? '#374151' : '#ffffff',
          'hillshade-accent-color': dark ? '#111827' : '#5a4a2d',
        },
      },
    ];
    const labels: LayerSpecification[] = [];
    if (o.contoursTileUrl) {
      sources.contours = { type: 'vector', tiles: [o.contoursTileUrl], maxzoom: 15 };
      relief.push({
        id: 'terrain:contours',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        layout: { visibility: t.contours ? 'visible' : 'none' },
        paint: {
          'line-color': dark ? 'rgba(253, 230, 138, 0.35)' : 'rgba(120, 83, 40, 0.45)',
          'line-width': ['match', ['get', 'level'], 1, 1, 0.5],
        },
      });
      labels.push({
        id: 'terrain:contour-labels',
        type: 'symbol',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['>', ['get', 'level'], 0],
        layout: {
          visibility: t.contours ? 'visible' : 'none',
          'symbol-placement': 'line',
          'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
        },
        paint: {
          'text-color': dark ? '#fde68a' : '#78350f',
          'text-halo-color': dark ? '#111827' : '#ffffff',
          'text-halo-width': 1,
        },
      });
    }
    const prefix = o.region ? 'region:' : 'world:';
    const firstAbove = styleLayers.findIndex((l, i) => i > 0 && (l.type === 'line' || l.type === 'symbol') && l.id.startsWith(prefix));
    styleLayers.splice(firstAbove < 0 ? styleLayers.length : firstAbove, 0, ...relief);
    styleLayers.push(...labels);
    if (t.terrain3d) terrainSpec = { source: 'terrain-3d', exaggeration: TERRAIN_EXAGGERATION };
  }

  return {
    version: 8,
    glyphs: o.glyphs,
    sprite: `${o.sprite}/${theme}`,
    sources,
    layers: styleLayers,
    ...(terrainSpec ? { terrain: terrainSpec } : {}),
  };
}
