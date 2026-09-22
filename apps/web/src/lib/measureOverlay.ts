import * as turf from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';
import type { MeasureState, MeasureTool } from '../store';
import { formatArea, formatDistance, greatCirclePath, lineSegments, ring, toMeters, type DistanceUnit } from '@ai-map/shared';

export function parseRadii(text: string): number[] {
  return text
    .split(/[,;\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 12);
}

export function measureCollection(kind: MeasureTool | null, m: MeasureState, unit: DistanceUnit): FeatureCollection {
  const features: Feature[] = [];
  const label = (coord: [number, number], text: string, primary = false) =>
    features.push(turf.point(coord, { role: 'label', text, primary }));

  if (kind === 'distance' && m.coords && m.coords.length >= 2) {
    features.push(greatCirclePath(m.coords));
    const segs = lineSegments(m.coords);
    let total = 0;
    segs.forEach((s) => {
      total += s.meters;
      if (segs.length > 1) label(turf.midpoint(s.from, s.to).geometry.coordinates as [number, number], formatDistance(s.meters, unit));
    });
    label(m.coords.at(-1)!, formatDistance(total, unit), true);
  }
  if (kind === 'distance' || kind === 'area') {
    for (const c of m.coords ?? []) features.push(turf.point(c, { role: 'vertex' }));
  }
  if (kind === 'area' && m.coords && m.coords.length >= 3) {
    const ringCoords = [...m.coords];
    const first = ringCoords[0]!;
    const last = ringCoords.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) ringCoords.push(first);
    const poly = turf.polygon([ringCoords]);
    features.push(poly);
    label(turf.centroid(poly).geometry.coordinates as [number, number], formatArea(turf.area(poly), unit), true);
  }
  if (kind === 'rings' && m.center) {
    features.push(turf.point(m.center, { role: 'vertex' }));
    for (const r of parseRadii(m.radii)) {
      const meters = toMeters(r, unit);
      features.push(turf.polygonToLine(ring(m.center, meters)) as Feature);
      const north = turf.destination(m.center, meters / 1000, 0, { units: 'kilometers' }).geometry.coordinates as [number, number];
      label(north, formatDistance(meters, unit));
    }
  }
  return turf.featureCollection(features);
}
