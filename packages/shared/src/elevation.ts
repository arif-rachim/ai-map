import * as turf from '@turf/turf';
import type { Position } from 'geojson';

/** Decoded DEM tile: elevations in meters, row-major. */
export interface DemGrid {
  width: number;
  height: number;
  data: Float32Array;
}

export type DemTileGetter = (z: number, x: number, y: number) => Promise<DemGrid | null>;

/** Terrarium encoding: (R * 256 + G + B / 256) - 32768. `pixels` is RGB or RGBA. */
export function decodeTerrarium(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number): DemGrid {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    data[i] = pixels[o]! * 256 + pixels[o + 1]! + pixels[o + 2]! / 256 - 32768;
  }
  return { width, height, data };
}

export function tileCoord(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.min(n - 1, Math.floor(x));
  const ty = Math.min(n - 1, Math.floor(y));
  return { tx, ty, fx: x - tx, fy: y - ty };
}

/** Bilinear sample at fractional tile position (0..1). */
export function sampleGrid(grid: DemGrid, fx: number, fy: number): number | null {
  const px = Math.min(grid.width - 1.001, Math.max(0, fx * grid.width - 0.5));
  const py = Math.min(grid.height - 1.001, Math.max(0, fy * grid.height - 0.5));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const dx = px - x0;
  const dy = py - y0;
  const at = (x: number, y: number) => grid.data[y * grid.width + x]!;
  const v = at(x0, y0) * (1 - dx) * (1 - dy) + at(x0 + 1, y0) * dx * (1 - dy) + at(x0, y0 + 1) * (1 - dx) * dy + at(x0 + 1, y0 + 1) * dx * dy;
  return Number.isFinite(v) ? v : null;
}

export async function elevationAt(getTile: DemTileGetter, lon: number, lat: number, zoom: number): Promise<number | null> {
  const { tx, ty, fx, fy } = tileCoord(lon, lat, zoom);
  const grid = await getTile(zoom, tx, ty);
  return grid ? sampleGrid(grid, fx, fy) : null;
}

export interface ProfilePoint {
  distanceM: number;
  elevation: number | null;
  coord: [number, number];
}

export interface ElevationProfile {
  points: ProfilePoint[];
  min: number | null;
  max: number | null;
  ascentM: number;
  descentM: number;
  zoom: number;
}

/**
 * Samples elevation evenly along `path` (as given; densify great-circle paths beforehand).
 * The DEM zoom is chosen so a DEM pixel roughly matches the sample spacing.
 */
export async function elevationProfile(
  path: Position[],
  getTile: DemTileGetter,
  maxzoom: number,
  samples = 200,
  tileSize = 512,
): Promise<ElevationProfile> {
  const line = turf.lineString(path);
  const totalKm = turf.length(line, { units: 'kilometers' });
  const stepM = Math.max(1, (totalKm * 1000) / (samples - 1));
  const midLat = turf.along(line, totalKm / 2).geometry.coordinates[1]!;
  const metersPerPixelZ0 = (40075016.686 * Math.cos((midLat * Math.PI) / 180)) / tileSize;
  const zoom = Math.max(0, Math.min(maxzoom, Math.ceil(Math.log2(metersPerPixelZ0 / stepM))));

  const points = await Promise.all(
    Array.from({ length: samples }, async (_, i) => {
      const km = (totalKm * i) / (samples - 1);
      const c = turf.along(line, km, { units: 'kilometers' }).geometry.coordinates as [number, number];
      return { distanceM: km * 1000, coord: c, elevation: await elevationAt(getTile, c[0], c[1], zoom) };
    }),
  );

  let min: number | null = null;
  let max: number | null = null;
  let ascentM = 0;
  let descentM = 0;
  let prev: number | null = null;
  for (const p of points) {
    if (p.elevation === null) continue;
    min = min === null ? p.elevation : Math.min(min, p.elevation);
    max = max === null ? p.elevation : Math.max(max, p.elevation);
    if (prev !== null) {
      const d = p.elevation - prev;
      if (d > 0) ascentM += d;
      else descentM -= d;
    }
    prev = p.elevation;
  }
  return { points, min, max, ascentM, descentM, zoom };
}
