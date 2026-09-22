import { z } from 'zod';
import { FeatureInput, FeaturePatch, Geometry, LayerInput, LayerPatch, Style } from '@ai-map/shared';

const schema = (s: z.ZodType) => z.toJSONSchema(s, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (s: object) => ({ content: { 'application/json': { schema: s } } });
const geojson = { content: { 'application/geo+json': { schema: { type: 'object' } } } };
const uuidParam = (name: string, where = 'path') => ({ name, in: where, required: where === 'path', schema: { type: 'string', format: 'uuid' } });
const q = (name: string, type: string, description: string, extra: object = {}) => ({ name, in: 'query', schema: { type, ...extra }, description });
const errors = { '400': { description: 'Invalid input' }, '404': { description: 'Not found' } };

const Position = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, example: [46.6753, 24.7136] };

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'AI Map API',
    version: '1.0.0',
    description: [
      'Offline map services for integration with other applications on the LAN.',
      '',
      '- **Basemap**: MapLibre style documents, vector tiles (XYZ + TileJSON), terrain DEM tiles (Terrarium).',
      '- **Services**: unified search (coordinates DD/DMS/MGRS/UTM, airports, places), airports, elevation and elevation profiles.',
      '- **Drawings**: layers and features (CRUD, optimistic locking via `version`), GeoJSON/KML export, GeoJSON import.',
      '- **Real-time**: WebSocket `GET /api/v1/events` pushes `feature.created|updated|deleted` and `layer.created|updated|deleted` messages as JSON.',
      '- **OGC API - Features** (read-only) under `/api/v1/ogc` for GIS software.',
      '',
      'No authentication is required. Coordinates are WGS84 longitude/latitude.',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'Basemap' },
    { name: 'Search' },
    { name: 'Elevation' },
    { name: 'Layers' },
    { name: 'Features' },
    { name: 'Exchange' },
    { name: 'OGC API Features' },
    { name: 'System' },
  ],
  components: {
    schemas: {
      Geometry: schema(Geometry),
      Style: schema(Style),
      FeatureInput: schema(FeatureInput),
      FeaturePatch: schema(FeaturePatch),
      LayerInput: schema(LayerInput),
      LayerPatch: schema(LayerPatch),
      Feature: {
        allOf: [
          ref('FeatureInput'),
          {
            type: 'object',
            required: ['id', 'version', 'createdAt', 'updatedAt'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              version: { type: 'integer', description: 'Send back in PATCH; a stale version returns 409' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
      Layer: {
        allOf: [
          ref('LayerInput'),
          {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } },
          },
        ],
      },
      Airport: {
        type: 'object',
        properties: {
          ident: { type: 'string' },
          iata: { type: 'string', nullable: true },
          icao: { type: 'string', nullable: true },
          name: { type: 'string' },
          type: { type: 'string', example: 'large_airport' },
          country: { type: 'string', example: 'AE' },
          municipality: { type: 'string', nullable: true },
          lon: { type: 'number' },
          lat: { type: 'number' },
        },
      },
      SearchResult: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['coordinates', 'airport', 'place'] },
          name: { type: 'string' },
          detail: { type: 'string' },
          lon: { type: 'number' },
          lat: { type: 'number' },
          bbox: { type: 'array', items: { type: 'number' }, description: 'minLon,minLat,maxLon,maxLat' },
        },
      },
      Capabilities: {
        type: 'object',
        properties: {
          region: { type: 'boolean' },
          world: { type: 'boolean' },
          terrain: { type: 'boolean' },
          terrainMaxzoom: { type: 'integer', nullable: true },
          terrainBounds: { type: 'array', items: { type: 'number' }, nullable: true },
          geocoder: { type: 'boolean' },
        },
      },
      ElevationProfile: {
        type: 'object',
        properties: {
          points: {
            type: 'array',
            items: { type: 'object', properties: { distanceM: { type: 'number' }, elevation: { type: 'number', nullable: true }, coord: Position } },
          },
          min: { type: 'number', nullable: true },
          max: { type: 'number', nullable: true },
          ascentM: { type: 'number' },
          descentM: { type: 'number' },
          zoom: { type: 'integer', description: 'DEM zoom used for sampling' },
        },
      },
      ImportResult: {
        type: 'object',
        properties: {
          created: { type: 'integer' },
          deleted: { type: 'integer' },
          ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
          errors: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, message: { type: 'string' } } } },
        },
      },
    },
  },
  paths: {
    '/health': { get: { tags: ['System'], summary: 'Liveness', responses: { '200': { description: 'OK' } } } },
    '/capabilities': { get: { tags: ['System'], summary: 'Installed datasets and services', responses: { '200': json(ref('Capabilities')) } } },
    '/styles/{theme}.json': {
      get: {
        tags: ['Basemap'],
        summary: 'MapLibre GL style document',
        description: 'Use directly: `new maplibregl.Map({ style: "http://<server>/api/v1/styles/light.json" })`. QGIS: Vector Tiles → New connection → Style URL.',
        parameters: [
          { name: 'theme', in: 'path', required: true, schema: { type: 'string', enum: ['light', 'dark'] } },
          q('lang', 'string', 'Label language', { enum: ['en', 'ar'], default: 'en' }),
          q('terrain', 'string', 'Terrain rendering', { enum: ['none', 'hillshade', '3d'], default: 'hillshade' }),
        ],
        responses: { '200': json({ type: 'object' }) },
      },
    },
    '/tiles': { get: { tags: ['Basemap'], summary: 'Installed tilesets', responses: { '200': json({ type: 'array', items: { type: 'object' } }) } } },
    '/tiles/{name}.json': {
      get: {
        tags: ['Basemap'],
        summary: 'TileJSON 3.0 for a tileset',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', enum: ['world', 'region', 'terrain'] } }],
        responses: { '200': json({ type: 'object' }), ...errors },
      },
    },
    '/tiles/{name}/{z}/{x}/{y}': {
      get: {
        tags: ['Basemap'],
        summary: 'Tile (XYZ). world/region: Mapbox Vector Tile (Protomaps schema); terrain: Terrarium-encoded WebP (512 px)',
        description: 'An optional extension may be appended to `y` (e.g. `.mvt`, `.webp`). Missing tiles return 204.',
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string', enum: ['world', 'region', 'terrain'] } },
          { name: 'z', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'x', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'y', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Tile bytes' }, '204': { description: 'No tile at this position' } },
      },
    },
    '/search': {
      get: {
        tags: ['Search'],
        summary: 'Unified search: coordinates (DD, DMS, MGRS, UTM), airports (name/IATA/ICAO), places and addresses',
        parameters: [
          q('q', 'string', 'Query text, e.g. "Riyadh", "DXB", "25.2, 55.3", "38R PK 12345 67890"'),
          q('lang', 'string', 'Result language', { enum: ['en', 'ar'], default: 'en' }),
          q('limit', 'integer', 'Max results', { default: 10, maximum: 50 }),
          q('types', 'string', 'Comma list of coordinates,airport,place', { default: 'coordinates,airport,place' }),
        ],
        responses: { '200': json({ type: 'array', items: ref('SearchResult') }) },
      },
    },
    '/airports/search': {
      get: {
        tags: ['Search'],
        summary: 'Airport search by name, city, IATA or ICAO',
        parameters: [q('q', 'string', 'Query'), q('limit', 'integer', 'Max results', { default: 10 })],
        responses: { '200': json({ type: 'array', items: ref('Airport') }) },
      },
    },
    '/airports/{code}': {
      get: {
        tags: ['Search'],
        summary: 'Airport by IATA / ICAO / ident',
        parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' }, example: 'OMDB' }],
        responses: { '200': json(ref('Airport')), ...errors },
      },
    },
    '/elevation': {
      get: {
        tags: ['Elevation'],
        summary: 'Elevation (m) at a point',
        parameters: [q('lon', 'number', 'Longitude'), q('lat', 'number', 'Latitude')],
        responses: { '200': json({ type: 'object', properties: { lon: { type: 'number' }, lat: { type: 'number' }, elevation: { type: 'number', nullable: true } } }), '503': { description: 'Terrain not installed' } },
      },
      post: {
        tags: ['Elevation'],
        summary: 'Elevation for many points (max 1000)',
        requestBody: json({ type: 'object', required: ['points'], properties: { points: { type: 'array', items: Position } } }),
        responses: { '200': json({ type: 'array', items: { type: 'object' } }), '503': { description: 'Terrain not installed' } },
      },
    },
    '/elevation/profile': {
      post: {
        tags: ['Elevation'],
        summary: 'Elevation profile along a line',
        requestBody: json({
          type: 'object',
          required: ['coordinates'],
          properties: {
            coordinates: { type: 'array', items: Position },
            samples: { type: 'integer', default: 200, maximum: 2000 },
            greatCircle: { type: 'boolean', default: true, description: 'Follow great-circle arcs between vertices' },
          },
        }),
        responses: { '200': json(ref('ElevationProfile')), '503': { description: 'Terrain not installed' } },
      },
    },
    '/layers': {
      get: { tags: ['Layers'], summary: 'List layers', responses: { '200': json({ type: 'array', items: ref('Layer') }) } },
      post: { tags: ['Layers'], summary: 'Create layer', requestBody: json(ref('LayerInput')), responses: { '201': json(ref('Layer')), ...errors } },
    },
    '/layers/{id}': {
      parameters: [uuidParam('id')],
      get: { tags: ['Layers'], summary: 'Get layer', responses: { '200': json(ref('Layer')), ...errors } },
      patch: { tags: ['Layers'], summary: 'Update layer', requestBody: json(ref('LayerPatch')), responses: { '200': json(ref('Layer')), ...errors } },
      delete: { tags: ['Layers'], summary: 'Delete layer and its features', responses: { '204': { description: 'Deleted' }, ...errors } },
    },
    '/features': {
      get: {
        tags: ['Features'],
        summary: 'List features',
        parameters: [uuidParam('layerId', 'query'), q('bbox', 'string', 'minLon,minLat,maxLon,maxLat'), q('limit', 'integer', 'Page size'), q('offset', 'integer', 'Offset')],
        responses: { '200': json({ type: 'array', items: ref('Feature') }) },
      },
      post: { tags: ['Features'], summary: 'Create feature', requestBody: json(ref('FeatureInput')), responses: { '201': json(ref('Feature')), ...errors } },
    },
    '/features/{id}': {
      parameters: [uuidParam('id')],
      get: { tags: ['Features'], summary: 'Get feature', responses: { '200': json(ref('Feature')), ...errors } },
      patch: {
        tags: ['Features'],
        summary: 'Update feature (optimistic locking)',
        requestBody: json(ref('FeaturePatch')),
        responses: { '200': json(ref('Feature')), '409': { description: 'Version conflict; body.current holds the latest feature' }, ...errors },
      },
      delete: { tags: ['Features'], summary: 'Delete feature', responses: { '204': { description: 'Deleted' }, ...errors } },
    },
    '/features.geojson': {
      get: {
        tags: ['Exchange'],
        summary: 'Features as a GeoJSON FeatureCollection',
        parameters: [uuidParam('layerId', 'query'), q('bbox', 'string', 'minLon,minLat,maxLon,maxLat')],
        responses: { '200': geojson },
      },
    },
    '/layers/{id}/export.{format}': {
      get: {
        tags: ['Exchange'],
        summary: 'Download a layer as GeoJSON or KML',
        parameters: [uuidParam('id'), { name: 'format', in: 'path', required: true, schema: { type: 'string', enum: ['geojson', 'kml'] } }],
        responses: { '200': { description: 'File' }, ...errors },
      },
    },
    '/layers/{id}/import': {
      post: {
        tags: ['Exchange'],
        summary: 'Import a GeoJSON FeatureCollection into a layer',
        description:
          'Recognised feature properties: kind (rectangle|polygon|circle|line|point|text|milsymbol), name (or title), description, style, radiusM, center, sidc. Kind defaults from geometry; Multi* geometries are split. `mode=replace` clears the layer first (atomic).',
        parameters: [uuidParam('id'), q('mode', 'string', 'append or replace', { enum: ['append', 'replace'], default: 'append' })],
        requestBody: { content: { 'application/geo+json': { schema: { type: 'object' } }, 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': json(ref('ImportResult')), ...errors },
      },
    },
    '/ogc': { get: { tags: ['OGC API Features'], summary: 'Landing page', responses: { '200': json({ type: 'object' }) } } },
    '/ogc/conformance': { get: { tags: ['OGC API Features'], summary: 'Conformance classes', responses: { '200': json({ type: 'object' }) } } },
    '/ogc/collections': { get: { tags: ['OGC API Features'], summary: 'Collections (one per layer)', responses: { '200': json({ type: 'object' }) } } },
    '/ogc/collections/{collectionId}': {
      get: { tags: ['OGC API Features'], summary: 'Collection', parameters: [uuidParam('collectionId')], responses: { '200': json({ type: 'object' }), ...errors } },
    },
    '/ogc/collections/{collectionId}/items': {
      get: {
        tags: ['OGC API Features'],
        summary: 'Features of a collection',
        parameters: [uuidParam('collectionId'), q('limit', 'integer', 'Page size', { default: 100, maximum: 10000 }), q('offset', 'integer', 'Offset'), q('bbox', 'string', 'minLon,minLat,maxLon,maxLat')],
        responses: { '200': geojson, ...errors },
      },
    },
    '/ogc/collections/{collectionId}/items/{featureId}': {
      get: { tags: ['OGC API Features'], summary: 'Single feature', parameters: [uuidParam('collectionId'), uuidParam('featureId')], responses: { '200': geojson, ...errors } },
    },
  },
};
