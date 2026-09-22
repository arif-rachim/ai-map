import type { FeatureInput, MapFeature, MapLayer } from '@ai-map/shared';
import type pg from 'pg';
import { pool } from './db.js';

type Db = pg.Pool | pg.PoolClient;

const FEATURE_COLUMNS = `
  id, layer_id, kind, ST_AsGeoJSON(geom)::json AS geometry, name, description, style,
  radius_m, CASE WHEN center IS NULL THEN NULL ELSE json_build_array(ST_X(center), ST_Y(center)) END AS center,
  sidc, version, created_at, updated_at`;

interface FeatureRow {
  id: string;
  layer_id: string;
  kind: MapFeature['kind'];
  geometry: MapFeature['geometry'];
  name: string;
  description: string;
  style: MapFeature['style'];
  radius_m: number | null;
  center: [number, number] | null;
  sidc: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function toFeature(r: FeatureRow): MapFeature {
  return {
    id: r.id,
    layerId: r.layer_id,
    kind: r.kind,
    geometry: r.geometry,
    name: r.name,
    description: r.description,
    style: r.style,
    radiusM: r.radius_m,
    center: r.center,
    sidc: r.sidc,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

interface LayerRow {
  id: string;
  name: string;
  visible: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

function toLayer(r: LayerRow): MapLayer {
  return {
    id: r.id,
    name: r.name,
    visible: r.visible,
    sortOrder: r.sort_order,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listLayers(db: Db = pool): Promise<MapLayer[]> {
  const { rows } = await db.query<LayerRow>('SELECT * FROM layers ORDER BY sort_order, created_at');
  return rows.map(toLayer);
}

export async function createLayer(input: { name: string; visible: boolean; sortOrder: number }, db: Db = pool) {
  const { rows } = await db.query<LayerRow>(
    'INSERT INTO layers(name, visible, sort_order) VALUES ($1, $2, $3) RETURNING *',
    [input.name, input.visible, input.sortOrder],
  );
  return toLayer(rows[0]!);
}

export async function updateLayer(
  id: string,
  patch: { name?: string; visible?: boolean; sortOrder?: number },
  db: Db = pool,
): Promise<MapLayer | null> {
  const { rows } = await db.query<LayerRow>(
    `UPDATE layers SET name = COALESCE($2, name), visible = COALESCE($3, visible),
       sort_order = COALESCE($4, sort_order), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, patch.name ?? null, patch.visible ?? null, patch.sortOrder ?? null],
  );
  return rows[0] ? toLayer(rows[0]) : null;
}

export async function deleteLayer(id: string, db: Db = pool): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM layers WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function listFeatures(layerId?: string, db: Db = pool): Promise<MapFeature[]> {
  const { rows } = layerId
    ? await db.query<FeatureRow>(`SELECT ${FEATURE_COLUMNS} FROM features WHERE layer_id = $1 ORDER BY created_at`, [layerId])
    : await db.query<FeatureRow>(`SELECT ${FEATURE_COLUMNS} FROM features ORDER BY created_at`);
  return rows.map(toFeature);
}

export async function getFeature(id: string, db: Db = pool): Promise<MapFeature | null> {
  const { rows } = await db.query<FeatureRow>(`SELECT ${FEATURE_COLUMNS} FROM features WHERE id = $1`, [id]);
  return rows[0] ? toFeature(rows[0]) : null;
}

function featureParams(f: FeatureInput) {
  return [
    f.layerId,
    f.kind,
    JSON.stringify(f.geometry),
    f.name,
    f.description,
    JSON.stringify(f.style),
    f.radiusM,
    f.center ? f.center[0] : null,
    f.center ? f.center[1] : null,
    f.sidc,
  ];
}

export async function createFeature(f: FeatureInput, db: Db = pool): Promise<MapFeature> {
  const { rows } = await db.query<FeatureRow>(
    `INSERT INTO features(layer_id, kind, geom, name, description, style, radius_m, center, sidc)
     VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6, $7,
       CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($8, $9), 4326) END, $10)
     RETURNING ${FEATURE_COLUMNS}`,
    featureParams(f),
  );
  return toFeature(rows[0]!);
}

/** Replaces all fields if `expectedVersion` matches; returns null on version conflict. */
export async function updateFeature(
  id: string,
  f: FeatureInput,
  expectedVersion: number,
  db: Db = pool,
): Promise<MapFeature | null> {
  const { rows } = await db.query<FeatureRow>(
    `UPDATE features SET layer_id = $1, kind = $2, geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
       name = $4, description = $5, style = $6, radius_m = $7,
       center = CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($8, $9), 4326) END,
       sidc = $10, version = version + 1, updated_at = now()
     WHERE id = $11 AND version = $12
     RETURNING ${FEATURE_COLUMNS}`,
    [...featureParams(f), id, expectedVersion],
  );
  return rows[0] ? toFeature(rows[0]) : null;
}

export async function deleteFeature(id: string, db: Db = pool): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM features WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function getLayer(id: string, db: Db = pool): Promise<MapLayer | null> {
  const { rows } = await db.query<LayerRow>('SELECT * FROM layers WHERE id = $1', [id]);
  return rows[0] ? toLayer(rows[0]) : null;
}

export interface FeatureQuery {
  layerId?: string;
  /** minLon, minLat, maxLon, maxLat */
  bbox?: [number, number, number, number];
  limit?: number;
  offset?: number;
}

/** Filtered, paged listing; `total` is the number of matches before paging. */
export async function queryFeatures(q: FeatureQuery, db: Db = pool): Promise<{ features: MapFeature[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.layerId) {
    params.push(q.layerId);
    where.push(`layer_id = $${params.length}`);
  }
  if (q.bbox) {
    params.push(...q.bbox);
    const n = params.length;
    where.push(`geom && ST_MakeEnvelope($${n - 3}, $${n - 2}, $${n - 1}, $${n}, 4326)`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM features ${clause}`, params)).rows[0]!.n);
  const paging: unknown[] = [];
  let sql = `SELECT ${FEATURE_COLUMNS} FROM features ${clause} ORDER BY created_at, id`;
  if (q.limit !== undefined) {
    paging.push(q.limit);
    sql += ` LIMIT $${params.length + paging.length}`;
  }
  if (q.offset) {
    paging.push(q.offset);
    sql += ` OFFSET $${params.length + paging.length}`;
  }
  const { rows } = await db.query<FeatureRow>(sql, [...params, ...paging]);
  return { features: rows.map(toFeature), total };
}

export async function layerExtent(id: string, db: Db = pool): Promise<[number, number, number, number] | null> {
  const { rows } = await db.query<{ minx: number | null; miny: number; maxx: number; maxy: number }>(
    `SELECT ST_XMin(e) AS minx, ST_YMin(e) AS miny, ST_XMax(e) AS maxx, ST_YMax(e) AS maxy
     FROM (SELECT ST_Extent(geom) AS e FROM features WHERE layer_id = $1) s`,
    [id],
  );
  const r = rows[0];
  return r && r.minx !== null ? [r.minx, r.miny, r.maxx, r.maxy] : null;
}

/** Inserts many features atomically; optionally clears the layer first. Returns created and deleted ids. */
export async function importFeatures(
  layerId: string,
  inputs: FeatureInput[],
  replace: boolean,
): Promise<{ created: MapFeature[]; deletedIds: string[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deletedIds = replace
      ? (await client.query<{ id: string }>('DELETE FROM features WHERE layer_id = $1 RETURNING id', [layerId])).rows.map((r) => r.id)
      : [];
    const created: MapFeature[] = [];
    for (const input of inputs) created.push(await createFeature(input, client));
    await client.query('COMMIT');
    return { created, deletedIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
