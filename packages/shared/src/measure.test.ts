import { describe, expect, it } from 'vitest';
import { distanceMeters, formatArea, formatDistance, lineSegments, polygonAreaM2, ring } from './measure';

describe('measure', () => {
  it('computes great-circle distance Riyadh (RUH) - Jeddah (JED)', () => {
    const m = distanceMeters([46.6988, 24.9576], [39.1565, 21.6796]);
    // Reference great-circle distance between OERK and OEJN ≈ 850 km.
    expect(m / 1000).toBeGreaterThan(840);
    expect(m / 1000).toBeLessThan(860);
  });

  it('formats distances in units', () => {
    expect(formatDistance(500, 'km')).toBe('500 m');
    expect(formatDistance(1852 * 12.5, 'nm')).toBe('12.5 NM');
    expect(formatDistance(1_000_000, 'km')).toBe('1000 km');
  });

  it('sums segments', () => {
    const segs = lineSegments([
      [55, 25],
      [55, 26],
      [56, 26],
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.bearing).toBeCloseTo(0, 5);
    expect(segs[1]!.bearing).toBeGreaterThan(80);
  });

  it('computes area and ring radius', () => {
    const c = ring([50, 25], 10_000);
    const expected = Math.PI * 10_000 ** 2;
    expect(Math.abs(polygonAreaM2(c) - expected) / expected).toBeLessThan(0.01);
    expect(formatArea(expected, 'km')).toBe('314.2 km²');
  });
});
