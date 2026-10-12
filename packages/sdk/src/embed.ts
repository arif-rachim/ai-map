import {
  buildEmbedUrl,
  EMBED_PROTOCOL_VERSION,
  isEmbedMessage,
  type EmbedCommandName,
  type EmbedCommands,
  type EmbedEventName,
  type EmbedEvents,
  type EmbedUrlParams,
  type MapView,
  type MarkerInput,
  type ToolName,
} from '@ai-map/shared/embed';
import type { MapFeature } from '@ai-map/shared/schemas';

export type { EmbedCommands, EmbedEvents, EmbedOptions, EmbedUrlParams, MapView, MarkerInput, SearchResultItem, ToolName } from '@ai-map/shared/embed';

export interface AiMapEmbedOptions extends EmbedUrlParams {
  /** Map server origin, e.g. "http://maps.local". */
  baseUrl: string;
  /** Milliseconds before a command without response rejects (default 15000). */
  timeoutMs?: number;
  /** Extra iframe attributes/styles. */
  iframeStyle?: Partial<CSSStyleDeclaration>;
  title?: string;
}

type Listener<K extends EmbedEventName> = (data: EmbedEvents[K]) => void;

let counter = 0;

/**
 * Embeds the full map in an iframe and controls it with typed commands and events.
 *
 * ```js
 * const map = AiMap.AiMapEmbed.create('#map', { baseUrl: 'http://maps.local', center: [46.67, 24.71], zoom: 10, readonly: true });
 * await map.ready;
 * map.on('click', (e) => console.log(e.lon, e.lat));
 * await map.setMarkers([{ id: 'truck-1', lon: 46.7, lat: 24.7, label: 'Truck 1' }]);
 * ```
 */
export class AiMapEmbed {
  readonly iframe: HTMLIFrameElement;
  /** Resolves with the initial view once the embedded map has loaded. */
  readonly ready: Promise<MapView>;
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Map<EmbedEventName, Set<Listener<EmbedEventName>>>();
  private readonly onMessage: (e: MessageEvent) => void;

  static create(container: string | HTMLElement, options: AiMapEmbedOptions): AiMapEmbed {
    const el = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
    if (!el) throw new Error(`AiMapEmbed: container ${String(container)} not found`);
    const iframe = document.createElement('iframe');
    iframe.title = options.title ?? 'Map';
    Object.assign(iframe.style, { border: '0', width: '100%', height: '100%', display: 'block' }, options.iframeStyle);
    iframe.allow = 'fullscreen';
    const embed = new AiMapEmbed(iframe, options);
    iframe.src = buildEmbedUrl(options.baseUrl, options);
    el.appendChild(iframe);
    return embed;
  }

  /** Attach to an existing iframe (its src must already point at /embed on the map server). */
  constructor(iframe: HTMLIFrameElement, options: Pick<AiMapEmbedOptions, 'baseUrl' | 'timeoutMs'>) {
    this.iframe = iframe;
    this.origin = new URL(options.baseUrl).origin;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.ready = new Promise((resolve) => this.once('ready', (d) => resolve(d.view)));
    this.onMessage = (e: MessageEvent) => {
      if (e.source !== this.iframe.contentWindow || e.origin !== this.origin || !isEmbedMessage(e.data)) return;
      const msg = e.data;
      if (msg.type === 'response') {
        const p = this.pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      } else if (msg.type === 'event') {
        for (const cb of this.listeners.get(msg.event) ?? []) cb(msg.data as never);
      }
    };
    window.addEventListener('message', this.onMessage);
  }

  /** Sends any protocol command; prefer the typed helpers below. */
  call<K extends EmbedCommandName>(command: K, ...params: EmbedCommands[K]['params'] extends void ? [] : [EmbedCommands[K]['params']]): Promise<EmbedCommands[K]['result']> {
    const id = `c${Date.now().toString(36)}${(counter++).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AiMapEmbed: ${command} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.iframe.contentWindow?.postMessage({ source: 'aimap', version: EMBED_PROTOCOL_VERSION, type: 'command', id, command, params: params[0] }, this.origin);
    });
  }

  on<K extends EmbedEventName>(event: K, cb: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb as Listener<EmbedEventName>);
    return () => set!.delete(cb as Listener<EmbedEventName>);
  }

  once<K extends EmbedEventName>(event: K, cb: Listener<K>): () => void {
    const off = this.on(event, (d) => {
      off();
      cb(d);
    });
    return off;
  }

  getView = () => this.call('getView');
  setView = (view: EmbedCommands['setView']['params']) => this.call('setView', view);
  fitBounds = (bounds: [number, number, number, number], opts: { padding?: number; maxZoom?: number } = {}) => this.call('fitBounds', { bounds, ...opts });
  search = (q: string, limit?: number) => this.call('search', { q, limit });
  listLayers = () => this.call('listLayers');
  listFeatures = (layerId?: string) => this.call('listFeatures', { layerId });
  addFeature = (input: EmbedCommands['addFeature']['params']): Promise<MapFeature> => this.call('addFeature', input);
  updateFeature = (id: string, patch: EmbedCommands['updateFeature']['params']['patch']) => this.call('updateFeature', { id, patch });
  deleteFeature = (id: string) => this.call('deleteFeature', { id });
  selectFeature = (id: string | null, zoomTo = false) => this.call('selectFeature', { id, zoomTo });
  setLayerVisible = (layerId: string, visible: boolean) => this.call('setLayerVisible', { layerId, visible });
  setActiveLayer = (layerId: string) => this.call('setActiveLayer', { layerId });
  /** Admin token for writes (addFeature, updateFeature, deleteFeature); `null` signs out. */
  setAuthToken = (token: string | null) => this.call('setAuthToken', { token });
  setTool = (tool: ToolName) => this.call('setTool', { tool });
  setOptions = (options: EmbedCommands['setOptions']['params']) => this.call('setOptions', options);
  setMarkers = (markers: MarkerInput[], replace = false) => this.call('setMarkers', { markers, replace });
  removeMarkers = (ids?: string[]) => this.call('removeMarkers', { ids });
  /** e.g. `setControls(['none'])` for a pure map, `setControls(['search', 'draw.point', 'zoom'])`, `setControls(['all', '-status'])`. */
  setControls = (controls?: string[], readonly?: boolean) => this.call('setControls', { controls, readonly });
  getControls = () => this.call('getControls');
  setInteraction = (interaction: EmbedCommands['setInteraction']['params']) => this.call('setInteraction', interaction);

  destroy(): void {
    window.removeEventListener('message', this.onMessage);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('AiMapEmbed destroyed'));
    }
    this.pending.clear();
    this.listeners.clear();
    this.iframe.remove();
  }
}
