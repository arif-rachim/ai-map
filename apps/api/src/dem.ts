import sharp from 'sharp';
import { decodeTerrarium, type DemGrid } from '@ai-map/shared';
import type { Archive } from './archives.js';

/** Decodes terrain tiles (Terrarium webp) server-side with a small LRU cache. */
export class DemReader {
  private cache = new Map<string, Promise<DemGrid | null>>();
  constructor(
    private readonly archive: Archive,
    private readonly maxEntries = 256,
  ) {}

  getTile = (z: number, x: number, y: number): Promise<DemGrid | null> => {
    const key = `${z}/${x}/${y}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const p = this.load(z, x, y).catch(() => null);
    this.cache.set(key, p);
    if (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    return p;
  };

  private async load(z: number, x: number, y: number): Promise<DemGrid | null> {
    const tile = await this.archive.tile(z, x, y);
    if (!tile) return null;
    const { data, info } = await sharp(Buffer.from(tile.data)).raw().toBuffer({ resolveWithObject: true });
    return decodeTerrarium(data, info.width, info.height, info.channels);
  }

  async maxzoom(): Promise<number | null> {
    return (await this.archive.header())?.maxZoom ?? null;
  }
}
