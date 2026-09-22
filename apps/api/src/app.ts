import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { openArchives } from './archives.js';
import { config } from './config.js';
import { DemReader } from './dem.js';
import { HttpError } from './http.js';
import { openApiDocument } from './openapi.js';
import type { AppContext } from './routes/context.js';
import { coreRoutes } from './routes/core.js';
import { exchangeRoutes } from './routes/exchange.js';
import { ogcRoutes } from './routes/ogc.js';
import { serviceRoutes } from './routes/services.js';
import { tileRoutes } from './routes/tiles.js';

export async function buildApp(opts: { logger?: boolean; dataDir?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 5 * 1024 * 1024, trustProxy: true });
  await app.register(websocket);

  app.addContentTypeParser('application/geo+json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(new HttpError(400, `Invalid JSON: ${(err as Error).message}`), undefined);
    }
  });

  const dataDir = opts.dataDir ?? config.dataDir;
  const archives = openArchives(dataDir);
  const ctx: AppContext = { dataDir, archives, dem: new DemReader(archives.terrain) };

  await app.register(swagger, { mode: 'static', specification: { document: openApiDocument as never } });
  await app.register(swaggerUi, { routePrefix: '/api/v1/docs' });
  app.get('/api/v1/openapi.json', async () => openApiDocument);

  await app.register(
    async (v1) => {
      await coreRoutes(v1, ctx);
      await tileRoutes(v1, ctx);
      await serviceRoutes(v1, ctx);
      await exchangeRoutes(v1);
      await ogcRoutes(v1);
    },
    { prefix: '/api/v1' },
  );
  return app;
}
