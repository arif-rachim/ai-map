import { describe, expect, it } from 'vitest';
import { dedupePlaces } from './services.js';

const place = (name: string, detail: string, lon: number, lat: number) => ({ type: 'place' as const, name, detail, lon, lat });

describe('dedupePlaces', () => {
  it('drops the same place of the same kind within about a kilometre', () => {
    const out = dedupePlaces([
      place('Jeddah Corniche Circuit', 'raceway, Jeddah', 39.104, 21.632),
      place('Jeddah Corniche Circuit', 'raceway, Jeddah', 39.106, 21.634),
      place('Jeddah Corniche Circuit', 'parking, Jeddah', 39.106, 21.634),
      place('Jeddah Corniche Circuit', 'raceway, Jeddah', 39.3, 21.8),
      place('Riyadh', 'city, Saudi Arabia', 46.71, 24.63),
    ]);
    expect(out.map((p) => `${p.detail}@${p.lon}`)).toEqual(['raceway, Jeddah@39.104', 'parking, Jeddah@39.106', 'raceway, Jeddah@39.3', 'city, Saudi Arabia@46.71']);
  });
});
