import { describe, expect, it } from 'vitest';
import { buildEmbedUrl, parseEmbedUrl, type EmbedUrlParams } from './embed';

describe('embed URL', () => {
  it('round-trips every parameter', () => {
    const params: EmbedUrlParams = {
      center: [46.67, 24.71],
      zoom: 10.5,
      bearing: 30,
      pitch: 45,
      theme: 'dark',
      lang: 'ar',
      ui: 'ar',
      layers: ['a', 'b'],
      controls: ['search', 'draw.point', '-status'],
      readonly: true,
      select: 'f1',
      hillshade: false,
      contours: true,
      terrain3d: true,
      unit: 'nm',
      coords: 'mgrs',
      interactive: false,
      minZoom: 4,
      maxZoom: 14,
      maxBounds: [34, 12, 60, 32],
    };
    const url = buildEmbedUrl('http://maps.local/', params);
    expect(url.startsWith('http://maps.local/embed?')).toBe(true);
    expect(parseEmbedUrl(new URL(url).search)).toEqual(params);
  });

  it('writes an empty control list as "none"', () => {
    const url = buildEmbedUrl('http://maps.local', { controls: [] });
    expect(new URL(url).searchParams.get('controls')).toBe('none');
  });

  it('ignores invalid values', () => {
    const p = parseEmbedUrl('?center=abc&zoom=x&theme=pink&readonly=0&unit=ft&coords=xyz&hillshade=maybe&maxBounds=10,10,5,5&minZoom=');
    expect(p.center).toBeUndefined();
    expect(p.zoom).toBeUndefined();
    expect(p.theme).toBeUndefined();
    expect(p.readonly).toBe(false);
    expect(p.unit).toBeUndefined();
    expect(p.coords).toBeUndefined();
    expect(p.hillshade).toBeUndefined();
    expect(p.maxBounds).toBeUndefined();
    expect(p.minZoom).toBeUndefined();
  });

  it('accepts common boolean spellings', () => {
    expect(parseEmbedUrl('?interactive=false&contours=yes&terrain3d=on').interactive).toBe(false);
    expect(parseEmbedUrl('?contours=yes').contours).toBe(true);
    expect(parseEmbedUrl('?terrain3d=on').terrain3d).toBe(true);
  });
});
