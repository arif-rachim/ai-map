// Builds the full-detail region polygon from Natural Earth country boundaries.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import * as turf from '@turf/turf';

const countries = (process.env.REGION_COUNTRIES ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
const bufferKm = Number(process.env.REGION_BUFFER_KM ?? 25);
const workDir = process.env.WORK_DIR;
const outDir = process.env.OUT_DIR;
if (!countries.length || !workDir || !outDir) throw new Error('REGION_COUNTRIES, WORK_DIR and OUT_DIR are required');

const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const nePath = path.join(workDir, 'ne_50m_admin_0_countries.geojson');

try {
  await access(nePath);
} catch {
  console.log(`downloading ${NE_URL}`);
  const res = await fetch(NE_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await writeFile(nePath, Buffer.from(await res.arrayBuffer()));
}

const ne = JSON.parse(await readFile(nePath, 'utf8'));
const code = (f) => {
  const p = f.properties;
  return [p.ISO_A2_EH, p.ISO_A2, p.WB_A2].find((c) => c && c !== '-99');
};
const selected = ne.features.filter((f) => countries.includes(code(f)));
const found = new Set(selected.map(code));
const missing = countries.filter((c) => !found.has(c));
if (missing.length) throw new Error(`countries not found in Natural Earth: ${missing.join(', ')}`);

let merged = null;
for (const f of selected) {
  const buffered = turf.buffer(f, bufferKm, { units: 'kilometers' });
  merged = merged ? turf.union(turf.featureCollection([merged, buffered])) : buffered;
}
const simplified = turf.simplify(merged, { tolerance: 0.02, highQuality: false, mutate: true });
simplified.properties = { countries: countries.join(','), bufferKm };

const region = turf.featureCollection([simplified]);
await writeFile(path.join(workDir, 'region.geojson'), JSON.stringify(region));
await mkdir(path.join(outDir, 'meta'), { recursive: true });
await writeFile(path.join(outDir, 'meta', 'region.geojson'), JSON.stringify(region));

const areaKm2 = Math.round(turf.area(simplified) / 1e6);
const vertices = turf.coordAll(simplified).length;
console.log(`region polygon: ${countries.length} countries, ${areaKm2.toLocaleString()} km², ${vertices} vertices`);
