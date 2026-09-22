// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiMapClient, AiMapError } from './client';

type Call = { url: string; method: string; body: unknown; contentType: string | null };

function mockFetch(respond: (c: Call) => Response = () => new Response('[]', { status: 200 })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, contentType: headers['content-type'] ?? null };
      calls.push(call);
      return respond(call);
    }),
  );
  return calls;
}

describe('AiMapClient requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requires a base URL outside browsers only', () => {
    expect(new AiMapClient().baseUrl).toBe(location.origin);
    expect(new AiMapClient('http://maps.local///'.replace(/\/+$/, '/')).baseUrl).toBe('http://maps.local');
  });

  it('maps every method to the documented endpoint', async () => {
    const calls = mockFetch((c) => new Response(c.url.includes('/elevation?') ? '{"elevation":123}' : '{}', { status: 200 }));
    const c = new AiMapClient('http://maps.local');
    const L = '11111111-1111-4111-8111-111111111111';
    await c.capabilities();
    await c.search('Riyadh', { lang: 'ar', limit: 3, types: ['airport', 'place'] });
    await c.searchAirports('DXB', 2);
    await c.airport('OMDB');
    expect(await c.elevation(42.5, 18.2)).toBe(123);
    await c.elevations([[1, 2]]);
    await c.elevationProfile([[1, 2], [3, 4]], { samples: 50, greatCircle: false });
    await c.layers();
    await c.createLayer({ name: 'A' });
    await c.updateLayer(L, { visible: false });
    await c.deleteLayer(L);
    await c.feature('f1');
    await c.createFeature({ layerId: L, kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] } });
    await c.updateFeature('f1', { name: 'x', version: 7 });
    await c.deleteFeature('f1');
    await c.featuresGeoJSON({ layerId: L, bbox: [1, 2, 3, 4] });
    await c.importGeoJSON(L, { type: 'FeatureCollection', features: [] }, 'replace');

    expect(calls.map((x) => `${x.method} ${x.url.replace('http://maps.local/api/v1', '')}`)).toEqual([
      'GET /capabilities',
      'GET /search?q=Riyadh&lang=ar&limit=3&types=airport%2Cplace',
      'GET /airports/search?q=DXB&limit=2',
      'GET /airports/OMDB',
      'GET /elevation?lon=42.5&lat=18.2',
      'POST /elevation',
      'POST /elevation/profile',
      'GET /layers',
      'POST /layers',
      `PATCH /layers/${L}`,
      `DELETE /layers/${L}`,
      'GET /features/f1',
      'POST /features',
      'PATCH /features/f1',
      'DELETE /features/f1',
      `GET /features.geojson?layerId=${L}&bbox=1%2C2%2C3%2C4`,
      `POST /layers/${L}/import?mode=replace`,
    ]);
    expect(calls[5]!.body).toEqual({ points: [[1, 2]] });
    expect(calls[6]!.body).toEqual({ coordinates: [[1, 2], [3, 4]], samples: 50, greatCircle: false });
    expect(calls[13]!.body).toEqual({ name: 'x', version: 7 });
    expect(calls[16]!.contentType).toBe('application/geo+json');
    expect(calls[1]!.contentType).toBeNull();
  });

  it('builds resource URLs without requests', () => {
    const c = new AiMapClient('http://maps.local');
    expect(c.styleUrl()).toBe('http://maps.local/api/v1/styles/light.json');
    expect(c.styleUrl({ theme: 'dark', lang: 'ar', terrain: '3d' })).toBe('http://maps.local/api/v1/styles/dark.json?lang=ar&terrain=3d');
    expect(c.tileJsonUrl('terrain')).toBe('http://maps.local/api/v1/tiles/terrain.json');
    expect(c.exportUrl('L', 'kml')).toBe('http://maps.local/api/v1/layers/L/export.kml');
  });

  it('fetches the latest version when none is given and surfaces conflicts', async () => {
    const calls = mockFetch((c) => {
      if (c.method === 'GET') return new Response('{"id":"f1","version":3}', { status: 200 });
      return new Response(JSON.stringify({ message: 'Feature was modified by another user', current: { version: 4 } }), { status: 409 });
    });
    const c = new AiMapClient('http://maps.local');
    const err = await c.updateFeature('f1', { name: 'x' }).catch((e) => e);
    expect(calls[1]!.body).toEqual({ name: 'x', version: 3 });
    expect(err).toBeInstanceOf(AiMapError);
    expect(err).toMatchObject({ status: 409, message: 'Feature was modified by another user', body: { current: { version: 4 } } });
  });

  it('returns null for unknown airports but throws other errors', async () => {
    mockFetch((c) => new Response('{"message":"x"}', { status: c.url.includes('XXX') ? 404 : 500 }));
    const c = new AiMapClient('http://maps.local');
    expect(await c.airport('XXX')).toBeNull();
    await expect(c.airport('YYY')).rejects.toMatchObject({ status: 500 });
  });

  it('handles 204 responses', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(new AiMapClient('http://maps.local').deleteFeature('f1')).resolves.toBeUndefined();
  });
});

describe('AiMapClient.subscribe', () => {
  class FakeSocket {
    static instances: FakeSocket[] = [];
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onclose?: () => void;
    closed = false;
    constructor(readonly url: string) {
      FakeSocket.instances.push(this);
    }
    close() {
      this.closed = true;
      this.onclose?.();
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeSocket.instances = [];
  });

  it('delivers messages, reconnects with backoff and stops when closed', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const messages: unknown[] = [];
    const opens = vi.fn();
    const sub = new AiMapClient('https://maps.local').subscribe((m) => messages.push(m), { onOpen: opens });
    const first = FakeSocket.instances[0]!;
    expect(first.url).toBe('wss://maps.local/api/v1/events');
    first.onopen!();
    first.onmessage!({ data: '{"type":"feature.deleted","id":"f1"}' });
    first.onmessage!({ data: 'not json' });
    expect(messages).toEqual([{ type: 'feature.deleted', id: 'f1' }]);

    first.onclose!();
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]!.onopen!();
    expect(opens).toHaveBeenCalledTimes(2);

    sub.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1]!.closed).toBe(true);
  });
});
