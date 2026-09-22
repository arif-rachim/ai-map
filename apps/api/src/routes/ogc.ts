import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { featureToGeoJSON } from '@ai-map/shared';
import { Bbox, HttpError, parse, publicBase } from '../http.js';
import * as repo from '../repo.js';

const GEOJSON = 'application/geo+json';
const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';

/** OGC API - Features (Part 1: Core, GeoJSON), read-only. Each drawing layer is a collection. */
export async function ogcRoutes(app: FastifyInstance) {
  const root = (base: string) => `${base}/api/v1/ogc`;

  app.get('/ogc', async (req) => {
    const b = root(publicBase(req));
    return {
      title: 'AI Map drawings',
      description: 'Shared drawing layers of the offline map as OGC API - Features collections.',
      links: [
        { href: b, rel: 'self', type: 'application/json', title: 'This document' },
        { href: `${publicBase(req)}/api/v1/openapi.json`, rel: 'service-desc', type: 'application/vnd.oai.openapi+json;version=3.0', title: 'API definition' },
        { href: `${b}/conformance`, rel: 'conformance', type: 'application/json', title: 'Conformance' },
        { href: `${b}/collections`, rel: 'data', type: 'application/json', title: 'Collections' },
      ],
    };
  });

  app.get('/ogc/conformance', async () => ({
    conformsTo: [
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core',
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson',
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30',
    ],
  }));

  async function collection(base: string, layer: { id: string; name: string }) {
    const extent = await repo.layerExtent(layer.id);
    const b = `${root(base)}/collections/${layer.id}`;
    return {
      id: layer.id,
      title: layer.name,
      itemType: 'feature',
      crs: [CRS84],
      ...(extent ? { extent: { spatial: { bbox: [extent], crs: CRS84 } } } : {}),
      links: [
        { href: b, rel: 'self', type: 'application/json' },
        { href: `${b}/items`, rel: 'items', type: GEOJSON, title: 'Features' },
      ],
    };
  }

  app.get('/ogc/collections', async (req) => {
    const base = publicBase(req);
    const layers = await repo.listLayers();
    return {
      links: [{ href: `${root(base)}/collections`, rel: 'self', type: 'application/json' }],
      collections: await Promise.all(layers.map((l) => collection(base, l))),
    };
  });

  const CollectionParams = z.object({ collectionId: z.uuid() });

  app.get('/ogc/collections/:collectionId', async (req) => {
    const { collectionId } = parse(CollectionParams, req.params);
    const layer = await repo.getLayer(collectionId);
    if (!layer) throw new HttpError(404, 'Collection not found');
    return collection(publicBase(req), layer);
  });

  app.get('/ogc/collections/:collectionId/items', async (req, reply) => {
    const { collectionId } = parse(CollectionParams, req.params);
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(10000).default(100),
        offset: z.coerce.number().int().min(0).default(0),
        bbox: Bbox.optional(),
      }),
      req.query,
    );
    if (!(await repo.getLayer(collectionId))) throw new HttpError(404, 'Collection not found');
    const { features, total } = await repo.queryFeatures({ layerId: collectionId, ...q });
    const self = `${root(publicBase(req))}/collections/${collectionId}/items`;
    const link = (rel: string, offset: number) => {
      const p = new URLSearchParams({ limit: String(q.limit), offset: String(offset) });
      if (q.bbox) p.set('bbox', q.bbox.join(','));
      return { href: `${self}?${p}`, rel, type: GEOJSON };
    };
    const links = [link('self', q.offset)];
    if (q.offset + features.length < total) links.push(link('next', q.offset + q.limit));
    if (q.offset > 0) links.push(link('prev', Math.max(0, q.offset - q.limit)));
    return reply.type(GEOJSON).send({
      type: 'FeatureCollection',
      timeStamp: new Date().toISOString(),
      numberMatched: total,
      numberReturned: features.length,
      features: features.map(featureToGeoJSON),
      links,
    });
  });

  app.get('/ogc/collections/:collectionId/items/:featureId', async (req, reply) => {
    const { collectionId, featureId } = parse(CollectionParams.extend({ featureId: z.uuid() }), req.params);
    const f = await repo.getFeature(featureId);
    if (!f || f.layerId !== collectionId) throw new HttpError(404, 'Feature not found');
    const self = `${root(publicBase(req))}/collections/${collectionId}/items/${featureId}`;
    return reply.type(GEOJSON).send({ ...featureToGeoJSON(f), links: [{ href: self, rel: 'self', type: GEOJSON }] });
  });
}
