import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildBasemapStyle, TERRAIN_ATTRIBUTION, BASEMAP_ATTRIBUTION } from '@ai-map/shared';
import { ARCHIVE_NAMES, TILE_CONTENT_TYPES, TILE_EXTENSIONS, type ArchiveName } from '../archives.js';
import { HttpError, parse, publicBase } from '../http.js';
import type { AppContext } from './context.js';

const Name = z.enum(ARCHIVE_NAMES);
const TileParams = z.object({
  name: Name,
  z: z.coerce.number().int().min(0).max(22),
  x: z.coerce.number().int().min(0),
  // Optional extension (.mvt / .pbf / .webp) is accepted and ignored.
  y: z
    .string()
    .regex(/^\d+(\.[a-z]+)?$/)
    .transform((s) => Number.parseInt(s, 10)),
});

/** Vector/terrain tiles as XYZ + TileJSON, and ready-to-use MapLibre style documents. */
export async function tileRoutes(app: FastifyInstance, ctx: AppContext) {
  async function tileJson(name: ArchiveName, base: string) {
    const archive = ctx.archives[name];
    const h = await archive.header();
    if (!h) return null;
    const meta = await archive.metadata().catch(() => ({}) as Record<string, unknown>);
    const ext = TILE_EXTENSIONS[h.tileType] ?? 'bin';
    return {
      tilejson: '3.0.0',
      name,
      scheme: 'xyz',
      tiles: [`${base}/api/v1/tiles/${name}/{z}/{x}/{y}.${ext}`],
      minzoom: h.minZoom,
      maxzoom: h.maxZoom,
      bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
      center: [h.centerLon, h.centerLat, h.centerZoom],
      attribution: name === 'terrain' ? TERRAIN_ATTRIBUTION : BASEMAP_ATTRIBUTION,
      ...(name === 'terrain' ? { encoding: 'terrarium', tileSize: 512 } : { vector_layers: meta.vector_layers ?? [] }),
    };
  }

  app.get('/tiles', async (req) => {
    const base = publicBase(req);
    const out = [];
    for (const name of ARCHIVE_NAMES) {
      const tj = await tileJson(name, base);
      if (tj) out.push({ name, tilejson: `${base}/api/v1/tiles/${name}.json`, minzoom: tj.minzoom, maxzoom: tj.maxzoom, bounds: tj.bounds });
    }
    return out;
  });

  app.get('/tiles/:name.json', async (req) => {
    const { name } = parse(z.object({ name: Name }), req.params);
    const tj = await tileJson(name, publicBase(req));
    if (!tj) throw new HttpError(404, `Tileset ${name} is not installed`);
    return tj;
  });

  app.get('/tiles/:name/:z/:x/:y', async (req, reply) => {
    const p = parse(TileParams, req.params);
    const tile = await ctx.archives[p.name].tile(p.z, p.x, p.y);
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.header('Access-Control-Allow-Origin', '*');
    // No data (outside the extract): empty 204 so clients treat it as a missing tile.
    if (!tile) return reply.code(204).send();
    return reply.type(TILE_CONTENT_TYPES[tile.tileType] ?? 'application/octet-stream').send(Buffer.from(tile.data));
  });

  app.get('/styles/:theme.json', async (req, reply) => {
    const { theme } = parse(z.object({ theme: z.enum(['light', 'dark']) }), req.params);
    const q = parse(
      z.object({ lang: z.enum(['en', 'ar']).default('en'), terrain: z.enum(['none', 'hillshade', '3d']).default('hillshade') }),
      req.query,
    );
    const base = publicBase(req);
    const [world, region, terrain] = await Promise.all(ARCHIVE_NAMES.map((n) => ctx.archives[n].header()));
    const style = buildBasemapStyle({
      theme,
      lang: q.lang,
      glyphs: `${base}/data/assets/fonts/{fontstack}/{range}.pbf`,
      sprite: `${base}/data/assets/sprites/v4`,
      world: world ? { url: `${base}/api/v1/tiles/world.json` } : undefined,
      region: region ? { url: `${base}/api/v1/tiles/region.json` } : undefined,
      terrain: terrain && q.terrain !== 'none' ? { url: `${base}/api/v1/tiles/terrain.json`, maxzoom: terrain.maxZoom } : undefined,
      terrainOptions: { hillshade: q.terrain !== 'none', contours: false, terrain3d: q.terrain === '3d' },
    });
    reply.header('Access-Control-Allow-Origin', '*');
    return { ...style, name: `AI Map ${theme} (${q.lang})` };
  });
}
