import { describe, expect, it } from 'vitest';
import { featuresToKML, featureToGeoJSON, geoJSONToFeatureInputs } from './export';
import { DEFAULT_STYLE, type MapFeature } from './schemas';

const LAYER = '11111111-1111-4111-8111-111111111111';

const feature: MapFeature = {
  id: '22222222-2222-4222-8222-222222222222',
  layerId: LAYER,
  kind: 'circle',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  name: 'Zone <A> & "B"',
  description: '',
  style: { ...DEFAULT_STYLE, strokeColor: '#112233', strokeOpacity: 0.5 },
  radiusM: 1000,
  center: [0.5, 0.5],
  sidc: null,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GeoJSON export/import', () => {
  it('round-trips a feature through GeoJSON', () => {
    const gj = featureToGeoJSON(feature);
    expect(gj.id).toBe(feature.id);
    const { inputs, errors } = geoJSONToFeatureInputs({ type: 'FeatureCollection', features: [gj] }, LAYER);
    expect(errors).toEqual([]);
    expect(inputs[0]).toMatchObject({ kind: 'circle', radiusM: 1000, center: [0.5, 0.5], name: feature.name, style: { strokeColor: '#112233' } });
  });

  it('infers kinds, splits multi-geometries and reports invalid features', () => {
    const { inputs, errors } = geoJSONToFeatureInputs(
      {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 20] }, properties: { title: 'A' } },
          { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] }, properties: null },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [500, 0] }, properties: {} },
          { type: 'Feature', geometry: null, properties: {} },
        ],
      },
      LAYER,
    );
    expect(inputs.map((i) => i.kind)).toEqual(['point', 'polygon', 'polygon']);
    expect(inputs[0]!.name).toBe('A');
    expect(errors.map((e) => e.index)).toEqual([2, 3]);
  });

  it('rejects non-GeoJSON input', () => {
    expect(geoJSONToFeatureInputs({ foo: 1 }, LAYER).errors[0]!.index).toBe(-1);
  });
});

describe('KML export', () => {
  it('escapes text and converts colors to aabbggrr', () => {
    const kml = featuresToKML([feature], 'Layer & co');
    expect(kml).toContain('<name>Layer &amp; co</name>');
    expect(kml).toContain('<name>Zone &lt;A&gt; &amp; &quot;B&quot;</name>');
    expect(kml).toContain('<color>80332211</color>');
    expect(kml).toContain('<coordinates>0,0 1,0 1,1 0,0</coordinates>');
  });
});
