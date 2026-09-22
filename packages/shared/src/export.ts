import type { Feature, FeatureCollection, Geometry as GeoJsonGeometry } from 'geojson';
import { FEATURE_KINDS, FeatureInput, type FeatureKind, type MapFeature, type MapLayer } from './schemas';

/** Stored feature as a standard GeoJSON Feature; all attributes live in `properties`. */
export function featureToGeoJSON(f: MapFeature): Feature {
  return {
    type: 'Feature',
    id: f.id,
    geometry: f.geometry as GeoJsonGeometry,
    properties: {
      layerId: f.layerId,
      kind: f.kind,
      name: f.name,
      description: f.description,
      style: f.style,
      radiusM: f.radiusM,
      center: f.center,
      sidc: f.sidc,
      version: f.version,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    },
  };
}

export function featuresToGeoJSON(features: MapFeature[], layer?: MapLayer): FeatureCollection & { name?: string } {
  return {
    type: 'FeatureCollection',
    ...(layer ? { name: layer.name } : {}),
    features: features.map(featureToGeoJSON),
  };
}

export interface ImportResult {
  inputs: FeatureInput[];
  errors: { index: number; message: string }[];
}

const INFERRED_KIND: Record<string, FeatureKind> = { Point: 'point', LineString: 'line', Polygon: 'polygon' };

/**
 * Converts a GeoJSON FeatureCollection (e.g. produced by another system) into feature inputs for `layerId`.
 * Recognised properties: kind, name, description, style, radiusM, center, sidc. Kind defaults from geometry type.
 * Multi-geometries are split into one feature per part.
 */
export function geoJSONToFeatureInputs(data: unknown, layerId: string): ImportResult {
  const result: ImportResult = { inputs: [], errors: [] };
  const fc = data as { type?: string; features?: unknown[] };
  const features = fc?.type === 'FeatureCollection' && Array.isArray(fc.features) ? fc.features : fc?.type === 'Feature' ? [fc] : null;
  if (!features) {
    result.errors.push({ index: -1, message: 'Expected a GeoJSON FeatureCollection or Feature' });
    return result;
  }
  features.forEach((raw, index) => {
    const f = raw as { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> | null };
    const props = f?.properties ?? {};
    const geom = f?.geometry;
    if (!geom) return result.errors.push({ index, message: 'Missing geometry' });
    const parts =
      geom.type === 'MultiPoint' || geom.type === 'MultiLineString' || geom.type === 'MultiPolygon'
        ? (geom.coordinates as unknown[]).map((coordinates) => ({ type: geom.type.replace('Multi', ''), coordinates }))
        : [geom];
    for (const part of parts) {
      const kindProp = typeof props.kind === 'string' && (FEATURE_KINDS as readonly string[]).includes(props.kind) ? (props.kind as FeatureKind) : null;
      const kind = kindProp ?? INFERRED_KIND[part.type];
      if (!kind) {
        result.errors.push({ index, message: `Unsupported geometry type ${part.type}` });
        continue;
      }
      const parsed = FeatureInput.safeParse({
        layerId,
        kind,
        geometry: part,
        name: typeof props.name === 'string' ? props.name : typeof props.title === 'string' ? props.title : '',
        description: typeof props.description === 'string' ? props.description : '',
        style: typeof props.style === 'object' && props.style ? props.style : undefined,
        radiusM: props.radiusM ?? null,
        center: props.center ?? null,
        sidc: props.sidc ?? null,
      });
      if (parsed.success) result.inputs.push(parsed.data);
      else result.errors.push({ index, message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
  });
  return result;
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** #rrggbb + opacity → KML aabbggrr */
function kmlColor(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? [, 'ff', '00', '00'];
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${a}${m[3]}${m[2]}${m[1]}`.toLowerCase();
}

const coordText = (cs: number[][]) => cs.map((c) => `${c[0]},${c[1]}`).join(' ');

/** KML 2.2 document (Google Earth, most GIS tools). Circles are exported as their polygon outline. */
export function featuresToKML(features: MapFeature[], documentName: string): string {
  const placemarks = features.map((f) => {
    const s = f.style;
    const style = `<Style><LineStyle><color>${kmlColor(s.strokeColor, s.strokeOpacity)}</color><width>${s.strokeWidth}</width></LineStyle><PolyStyle><color>${kmlColor(s.fillColor, s.fillOpacity)}</color></PolyStyle><IconStyle><color>${kmlColor(s.fillColor, 1)}</color></IconStyle></Style>`;
    const g = f.geometry;
    const geometry =
      g.type === 'Point'
        ? `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]}</coordinates></Point>`
        : g.type === 'LineString'
          ? `<LineString><tessellate>1</tessellate><coordinates>${coordText(g.coordinates)}</coordinates></LineString>`
          : `<Polygon><tessellate>1</tessellate>${g.coordinates
              .map((ring, i) => `<${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${coordText(ring)}</coordinates></LinearRing></${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`)
              .join('')}</Polygon>`;
    const data = [
      ['kind', f.kind],
      ['sidc', f.sidc ?? ''],
      ['radiusM', f.radiusM === null ? '' : String(f.radiusM)],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `<Data name="${k}"><value>${xml(v!)}</value></Data>`)
      .join('');
    return `<Placemark id="${f.id}"><name>${xml(f.name)}</name><description>${xml(f.description)}</description>${style}<ExtendedData>${data}</ExtendedData>${geometry}</Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(documentName)}</name>${placemarks.join('')}</Document></kml>\n`;
}
