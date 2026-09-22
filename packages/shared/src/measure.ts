import * as turf from '@turf/turf';
import type { Feature, LineString, Polygon, Position } from 'geojson';

export type DistanceUnit = 'km' | 'nm' | 'mi';

const METERS_PER: Record<DistanceUnit, number> = { km: 1000, nm: 1852, mi: 1609.344 };

export function formatDistance(meters: number, unit: DistanceUnit): string {
  if (unit === 'km' && meters < 1000) return `${Math.round(meters)} m`;
  const v = meters / METERS_PER[unit];
  const label = unit === 'nm' ? 'NM' : unit;
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${label}`;
}

export function formatArea(m2: number, unit: DistanceUnit): string {
  if (unit === 'km' && m2 < 1e6) return `${Math.round(m2).toLocaleString()} m²`;
  const v = m2 / METERS_PER[unit] ** 2;
  const label = unit === 'nm' ? 'NM²' : `${unit}²`;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 2 : v < 1000 ? 1 : 0 })} ${label}`;
}

export function toMeters(value: number, unit: DistanceUnit): number {
  return value * METERS_PER[unit];
}

/** Great-circle distance in meters. */
export function distanceMeters(a: Position, b: Position): number {
  return turf.distance(a, b, { units: 'kilometers' }) * 1000;
}

export function initialBearing(a: Position, b: Position): number {
  return (turf.bearing(a, b) + 360) % 360;
}

export interface SegmentInfo {
  from: Position;
  to: Position;
  meters: number;
  bearing: number;
}

export function lineSegments(coords: Position[]): SegmentInfo[] {
  const out: SegmentInfo[] = [];
  for (let i = 1; i < coords.length; i++) {
    out.push({
      from: coords[i - 1]!,
      to: coords[i]!,
      meters: distanceMeters(coords[i - 1]!, coords[i]!),
      bearing: initialBearing(coords[i - 1]!, coords[i]!),
    });
  }
  return out;
}

/** Densified great-circle path through all vertices, for display. */
export function greatCirclePath(coords: Position[]): Feature<LineString> {
  const path: Position[] = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const km = turf.distance(a, b);
    const npoints = Math.max(2, Math.min(256, Math.ceil(km / 25)));
    const gc = km < 1 ? turf.lineString([a, b]) : turf.greatCircle(a, b, { npoints });
    const seg =
      gc.geometry.type === 'LineString'
        ? gc.geometry.coordinates
        : // Antimeridian split: concatenate parts (renderer handles wrap).
          (gc.geometry.coordinates as Position[][]).flat();
    path.push(...(i === 1 ? seg : seg.slice(1)));
  }
  return turf.lineString(path.length >= 2 ? path : coords);
}

export function polygonAreaM2(polygon: Feature<Polygon> | Polygon): number {
  return turf.area(polygon);
}

export function ring(center: Position, radiusMeters: number): Feature<Polygon> {
  return turf.circle(center, radiusMeters / 1000, { steps: 128, units: 'kilometers' });
}
