import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, MapPin, Plane, Search, X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import { useTranslation } from 'react-i18next';
import { DEFAULT_STYLE, formatCoordinates, parseCoordinates, type LonLat, type SearchResultItem } from '@ai-map/shared';
import { api } from '../lib/api';
import { ensureLayerId } from '../lib/layers';
import { mapRef } from '../mapRef';
import { useStore } from '../store';

interface Item {
  type: 'coord' | 'airport' | 'place';
  label: string;
  detail: string;
  pos: LonLat;
  /** Place kind (city, town, …) for choosing the zoom level. */
  kind?: string;
  bbox?: [number, number, number, number];
}

const PLACE_ZOOM: Record<string, number> = { country: 5, state: 7, city: 11, town: 12, village: 13, suburb: 14 };

/** Temporary marker for the chosen search result (not saved until the user taps "Save as Pin"). */
let marker: maplibregl.Marker | null = null;

export function removeSearchMarker(): void {
  marker?.remove();
  marker = null;
}

export function SearchBox() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const geocoderOn = useStore((s) => s.capabilities?.geocoder ?? false);
  const coordFormat = useStore((s) => s.coordFormat);
  const uiLang = useStore((s) => s.uiLang);
  const boxRef = useRef<HTMLDivElement>(null);

  const coord = useMemo(() => parseCoordinates(q), [q]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || coord) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      // Same unified search other applications use (GET /api/v1/search); coordinates are parsed locally above.
      const r = await api.search(term, uiLang, 12, ctrl.signal).catch(() => []);
      if (ctrl.signal.aborted) return;
      setResults(r);
      setActive(0);
      setLoading(false);
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, coord, uiLang]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const items: Item[] = [
    ...(coord ? [{ type: 'coord' as const, label: formatCoordinates(coord, coordFormat), detail: formatCoordinates(coord, coordFormat === 'dd' ? 'mgrs' : 'dd'), pos: coord }] : []),
    ...results
      .filter((r) => r.type !== 'coordinates')
      .map((r) => ({
        type: r.type as 'airport' | 'place',
        label: r.name,
        detail: r.detail,
        pos: { lon: r.lon, lat: r.lat },
        kind: r.type === 'place' ? r.detail.split(',')[0] : undefined,
        bbox: r.bbox,
      })),
  ];

  function choose(item: Item) {
    const map = mapRef.current;
    if (!map) return;
    setOpen(false);
    if (item.type === 'place' && item.bbox && !(item.kind && item.kind in { city: 1, town: 1, village: 1 })) {
      map.fitBounds(item.bbox, { maxZoom: 16, padding: 60, duration: 1200 });
    } else {
      const zoom = item.type === 'airport' ? 13 : item.type === 'place' ? (PLACE_ZOOM[item.kind ?? ''] ?? 16) : 14;
      map.flyTo({ center: [item.pos.lon, item.pos.lat], zoom, duration: 1200 });
    }
    showMarker(item);
  }

  function showMarker(item: Item) {
    const map = mapRef.current!;
    marker?.remove();
    const el = document.createElement('div');
    el.className = 'search-popup';
    const title = document.createElement('strong');
    title.textContent = item.label;
    title.dir = item.type === 'coord' ? 'ltr' : 'auto';
    const detail = document.createElement('div');
    // For a coordinate result the title already shows the typed format; show another common one below.
    const fmt = useStore.getState().coordFormat;
    detail.textContent = formatCoordinates(item.pos, item.type === 'coord' ? (fmt === 'mgrs' ? 'dd' : 'mgrs') : fmt);
    detail.className = 'coords';
    detail.dir = 'ltr';
    const btn = document.createElement('button');
    btn.className = 'button prominent';
    btn.textContent = t('search.pin');
    btn.onclick = async () => {
      const s = useStore.getState();
      try {
        const f = await api.createFeature({
          layerId: await ensureLayerId(),
          kind: 'point',
          geometry: { type: 'Point', coordinates: [item.pos.lon, item.pos.lat] },
          name: item.type === 'coord' ? '' : item.label,
          description: item.detail,
          style: { ...DEFAULT_STYLE, fillColor: '#dc2626' },
        });
        s.upsertFeature(f);
        s.select(f.id);
        removeSearchMarker();
      } catch (err) {
        s.notify((err as Error).message);
      }
    };
    const remove = document.createElement('button');
    remove.className = 'button';
    remove.textContent = t('search.removePin');
    remove.onclick = removeSearchMarker;
    const actions = document.createElement('div');
    actions.className = 'popup-actions';
    actions.append(remove);
    if (!useStore.getState().readonly) actions.append(btn);
    el.append(title, detail, actions);
    marker = new maplibregl.Marker({ color: getComputedStyle(document.querySelector('.app') ?? document.body).getPropertyValue('--accent').trim() || '#007aff' })
      .setLngLat([item.pos.lon, item.pos.lat])
      .setPopup(new maplibregl.Popup({ offset: 30, closeButton: true }).setDOMContent(el))
      .addTo(map);
    marker.togglePopup();
  }

  const ICONS = { coord: Crosshair, airport: Plane, place: MapPin };

  const onKey = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % items.length);
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + items.length) % items.length);
    else if (e.key === 'Enter') choose(items[active] ?? items[0]!);
    else return;
    e.preventDefault();
  };

  const section = (type: Item['type'], title: string) => {
    const list = items.map((it, i) => ({ it, i })).filter(({ it }) => it.type === type);
    if (!list.length) return null;
    return (
      <div className="search-section">
        <div className="search-section-title">{title}</div>
        {list.map(({ it, i }) => {
          const Icon = ICONS[it.type];
          return (
            <button key={i} role="option" aria-selected={i === active} className={`search-item ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => choose(it)}>
              <span className="search-icon" aria-hidden>
                <Icon size={15} strokeWidth={1.9} />
              </span>
              <span className="search-text">
                <span className="search-label" dir={it.type === 'coord' ? 'ltr' : 'auto'}>
                  {it.label}
                </span>
                {it.detail && <span className="search-detail">{it.detail}</span>}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="search" ref={boxRef} role="search">
      <div className="search-field glass">
        <Search size={17} strokeWidth={2} aria-hidden />
        <input
          type="search"
          value={q}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            } else onKey(e);
          }}
          dir="auto"
        />
        {q && (
          <button type="button" className="close-button" aria-label={t('search.clear')} onClick={() => (setQ(''), setResults([]), removeSearchMarker())}>
            <X size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
      {open && q.trim().length >= 2 && (
        <div className="search-results glass" role="listbox">
          {section('coord', t('search.coordinates'))}
          {section('airport', t('search.airports'))}
          {section('place', t('search.places'))}
          {!loading && items.length === 0 && <div className="search-empty">{t('search.none')}</div>}
          {!geocoderOn && !coord && <div className="search-empty muted">{t('search.geocoderOff')}</div>}
        </div>
      )}
    </div>
  );
}
