import type { StyleSpecification } from 'maplibre-gl';
import { buildBasemapStyle, type DataCapabilities, type LabelLang, type TerrainOptions, type Theme } from '@ai-map/shared';
import { contourTileUrl } from './terrain';

export type { LabelLang, TerrainOptions, Theme } from '@ai-map/shared';
export { TERRAIN_EXAGGERATION, TERRAIN_SOURCES } from '@ai-map/shared';

export const DATA_URL = '/data';
export const API_URL = '/api/v1';

/** The web app reads PMTiles directly from nginx (fastest path); external clients use the XYZ/TileJSON API. */
export function buildStyle(theme: Theme, lang: LabelLang, caps: DataCapabilities, terrain: TerrainOptions): StyleSpecification {
  const origin = location.origin;
  const maxzoom = caps.terrainMaxzoom;
  return buildBasemapStyle({
    theme,
    lang: 'en', // Labels are always English (Arabic labels pull the RTL plugin and extra glyphs).
    glyphs: `${origin}${DATA_URL}/assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}${DATA_URL}/assets/sprites/v4`,
    world: caps.world ? { url: `pmtiles://${origin}${DATA_URL}/tiles/world.pmtiles` } : undefined,
    region: caps.region ? { url: `pmtiles://${origin}${DATA_URL}/tiles/region.pmtiles` } : undefined,
    terrain:
      caps.terrain && maxzoom !== null
        ? { tiles: [`${origin}${API_URL}/tiles/terrain/{z}/{x}/{y}`], maxzoom, bounds: caps.terrainBounds ?? undefined }
        : undefined,
    contoursTileUrl: caps.terrain && maxzoom !== null ? contourTileUrl(maxzoom) : undefined,
    terrainOptions: terrain,
  }) as StyleSpecification;
}
