import { useState } from 'react';
import { Check, ChevronRight, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { setLayerLoaded } from '../lib/layers';
import { featureBounds } from '../lib/featureGeo';
import { mapRef } from '../mapRef';
import { canEdit, useStore } from '../store';
import { KIND_ICONS } from './icons';
import { IconButton, Popover } from './ui';

export function LayerPanel() {
  const { t } = useTranslation();
  const layers = useStore((s) => s.layers);
  const features = useStore((s) => s.features);
  const loaded = useStore((s) => s.loadedLayerIds);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const selectedId = useStore((s) => s.selectedId);
  const readonly = !useStore(canEdit);
  const s = useStore.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const [filter, setFilter] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      s.notify((err as Error).message);
    }
  };

  const addLayer = () =>
    run(async () => {
      const layer = await api.createLayer({ name: `${t('layers.newName')} ${layers.length + 1}`, sortOrder: layers.length });
      s.upsertLayer(layer);
      await setLayerLoaded(layer.id, true);
      s.setActiveLayer(layer.id);
      setRenaming(layer.id);
    });

  const rename = (id: string, name: string) =>
    run(async () => {
      setRenaming(null);
      if (!name.trim()) return;
      s.upsertLayer(await api.updateLayer(id, { name: name.trim() }));
    });

  /** `count` is null when the layer is not loaded (its size is unknown here). */
  const remove = async (id: string, name: string, count: number | null) => {
    const message = count === null ? t('layers.confirmDeleteAll') : t('layers.confirmDelete', { count });
    const ok = await s.confirm({ title: t('layers.confirmDeleteTitle', { name }), message, confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    await run(async () => {
      await api.deleteLayer(id);
      s.removeLayer(id);
    });
  };

  const zoomTo = (id: string) => {
    const f = useStore.getState().features[id];
    if (!f || !mapRef.current) return;
    mapRef.current.fitBounds(featureBounds(f), { padding: 80, maxZoom: 15, duration: 800 });
    if (useStore.getState().controls.has('select') || useStore.getState().controls.has('featurePanel')) s.select(id);
  };

  const toggleLoaded = (id: string, on: boolean) => run(() => setLayerLoaded(id, on));
  const activate = (id: string) =>
    run(async () => {
      await setLayerLoaded(id, true);
      useStore.getState().setActiveLayer(id);
    });

  const q = filter.trim().toLowerCase();
  const shown = q ? layers.filter((l) => l.name.toLowerCase().includes(q)) : layers;

  // Loaded layers start expanded; the list remembers what the user collapses.
  const isExpanded = (id: string) => expanded === null || expanded.includes(id);
  const toggleExpanded = (id: string) =>
    setExpanded((cur) => {
      const list = cur ?? layers.map((l) => l.id);
      return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    });

  return (
    <div className="panel glass layers-panel">
      <div className="panel-header">
        <h2>{t('layers.title')}</h2>
        {!readonly && <IconButton icon={Plus} label={t('layers.add')} onClick={() => void addLayer()} size="small" className="add-layer" />}
      </div>
      {layers.length > 5 && (
        <div className="layer-filter">
          <input className="text-input" type="search" placeholder={t('layers.filter')} aria-label={t('layers.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      <div className="panel-body">
        {layers.length === 0 && <p className="empty">{t(readonly ? 'layers.noLayers' : 'layers.noLayersAdmin')}</p>}
        {layers.length > 0 && loaded.length === 0 && !q && <p className="empty">{t('layers.noneLoaded')}</p>}
        {shown.map((layer) => {
          const items = Object.values(features)
            .filter((f) => f.layerId === layer.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          const isLoaded = loaded.includes(layer.id);
          const isActive = isLoaded && !readonly && layer.id === activeLayerId;
          const open = isLoaded && isExpanded(layer.id);
          return (
            <div key={layer.id} className={`layer-item ${isActive ? 'active' : ''} ${isLoaded ? 'loaded' : ''}`} data-layer-id={layer.id}>
              <div className="layer-row">
                <input type="checkbox" className="layer-load" checked={isLoaded} aria-label={`${t('layers.load')}: ${layer.name}`} title={t('layers.load')} onChange={(e) => void toggleLoaded(layer.id, e.target.checked)} />
                <button type="button" className="icon-button small" aria-label={t(open ? 'layers.collapse' : 'layers.expand')} aria-expanded={open} disabled={!isLoaded} onClick={() => toggleExpanded(layer.id)}>
                  <ChevronRight size={14} strokeWidth={2.2} className={`chevron ${open ? 'open' : ''}`} />
                </button>
                {renaming === layer.id ? (
                  <input
                    className="text-input rename-input"
                    autoFocus
                    defaultValue={layer.name}
                    aria-label={t('layers.rename')}
                    onBlur={(e) => void rename(layer.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="layer-name"
                    title={readonly ? t('layers.load') : t('layers.active')}
                    aria-pressed={readonly ? isLoaded : isActive}
                    onClick={() => void (readonly ? toggleLoaded(layer.id, !isLoaded) : activate(layer.id))}
                    onDoubleClick={() => !readonly && setRenaming(layer.id)}
                  >
                    <span className="name">{layer.name}</span>
                    {isLoaded && <span className="count">{items.length}</span>}
                    {isActive && <Check size={15} strokeWidth={2.5} className="check" aria-label={t('layers.activeBadge')} />}
                  </button>
                )}
                {!readonly && (
                  <Popover
                    label={t('layers.actions')}
                    width={200}
                    trigger={({ toggle }) => <IconButton icon={Ellipsis} label={t('layers.actions')} size="small" onClick={toggle} className="layer-actions" />}
                  >
                    {(close) => (
                      <div className="menu" role="menu">
                        <button role="menuitem" type="button" onClick={() => (close(), setRenaming(layer.id))}>
                          <Pencil size={15} /> {t('layers.rename')}
                        </button>
                        <button role="menuitem" type="button" className="destructive" onClick={() => (close(), void remove(layer.id, layer.name, isLoaded ? items.length : null))}>
                          <Trash2 size={15} /> {t('layers.delete')}
                        </button>
                      </div>
                    )}
                  </Popover>
                )}
              </div>
              {open && (
                <ul className="feature-list">
                  {items.length === 0 && <li className="empty">{t('layers.empty')}</li>}
                  {items.map((f) => {
                    const Icon = KIND_ICONS[f.kind];
                    const color = f.kind === 'point' || f.kind === 'milsymbol' ? f.style.fillColor : f.style.strokeColor;
                    return (
                      <li key={f.id}>
                        <button type="button" className={`feature-item ${f.id === selectedId ? 'selected' : ''}`} onClick={() => zoomTo(f.id)}>
                          <span className="kind-icon" style={{ background: color }} aria-hidden>
                            <Icon size={13} strokeWidth={2.2} />
                          </span>
                          <span className="label">{f.name || t(`kinds.${f.kind}`)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
