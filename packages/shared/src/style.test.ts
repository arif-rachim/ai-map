import { describe, expect, it } from 'vitest';
import { buildBasemapStyle, isBasemapLayerId, type BasemapStyleOptions } from './style';

const base: BasemapStyleOptions = {
  theme: 'light',
  glyphs: 'http://h/fonts/{fontstack}/{range}.pbf',
  sprite: 'http://h/sprites/v4',
  world: { url: 'http://h/world.json' },
  region: { url: 'http://h/region.json' },
  terrainOptions: { hillshade: true, contours: true, terrain3d: false },
};

describe('buildBasemapStyle', () => {
  it('stacks world under region and keeps a single background', () => {
    const s = buildBasemapStyle(base);
    const ids = s.layers.map((l) => l.id);
    expect(ids.filter((id) => id.endsWith(':background'))).toEqual(['world:background']);
    const lastWorld = ids.map((id) => id.startsWith('world:')).lastIndexOf(true);
    const firstRegion = ids.findIndex((id) => id.startsWith('region:'));
    expect(lastWorld).toBeLessThan(firstRegion);
    expect(s.sprite).toBe('http://h/sprites/v4/light');
    expect(ids.every(isBasemapLayerId)).toBe(true);
    expect(s.terrain).toBeUndefined();
  });

  it('places hillshade above region fills and below region lines; contours only with a tile URL', () => {
    const s = buildBasemapStyle({ ...base, terrain: { url: 'http://h/terrain.json', maxzoom: 12 }, contoursTileUrl: 'contour://{z}/{x}/{y}' });
    const ids = s.layers.map((l) => l.id);
    const hill = ids.indexOf('terrain:hillshade');
    const firstRegionLine = s.layers.findIndex((l) => l.id.startsWith('region:') && (l.type === 'line' || l.type === 'symbol'));
    expect(hill).toBeGreaterThan(ids.findIndex((id) => id.startsWith('region:')));
    expect(hill).toBeLessThan(firstRegionLine);
    expect(ids.at(-1)).toBe('terrain:contour-labels');
    expect(s.sources['terrain-dem']).toMatchObject({ type: 'raster-dem', url: 'http://h/terrain.json', encoding: 'terrarium' });

    const noContours = buildBasemapStyle({ ...base, terrain: { url: 'http://h/terrain.json', maxzoom: 12 } });
    expect(noContours.sources.contours).toBeUndefined();
    expect(noContours.layers.some((l) => l.id.startsWith('terrain:contour'))).toBe(false);
  });

  it('reflects terrain options in visibility and 3D terrain', () => {
    const s = buildBasemapStyle({
      ...base,
      theme: 'dark',
      terrain: { tiles: ['http://h/t/{z}/{x}/{y}'], maxzoom: 12, bounds: [1, 2, 3, 4] },
      terrainOptions: { hillshade: false, contours: false, terrain3d: true },
    });
    expect(s.layers.find((l) => l.id === 'terrain:hillshade')!.layout).toEqual({ visibility: 'none' });
    expect(s.terrain).toEqual({ source: 'terrain-3d', exaggeration: 1.5 });
    expect(s.sources['terrain-3d']).toMatchObject({ tiles: ['http://h/t/{z}/{x}/{y}'], maxzoom: 12, bounds: [1, 2, 3, 4] });
    expect((s.sources['terrain-3d'] as { attribution?: string }).attribution).toBeUndefined();
  });

  it('falls back to a plain background without tiles', () => {
    const s = buildBasemapStyle({ ...base, world: undefined, region: undefined });
    expect(s.layers.map((l) => l.id)).toEqual(['background']);
  });
});
