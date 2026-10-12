import type { FastifyInstance } from 'fastify';
import type { Position } from 'geojson';
import { z } from 'zod';
import { elevationAt, elevationProfile, greatCirclePath, parseCoordinates, type SearchResultItem } from '@ai-map/shared';
import { searchAirports } from '../airports.js';
import { config } from '../config.js';
import { HttpError, parse } from '../http.js';
import type { AppContext } from './context.js';

const Lon = z.coerce.number().min(-180).max(180);
const Lat = z.coerce.number().min(-90).max(90);
const Position2 = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, unknown> & { extent?: number[] };
}

/** OSM often has the same place as node + way/relation; keep the first of same name & kind within ~1 km. */
export function dedupePlaces(items: SearchResultItem[]): SearchResultItem[] {
  const kept: SearchResultItem[] = [];
  for (const it of items) {
    const kind = it.detail.split(',')[0];
    const dup = kept.some(
      (k) => k.name === it.name && k.detail.split(',')[0] === kind && Math.abs(k.lat - it.lat) < 0.01 && Math.abs(k.lon - it.lon) < 0.01 / Math.cos((it.lat * Math.PI) / 180),
    );
    if (!dup) kept.push(it);
  }
  return kept;
}

async function photonSearch(q: string, lang: string, limit: number): Promise<SearchResultItem[]> {
  // Ask for extra results so de-duplication still fills the requested limit.
  const res = await fetch(`${config.photonUrl}/api?${new URLSearchParams({ q, lang, limit: String(Math.min(50, limit * 2)) })}`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return [];
  const data = (await res.json()) as { features: PhotonFeature[] };
  const items = data.features.map((f): SearchResultItem => {
    const p = f.properties;
    const detail = [p.osm_value, p.city, p.state, p.country].filter((x) => typeof x === 'string' && x !== p.name);
    const e = p.extent;
    return {
      type: 'place',
      name: String(p.name ?? p.street ?? ''),
      detail: [...new Set(detail)].join(', '),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      ...(e?.length === 4 ? { bbox: [e[0]!, e[3]!, e[2]!, e[1]!] as [number, number, number, number] } : {}),
    };
  });
  return dedupePlaces(items).slice(0, limit);
}

/** Search (coordinates, airports, places) and elevation. */
export async function serviceRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/search', async (req) => {
    const q = parse(
      z.object({
        q: z.string().min(1).max(200),
        lang: z.enum(['en', 'ar']).default('en'),
        limit: z.coerce.number().int().min(1).max(50).default(10),
        types: z
          .string()
          .default('coordinates,airport,place')
          .transform((s) => new Set(s.split(','))),
      }),
      req.query,
    );
    const out: SearchResultItem[] = [];
    const coord = q.types.has('coordinates') ? parseCoordinates(q.q) : null;
    if (coord) out.push({ type: 'coordinates', name: `${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}`, detail: '', lon: coord.lon, lat: coord.lat });
    if (!coord && q.q.trim().length >= 2) {
      const [airports, places] = await Promise.all([
        q.types.has('airport') ? searchAirports(q.q, Math.min(5, q.limit)) : [],
        q.types.has('place') ? photonSearch(q.q, 'en', q.limit) : [],
      ]);
      const airportItems: SearchResultItem[] = airports.map((a) => ({
        type: 'airport',
        name: a.name,
        detail: [a.iata, a.icao, a.municipality, a.country].filter(Boolean).join(' · '),
        lon: a.lon,
        lat: a.lat,
      }));
      // An exact IATA/ICAO code means the user wants the airport; otherwise places (cities, addresses) lead.
      const code = q.q.trim().toUpperCase();
      const exactCode = airports.some((a) => a.iata === code || a.icao === code);
      out.push(...(exactCode ? [...airportItems, ...places] : [...places, ...airportItems]));
    }
    return out.slice(0, q.limit);
  });

  async function maxzoom(): Promise<number> {
    const z = await ctx.dem.maxzoom();
    if (z === null) throw new HttpError(503, 'Terrain data is not installed');
    return z;
  }

  app.get('/elevation', async (req) => {
    const q = parse(z.object({ lon: Lon, lat: Lat }), req.query);
    const zoom = await maxzoom();
    return { lon: q.lon, lat: q.lat, elevation: await elevationAt(ctx.dem.getTile, q.lon, q.lat, zoom) };
  });

  app.post('/elevation', async (req) => {
    const body = parse(z.object({ points: z.array(Position2).min(1).max(1000) }), req.body);
    const zoom = await maxzoom();
    return Promise.all(body.points.map(async ([lon, lat]) => ({ lon, lat, elevation: await elevationAt(ctx.dem.getTile, lon, lat, zoom) })));
  });

  app.post('/elevation/profile', async (req) => {
    const body = parse(
      z.object({
        coordinates: z.array(Position2).min(2).max(5000),
        samples: z.number().int().min(2).max(2000).default(200),
        greatCircle: z.boolean().default(true),
      }),
      req.body,
    );
    const zoom = await maxzoom();
    const path: Position[] = body.greatCircle ? greatCirclePath(body.coordinates).geometry.coordinates : body.coordinates;
    return elevationProfile(path, ctx.dem.getTile, zoom, body.samples);
  });
}
