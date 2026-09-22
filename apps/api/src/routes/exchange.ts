import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { featuresToGeoJSON, featuresToKML, geoJSONToFeatureInputs } from '@ai-map/shared';
import { Bbox, HttpError, IdParams, parse } from '../http.js';
import { broadcast } from '../hub.js';
import * as repo from '../repo.js';

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 80) || 'layer';

/** GeoJSON / KML export and GeoJSON import. */
export async function exchangeRoutes(app: FastifyInstance) {
  app.get('/features.geojson', async (req, reply) => {
    const q = parse(z.object({ layerId: z.uuid().optional(), bbox: Bbox.optional() }), req.query);
    const { features } = await repo.queryFeatures(q);
    return reply.type('application/geo+json').send(featuresToGeoJSON(features));
  });

  app.get('/layers/:id/export.:format', async (req, reply) => {
    const { id, format } = parse(IdParams.extend({ format: z.enum(['geojson', 'kml']) }), req.params);
    const layer = await repo.getLayer(id);
    if (!layer) throw new HttpError(404, 'Layer not found');
    const { features } = await repo.queryFeatures({ layerId: id });
    reply.header('Content-Disposition', `attachment; filename="${safeName(layer.name)}.${format}"`);
    if (format === 'kml') return reply.type('application/vnd.google-earth.kml+xml').send(featuresToKML(features, layer.name));
    return reply.type('application/geo+json').send(featuresToGeoJSON(features, layer));
  });

  app.post('/layers/:id/import', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { mode } = parse(z.object({ mode: z.enum(['append', 'replace']).default('append') }), req.query);
    if (!(await repo.getLayer(id))) throw new HttpError(404, 'Layer not found');
    const { inputs, errors } = geoJSONToFeatureInputs(req.body, id);
    if (inputs.length === 0 && errors.length > 0) return reply.code(400).send({ message: 'Nothing to import', created: 0, deleted: 0, errors });
    const { created, deletedIds } = await repo.importFeatures(id, inputs, mode === 'replace');
    for (const fid of deletedIds) broadcast({ type: 'feature.deleted', id: fid });
    for (const feature of created) broadcast({ type: 'feature.created', feature });
    return { created: created.length, deleted: deletedIds.length, errors, ids: created.map((f) => f.id) };
  });
}
