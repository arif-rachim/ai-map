// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true,"disableJavaScriptFileLoading":true,"disableCSSFileLoading":true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiMapClient, AiMapError } from './client';
import { AiMapEmbed } from './embed';

describe('AiMapClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds URLs and parses responses', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/features/f1') && init?.method === 'PATCH') return new Response(JSON.stringify({ id: 'f1', version: 3 }), { status: 200 });
      if (url.endsWith('/features/f1')) return new Response(JSON.stringify({ id: 'f1', version: 2 }), { status: 200 });
      if (url.includes('/airports/XXX')) return new Response(JSON.stringify({ message: 'Airport not found' }), { status: 404 });
      return new Response('[]', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = new AiMapClient('http://maps.local/');
    expect(c.styleUrl({ theme: 'dark' })).toBe('http://maps.local/api/v1/styles/dark.json');
    await c.features({ bbox: [1, 2, 3, 4], layerId: 'L' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://maps.local/api/v1/features?bbox=1%2C2%2C3%2C4&layerId=L');

    // Without an explicit version the latest one is fetched first.
    const updated = await c.updateFeature('f1', { name: 'x' });
    expect(updated.version).toBe(3);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toEqual({ name: 'x', version: 2 });

    expect(await c.airport('XXX')).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'boom' }), { status: 500 }));
    await expect(c.layers()).rejects.toBeInstanceOf(AiMapError);
  });
});

describe('AiMapEmbed.create', () => {
  it('creates an iframe with the embed URL and exposes typed helpers', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const embed = AiMapEmbed.create('#host', { baseUrl: 'http://maps.local', center: [46, 24], zoom: 8, controls: [], readonly: true, title: 'Ops map' });
    const iframe = document.querySelector('#host iframe') as HTMLIFrameElement;
    expect(iframe.title).toBe('Ops map');
    const url = new URL(iframe.src);
    expect(url.pathname).toBe('/embed');
    expect(Object.fromEntries(url.searchParams)).toEqual({ center: '46,24', zoom: '8', controls: 'none', readonly: '1' });
    expect(() => AiMapEmbed.create('#missing', { baseUrl: 'http://maps.local' })).toThrow('not found');

    const sent: any[] = [];
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: (m: unknown) => sent.push(m) } });
    void embed.setControls(['none', 'zoom'], true).catch(() => {});
    void embed.getControls().catch(() => {});
    void embed.setInteraction({ interactive: false, maxBounds: null }).catch(() => {});
    expect(sent.map((m) => [m.command, m.params])).toEqual([
      ['setControls', { controls: ['none', 'zoom'], readonly: true }],
      ['getControls', undefined],
      ['setInteraction', { interactive: false, maxBounds: null }],
    ]);
    embed.destroy();
    expect(document.querySelector('#host iframe')).toBeNull();
  });
});

describe('AiMapEmbed', () => {
  function setup() {
    const posted: { data: any; origin: string }[] = [];
    const contentWindow = { postMessage: (data: unknown, origin: string) => posted.push({ data, origin }) };
    const iframe = { contentWindow, remove: vi.fn() } as unknown as HTMLIFrameElement;
    const embed = new AiMapEmbed(iframe, { baseUrl: 'http://maps.local', timeoutMs: 200 });
    const fromMap = (data: object, origin = 'http://maps.local', source: unknown = contentWindow) =>
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'aimap', version: 1, ...data }, origin, source: source as Window }));
    return { embed, posted, fromMap };
  }

  it('resolves commands with responses and rejects errors', async () => {
    const { embed, posted, fromMap } = setup();
    const view = embed.getView();
    expect(posted[0]).toMatchObject({ origin: 'http://maps.local', data: { type: 'command', command: 'getView' } });
    fromMap({ type: 'response', id: posted[0]!.data.id, ok: true, result: { zoom: 5 } });
    await expect(view).resolves.toEqual({ zoom: 5 });

    const bad = embed.selectFeature('nope');
    fromMap({ type: 'response', id: posted[1]!.data.id, ok: false, error: 'Feature not found' });
    await expect(bad).rejects.toThrow('Feature not found');
    embed.destroy();
  });

  it('delivers events, ignores other origins, and times out', async () => {
    const { embed, fromMap } = setup();
    const clicks: unknown[] = [];
    embed.on('click', (e) => clicks.push(e));
    fromMap({ type: 'event', event: 'click', data: { lon: 1, lat: 2 } });
    fromMap({ type: 'event', event: 'click', data: { lon: 9, lat: 9 } }, 'http://evil.local');
    fromMap({ type: 'event', event: 'ready', data: { version: 1, view: { zoom: 3 } } });
    expect(clicks).toEqual([{ lon: 1, lat: 2 }]);
    await expect(embed.ready).resolves.toEqual({ zoom: 3 });
    await expect(embed.setTool('none')).rejects.toThrow('timed out');
    embed.destroy();
  });
});
