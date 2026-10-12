import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FeatureInput, FeaturePatch, LayerInput, LayerPatch } from '@ai-map/shared';
import { searchAirports, airportByCode } from '../airports.js';
import { Bbox, HttpError, IdParams, parse } from '../http.js';
import { addClient, broadcast } from '../hub.js';
import * as repo from '../repo.js';
import { capabilities, type AppContext } from './context.js';

/** Capabilities, layers, features (CRUD, writes for admins only), airports and the real-time event stream. */
export async function coreRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Writes need an admin token (see auth.ts). */
  const admin = { preHandler: ctx.auth.requireAdmin };
  app.get('/health', async () => ({ ok: true }));
  app.get('/capabilities', async () => capabilities(ctx));

  app.get('/airports/search', async (req) => {
    const { q, limit } = parse(z.object({ q: z.string().max(100), limit: z.coerce.number().int().min(1).max(50).default(10) }), req.query);
    return searchAirports(q, limit);
  });

  app.get('/airports/:code', async (req) => {
    const { code } = parse(z.object({ code: z.string().min(3).max(8) }), req.params);
    const airport = await airportByCode(code);
    if (!airport) throw new HttpError(404, 'Airport not found');
    return airport;
  });

  app.get('/layers', async () => repo.listLayers());

  app.get('/layers/:id', async (req) => {
    const layer = await repo.getLayer(parse(IdParams, req.params).id);
    if (!layer) throw new HttpError(404, 'Layer not found');
    return layer;
  });

  app.post('/layers', admin, async (req, reply) => {
    const layer = await repo.createLayer(parse(LayerInput, req.body));
    broadcast({ type: 'layer.created', layer });
    return reply.code(201).send(layer);
  });

  app.patch('/layers/:id', admin, async (req) => {
    const layer = await repo.updateLayer(parse(IdParams, req.params).id, parse(LayerPatch, req.body));
    if (!layer) throw new HttpError(404, 'Layer not found');
    broadcast({ type: 'layer.updated', layer });
    return layer;
  });

  app.delete('/layers/:id', admin, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    if (!(await repo.deleteLayer(id))) throw new HttpError(404, 'Layer not found');
    broadcast({ type: 'layer.deleted', id });
    return reply.code(204).send();
  });

  app.get('/features', async (req) => {
    const q = parse(
      z.object({
        layerId: z.uuid().optional(),
        bbox: Bbox.optional(),
        limit: z.coerce.number().int().min(1).max(10000).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
      req.query,
    );
    return (await repo.queryFeatures(q)).features;
  });

  app.get('/features/:id', async (req) => {
    const feature = await repo.getFeature(parse(IdParams, req.params).id);
    if (!feature) throw new HttpError(404, 'Feature not found');
    return feature;
  });

  app.post('/features', admin, async (req, reply) => {
    const feature = await repo.createFeature(parse(FeatureInput, req.body));
    broadcast({ type: 'feature.created', feature });
    return reply.code(201).send(feature);
  });

  app.patch('/features/:id', admin, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { version, ...patch } = parse(FeaturePatch, req.body);
    const current = await repo.getFeature(id);
    if (!current) throw new HttpError(404, 'Feature not found');
    const merged = parse(FeatureInput, { ...current, ...patch });
    const feature = await repo.updateFeature(id, merged, version);
    if (!feature) {
      return reply.code(409).send({ message: 'Feature was modified by another user', current: await repo.getFeature(id) });
    }
    broadcast({ type: 'feature.updated', feature });
    return feature;
  });

  app.delete('/features/:id', admin, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    if (!(await repo.deleteFeature(id))) throw new HttpError(404, 'Feature not found');
    broadcast({ type: 'feature.deleted', id });
    return reply.code(204).send();
  });

  app.get('/events', { websocket: true }, (socket) => addClient(socket));
}
