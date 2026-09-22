import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { parse } from 'csv-parse';
import type { Airport } from '@ai-map/shared';
import { pool } from './db.js';

const SKIP_TYPES = new Set(['closed', 'balloonport']);

/** Imports OurAirports airports.csv into the airports table when the table is empty. */
export async function importAirportsIfEmpty(csvPath: string, log: (msg: string) => void): Promise<void> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM airports');
  if (Number(rows[0]!.n) > 0) return;
  try {
    await access(csvPath);
  } catch {
    log(`airports: ${csvPath} not found, skipping import`);
    return;
  }
  const count = await importAirports(csvPath);
  log(`airports: imported ${count} rows`);
}

export async function importAirports(csvPath: string): Promise<number> {
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE airports');
    const parser = createReadStream(csvPath).pipe(parse({ columns: true, skip_empty_lines: true }));
    let batch: unknown[][] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      // 7 text columns + lon/lat -> 9 params per row
      const params: unknown[] = [];
      const tuples = batch.map((r, i) => {
        params.push(...r);
        const o = i * 9;
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},ST_SetSRID(ST_MakePoint($${o + 8}::float8,$${o + 9}::float8),4326))`;
      });
      await client.query(
        `INSERT INTO airports(ident, iata, icao, name, type, country, municipality, geom) VALUES ${tuples.join(',')}
         ON CONFLICT (ident) DO NOTHING`,
        params,
      );
      count += batch.length;
      batch = [];
    };
    for await (const r of parser as AsyncIterable<Record<string, string>>) {
      if (SKIP_TYPES.has(r.type ?? '')) continue;
      const lat = Number(r.latitude_deg);
      const lon = Number(r.longitude_deg);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const icao = r.icao_code || (/^[A-Z]{4}$/.test(r.gps_code ?? '') ? r.gps_code : '') || null;
      batch.push([r.ident, r.iata_code || null, icao, r.name, r.type, r.iso_country, r.municipality || null, lon, lat]);
      if (batch.length >= 500) await flush();
    }
    await flush();
    await client.query('COMMIT');
    return count;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const TYPE_RANK = `CASE type WHEN 'large_airport' THEN 0 WHEN 'medium_airport' THEN 1 WHEN 'small_airport' THEN 2 ELSE 3 END`;

export async function searchAirports(q: string, limit = 10): Promise<Airport[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const upper = term.toUpperCase();
  const { rows } = await pool.query<Airport>(
    `SELECT ident, iata, icao, name, type, country, municipality, ST_X(geom) AS lon, ST_Y(geom) AS lat
     FROM airports
     WHERE iata = $1 OR icao = $1 OR ident = $1 OR name ILIKE $2 OR municipality ILIKE $2
        OR similarity(name, $3) > 0.35
     ORDER BY (coalesce(iata = $1, false) OR coalesce(icao = $1, false) OR ident = $1) DESC, ${TYPE_RANK},
       greatest(similarity(name, $3), similarity(coalesce(municipality, ''), $3)) DESC
     LIMIT $4`,
    [upper, `%${term.replace(/[%_\\]/g, '\\$&')}%`, term, limit],
  );
  return rows;
}

export async function airportByCode(code: string): Promise<Airport | null> {
  const c = code.trim().toUpperCase();
  const { rows } = await pool.query<Airport>(
    `SELECT ident, iata, icao, name, type, country, municipality, ST_X(geom) AS lon, ST_Y(geom) AS lat
     FROM airports WHERE iata = $1 OR icao = $1 OR ident = $1
     ORDER BY (icao = $1) DESC NULLS LAST, (iata = $1) DESC NULLS LAST, ${TYPE_RANK} LIMIT 1`,
    [c],
  );
  return rows[0] ?? null;
}
