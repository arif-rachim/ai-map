import { describe, expect, it } from 'vitest';
import { decodeTerrarium, elevationAt, elevationProfile, sampleGrid, tileCoord, type DemGrid } from './elevation';

/** Terrarium-encode an elevation into RGB. */
function encode(meters: number): [number, number, number] {
  const v = meters + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - Math.floor(v)) * 256);
  return [r, g, b];
}

describe('elevation sampling', () => {
  it('decodes Terrarium RGB and RGBA', () => {
    const rgb = new Uint8Array([...encode(0), ...encode(1234.5), ...encode(-12)]);
    expect([...decodeTerrarium(rgb, 3, 1, 3).data]).toEqual([0, 1234.5, -12]);
    const rgba = new Uint8Array([...encode(8848), 255]);
    expect(decodeTerrarium(rgba, 1, 1, 4).data[0]).toBe(8848);
  });

  it('computes tile coordinates', () => {
    expect(tileCoord(0, 0, 1)).toEqual({ tx: 1, ty: 1, fx: 0, fy: 0 });
    const c = tileCoord(-180, 85.0511, 3);
    expect(c.tx).toBe(0);
    expect(c.ty).toBe(0);
    // Right edge stays inside the last tile.
    expect(tileCoord(180, 0, 2).tx).toBe(3);
  });

  it('samples bilinearly', () => {
    const grid: DemGrid = { width: 2, height: 2, data: new Float32Array([0, 100, 200, 300]) };
    expect(sampleGrid(grid, 0.5, 0.5)).toBeCloseTo(150);
    expect(sampleGrid(grid, 0, 0)).toBeCloseTo(0);
    expect(sampleGrid(grid, 1, 1)).toBeCloseTo(300, 0);
    expect(sampleGrid({ width: 2, height: 2, data: new Float32Array([NaN, 0, 0, 0]) }, 0, 0)).toBeNull();
  });

  it('builds profiles with ascent, descent and gaps', async () => {
    // Elevation grows with longitude: 10 m per 0.01°, missing data west of 0.
    const getTile = async (z: number, x: number, y: number) => {
      const size = 256;
      const n = 2 ** z;
      const data = new Float32Array(size * size);
      for (let px = 0; px < size; px++) {
        const lon = ((x + (px + 0.5) / size) / n) * 360 - 180;
        for (let py = 0; py < size; py++) data[py * size + px] = lon < 0 ? NaN : lon * 1000;
      }
      void y;
      return { width: size, height: size, data };
    };
    const profile = await elevationProfile([[-0.05, 0], [0.1, 0]], getTile, 12, 31, 256);
    expect(profile.points).toHaveLength(31);
    expect(profile.points[0]!.elevation).toBeNull();
    expect(profile.max!).toBeGreaterThan(95);
    expect(profile.min!).toBeLessThan(10);
    expect(profile.ascentM).toBeGreaterThan(90);
    expect(profile.descentM).toBeLessThan(1);
    expect(await elevationAt(async () => null, 10, 10, 5)).toBeNull();
  });
});
