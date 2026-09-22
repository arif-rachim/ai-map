import { access } from 'node:fs/promises';
import path from 'node:path';
import type { DataCapabilities } from '@ai-map/shared';
import type { Archive, ArchiveName } from '../archives.js';
import { config } from '../config.js';
import type { DemReader } from '../dem.js';

export interface AppContext {
  dataDir: string;
  archives: Record<ArchiveName, Archive>;
  dem: DemReader;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function capabilities(ctx: AppContext): Promise<DataCapabilities> {
  const tiles = path.join(ctx.dataDir, 'tiles');
  const [geocoder, terrain, region, world] = await Promise.all([
    fetch(`${config.photonUrl}/status`, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.ok)
      .catch(() => false),
    ctx.archives.terrain.header().catch(() => null),
    exists(path.join(tiles, 'region.pmtiles')),
    exists(path.join(tiles, 'world.pmtiles')),
  ]);
  return {
    region,
    world,
    terrain: terrain !== null,
    terrainMaxzoom: terrain?.maxZoom ?? null,
    terrainBounds: terrain ? [terrain.minLon, terrain.minLat, terrain.maxLon, terrain.maxLat] : null,
    geocoder,
  };
}
