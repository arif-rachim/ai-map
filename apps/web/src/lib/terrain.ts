import mlcontour from 'maplibre-contour';
import {
  CONTOUR_THRESHOLDS,
  elevationAt as sampleElevation,
  elevationProfile as sampleProfile,
  type DemGrid,
  type ElevationProfile,
} from '@ai-map/shared';
import type { Position } from 'geojson';

export type { ElevationProfile as Profile, ProfilePoint } from '@ai-map/shared';

export const TERRAIN_TILES = '/api/v1/tiles/terrain/{z}/{x}/{y}';

type DemSource = InstanceType<typeof mlcontour.DemSource>;
let dem: DemSource | null = null;

/** Shared DEM loader used for contour generation and elevation queries (decodes tiles in a worker). */
export function demSource(maxzoom: number): DemSource {
  dem ??= new mlcontour.DemSource({
    url: `${location.origin}${TERRAIN_TILES}`,
    encoding: 'terrarium',
    maxzoom,
    worker: true,
    cacheSize: 200,
  });
  return dem;
}

export function contourTileUrl(maxzoom: number): string {
  return demSource(maxzoom).contourProtocolUrl({
    thresholds: CONTOUR_THRESHOLDS,
    elevationKey: 'ele',
    levelKey: 'level',
    contourLayer: 'contours',
    multiplier: 1,
    overzoom: 1,
  });
}

const pending = new Map<string, Promise<DemGrid | null>>();

function tileGetter(maxzoom: number) {
  return (z: number, x: number, y: number): Promise<DemGrid | null> => {
    const key = `${z}/${x}/${y}`;
    let p = pending.get(key);
    if (!p) {
      p = demSource(maxzoom)
        .getDemTile(z, x, y)
        .catch(() => null);
      pending.set(key, p);
      if (pending.size > 400) pending.delete(pending.keys().next().value!);
    }
    return p;
  };
}

/** Elevation in meters (bilinear), or null where no DEM data exists. */
export function elevationAt(lon: number, lat: number, z: number, maxzoom: number): Promise<number | null> {
  return sampleElevation(tileGetter(maxzoom), lon, lat, Math.max(0, Math.min(maxzoom, Math.round(z))));
}

export function elevationProfile(path: Position[], maxzoom: number, samples = 200): Promise<ElevationProfile> {
  return sampleProfile(path, tileGetter(maxzoom), maxzoom, samples);
}
