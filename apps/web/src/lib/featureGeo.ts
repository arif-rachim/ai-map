import * as turf from '@turf/turf';
import type { Feature, Geometry as GeoJsonGeometry, Position } from 'geojson';
import type { MapFeature } from '@ai-map/shared';
import { distanceMeters, formatArea, formatDistance, type DistanceUnit } from '@ai-map/shared';

export function featureBounds(f: Pick<MapFeature, 'geometry'>): [number, number, number, number] {
  return turf.bbox(f.geometry as GeoJsonGeometry) as [number, number, number, number];
}

export interface FeatureMetrics {
  length?: string;
  area?: string;
  perimeter?: string;
  radius?: string;
}

export function featureMetrics(f: MapFeature, unit: DistanceUnit): FeatureMetrics {
  const g = f.geometry;
  if (g.type === 'LineString') {
    return { length: formatDistance(turf.length(turf.lineString(g.coordinates), { units: 'kilometers' }) * 1000, unit) };
  }
  if (g.type === 'Polygon') {
    const poly = turf.polygon(g.coordinates);
    const out: FeatureMetrics = {
      area: formatArea(turf.area(poly), unit),
      perimeter: formatDistance(turf.length(turf.polygonToLine(poly) as Feature, { units: 'kilometers' }) * 1000, unit),
    };
    if (f.kind === 'circle' && f.radiusM) out.radius = formatDistance(f.radiusM, unit);
    return out;
  }
  return {};
}

/** Derives circle center/radius from a (possibly edited) circle polygon. */
export function circleParams(coords: Position[][]): { center: [number, number]; radiusM: number } {
  const ring = coords[0]!;
  const c = turf.centroid(turf.polygon(coords)).geometry.coordinates as [number, number];
  const avg = ring.slice(0, -1).reduce((sum, p) => sum + distanceMeters(c, p), 0) / Math.max(1, ring.length - 1);
  return { center: [round(c[0]), round(c[1])], radiusM: Math.round(avg * 10) / 10 };
}

export function round(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

export function roundGeometry<T extends { type: string; coordinates: unknown }>(g: T): T {
  const r = (v: unknown): unknown => (typeof v === 'number' ? round(v) : Array.isArray(v) ? v.map(r) : v);
  return { ...g, coordinates: r(g.coordinates) };
}
