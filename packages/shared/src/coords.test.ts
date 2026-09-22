import { describe, expect, it } from 'vitest';
import { formatCoordinates, parseCoordinates } from './coords';

const close = (a: number, b: number, eps = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('parseCoordinates', () => {
  it('parses decimal lat,lon', () => {
    const p = parseCoordinates('25.2048, 55.2708')!;
    close(p.lat, 25.2048);
    close(p.lon, 55.2708);
    expect(parseCoordinates('-33.9 18.4')).toEqual({ lat: -33.9, lon: 18.4 });
  });

  it('rejects out-of-range decimals', () => {
    expect(parseCoordinates('95, 10')).toBeNull();
    expect(parseCoordinates('dubai')).toBeNull();
  });

  it('parses DMS with hemispheres in either order', () => {
    const a = parseCoordinates(`25°12'17.3"N 55°16'14.9"E`)!;
    close(a.lat, 25.204806, 1e-5);
    close(a.lon, 55.270806, 1e-5);
    const b = parseCoordinates(`55 16 14.9 E, 25 12 17.3 N`)!;
    close(b.lat, a.lat, 1e-9);
    close(b.lon, a.lon, 1e-9);
    const w = parseCoordinates(`33°35'N 7°37'W`)!;
    expect(w.lon).toBeLessThan(0);
  });

  it('round-trips MGRS and UTM', () => {
    const riyadh = { lat: 24.7136, lon: 46.6753 };
    for (const fmt of ['mgrs', 'utm'] as const) {
      const text = formatCoordinates(riyadh, fmt);
      const back = parseCoordinates(text)!;
      expect(back, `${fmt}: ${text}`).not.toBeNull();
      close(back.lat, riyadh.lat, 1e-4);
      close(back.lon, riyadh.lon, 1e-4);
    }
  });

  it('treats UTM band S as northern hemisphere (Turkey/Tunisia)', () => {
    const ankara = { lat: 39.9334, lon: 32.8597 };
    const text = formatCoordinates(ankara, 'utm');
    expect(text).toMatch(/^36S /);
    const back = parseCoordinates(text)!;
    close(back.lat, ankara.lat, 1e-4);
  });
});

describe('formatCoordinates', () => {
  it('formats DMS', () => {
    expect(formatCoordinates({ lat: 25.5, lon: -0.25 }, 'dms')).toBe(`25°30'00.0"N 0°15'00.0"W`);
  });
  it('formats MGRS with grouping', () => {
    expect(formatCoordinates({ lat: 24.7136, lon: 46.6753 }, 'mgrs')).toMatch(/^38R [A-Z]{2} \d{5} \d{5}$/);
  });
});
