import * as mgrs from 'mgrs';
import proj4 from 'proj4';

export type CoordFormat = 'dd' | 'dms' | 'mgrs' | 'utm';

export interface LonLat {
  lon: number;
  lat: number;
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

function valid(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function utmProj(zone: number, south: boolean): string {
  return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
}

/** Parses "25.2, 55.3", "25°12'17\"N 55°16'15\"E", MGRS "40RCN1234567890", UTM "40R 327000 2789000". */
export function parseCoordinates(input: string): LonLat | null {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  return parseMgrs(s) ?? parseUtm(s) ?? parseDms(s) ?? parseDecimal(s);
}

function parseMgrs(s: string): LonLat | null {
  const compact = s.replace(/\s+/g, '');
  if (!/^\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(\d{2}){0,5}$/.test(compact)) return null;
  const digits = compact.replace(/^\d{1,2}[A-Z]{3}/, '');
  if (digits.length === 0) return null;
  try {
    const [lon, lat] = mgrs.toPoint(compact);
    return valid(lat, lon) ? { lon, lat } : null;
  } catch {
    return null;
  }
}

function parseUtm(s: string): LonLat | null {
  // Zone + latitude band (or "N"/"S" hemisphere word) + easting + northing.
  const m = /^(\d{1,2})\s*([C-HJ-NP-X]|NORTH|SOUTH)\s+(\d{5,7}(?:\.\d+)?)\s*(?:E|MEAST)?[\s,]+(\d{6,8}(?:\.\d+)?)\s*(?:N|MNORTH)?$/.exec(s);
  if (!m) return null;
  const zone = Number(m[1]);
  if (zone < 1 || zone > 60) return null;
  const band = m[2]!;
  const south = band === 'SOUTH' || (band.length === 1 && BANDS.indexOf(band) < BANDS.indexOf('N'));
  const [lon, lat] = proj4(utmProj(zone, south), 'EPSG:4326', [Number(m[3]), Number(m[4])]) as [number, number];
  return valid(lat, lon) ? { lon, lat } : null;
}

function dmsPart(part: string): { value: number; hemi: string | null } | null {
  const hemi = /[NSEW]/.exec(part)?.[0] ?? null;
  const nums = part.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0 || nums.length > 3) return null;
  const [d, mi = '0', se = '0'] = nums;
  if (Number(mi) >= 60 || Number(se) >= 60) return null;
  let value = Number(d) + Number(mi) / 60 + Number(se) / 3600;
  if (/^-/.test(part.trim()) || hemi === 'S' || hemi === 'W') value = -value;
  return { value, hemi };
}

function parseDms(s: string): LonLat | null {
  if (!/[°'"′″NSEW]/.test(s)) return null;
  // Split after the first hemisphere letter, or at a comma.
  const m = /^(.*?[NS])\s*,?\s*(.*[EW].*)$/.exec(s) ?? /^(.*?[EW])\s*,?\s*(.*[NS].*)$/.exec(s) ?? /^([^,]+),([^,]+)$/.exec(s);
  if (!m) return null;
  const a = dmsPart(m[1]!);
  const b = dmsPart(m[2]!);
  if (!a || !b) return null;
  const aIsLon = a.hemi === 'E' || a.hemi === 'W';
  const lat = aIsLon ? b.value : a.value;
  const lon = aIsLon ? a.value : b.value;
  return valid(lat, lon) ? { lon, lat } : null;
}

function parseDecimal(s: string): LonLat | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return valid(lat, lon) ? { lon, lat } : null;
}

function toDms(value: number, pos: string, neg: string): string {
  const hemi = value < 0 ? neg : pos;
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let sec = Math.round(((abs - d) * 60 - m) * 60 * 10) / 10;
  if (sec >= 60) {
    sec = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${d}°${String(m).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${hemi}`;
}

export function utmZone(lon: number, lat: number): number {
  // Norway / Svalbard exceptions are irrelevant for this region but kept for correctness.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  return Math.min(60, Math.floor((lon + 180) / 6) + 1);
}

export function formatCoordinates({ lon, lat }: LonLat, format: CoordFormat): string {
  switch (format) {
    case 'dd':
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    case 'dms':
      return `${toDms(lat, 'N', 'S')} ${toDms(lon, 'E', 'W')}`;
    case 'mgrs': {
      if (lat < -80 || lat > 84) return '—';
      const m = mgrs.forward([lon, lat], 5);
      return m.replace(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})$/, '$1 $2 $3 $4');
    }
    case 'utm': {
      if (lat < -80 || lat > 84) return '—';
      const zone = utmZone(lon, lat);
      const band = BANDS[Math.min(19, Math.floor((lat + 80) / 8))]!;
      const [e, n] = proj4('EPSG:4326', utmProj(zone, lat < 0), [lon, lat]) as [number, number];
      return `${zone}${band} ${Math.round(e)}E ${Math.round(n)}N`;
    }
  }
}
