import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FeaturePatch, MapFeature, Style } from '@ai-map/shared';
import { api, ApiError } from '../lib/api';
import { formatCoordinates } from '@ai-map/shared';
import { circleParams, featureBounds, featureMetrics, roundGeometry } from '../lib/featureGeo';
import { drawRef, mapRef } from '../mapRef';
import { useStore } from '../store';
import { SymbolPicker } from './SymbolPicker';
import { ElevationProfile } from './ElevationProfile';
import { KIND_ICONS } from './icons';
import { Row, Section, Switch } from './ui';

type Patch = Omit<FeaturePatch, 'version'>;

/** Sends a PATCH; on version conflict loads the server copy and tells the user. */
async function save(feature: MapFeature, patch: Patch, conflictMsg: string): Promise<void> {
  const s = useStore.getState();
  try {
    s.upsertFeature(await api.updateFeature(feature.id, { ...patch, version: feature.version }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const current = (err.body as { current?: MapFeature } | null)?.current;
      if (current) s.upsertFeature(current);
      s.notify(conflictMsg);
    } else {
      s.notify((err as Error).message);
    }
  }
}

export function FeaturePanel() {
  const { t } = useTranslation();
  const selectedId = useStore((s) => s.selectedId);
  const feature = useStore((s) => (s.selectedId ? s.features[s.selectedId] : undefined));
  const layers = useStore((s) => s.layers);
  const unit = useStore((s) => s.unit);
  const coordFormat = useStore((s) => s.coordFormat);
  const editingId = useStore((s) => s.editingId);
  const readonly = useStore((s) => s.readonly);
  const s = useStore.getState();

  // Local draft for text inputs, flushed on blur / after typing pause.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setName(feature?.name ?? '');
    setDescription(feature?.description ?? '');
    // Only reset drafts when switching features or when another user changed them.
  }, [selectedId, feature?.name, feature?.description]);

  if (!feature) return null;
  const conflict = t('feature.conflict');
  const latest = () => useStore.getState().features[feature.id] ?? feature;

  const patchText = (patch: Patch) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(latest(), patch, conflict), 600);
  };
  const patchStyle = (style: Partial<Style>) => void save(latest(), { style: { ...latest().style, ...style } }, conflict);

  const finishEdit = async () => {
    const snapshot = drawRef.current?.getSnapshotFeature(feature.id)?.geometry;
    s.setEditing(null);
    if (!snapshot) return;
    const geometry = roundGeometry(snapshot) as MapFeature['geometry'];
    const patch: Patch = { geometry };
    if (feature.kind === 'circle' && geometry.type === 'Polygon') Object.assign(patch, circleParams(geometry.coordinates));
    await save(latest(), patch, conflict);
  };

  const remove = async () => {
    const ok = await s.confirm({ title: t('feature.confirmDelete'), message: feature.name || undefined, confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    try {
      await api.deleteFeature(feature.id);
      s.removeFeature(feature.id);
    } catch (err) {
      s.notify((err as Error).message);
    }
  };

  const zoom = () => mapRef.current?.fitBounds(featureBounds(feature), { padding: 80, maxZoom: 15, duration: 800 });

  const metrics = featureMetrics(feature, unit);
  const isArea = feature.geometry.type === 'Polygon';
  const hasLine = feature.geometry.type !== 'Point';
  const editing = editingId === feature.id;
  const Icon = KIND_ICONS[feature.kind];
  const coord = (c: [number, number]) => formatCoordinates({ lon: c[0], lat: c[1] }, coordFormat);

  return (
    <div className="panel glass inspector feature-panel" aria-label={t('feature.title')}>
      <div className="panel-header">
        <span className="search-icon" aria-hidden>
          <Icon size={15} strokeWidth={2} />
        </span>
        <h2>
          {feature.name || t(`kinds.${feature.kind}`)}
          {feature.name && <span className="subtitle">{t(`kinds.${feature.kind}`)}</span>}
        </h2>
        <button type="button" className="close-button" onClick={() => s.select(null)} aria-label={t('common.close')}>
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>

      <div className="panel-body">
        <fieldset className="plain" disabled={readonly}>
          <Section>
            <Row label={t('feature.name')} stacked>
              <input
                dir="auto"
                value={name}
                placeholder={t('feature.untitled')}
                aria-label={t('feature.name')}
                onChange={(e) => {
                  setName(e.target.value);
                  patchText({ name: e.target.value });
                }}
              />
            </Row>
            <Row label={t('feature.description')} stacked>
              <textarea
                dir="auto"
                rows={2}
                value={description}
                aria-label={t('feature.description')}
                onChange={(e) => {
                  setDescription(e.target.value);
                  patchText({ description: e.target.value });
                }}
              />
            </Row>
            <Row label={t('feature.layer')}>
              <select value={feature.layerId} aria-label={t('feature.layer')} onChange={(e) => void save(latest(), { layerId: e.target.value }, conflict)}>
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Row>
          </Section>

          {feature.kind === 'milsymbol' && (
            <Section title={t('feature.symbol')}>
              <SymbolPicker sidc={feature.sidc ?? ''} onChange={(sidc) => void save(latest(), { sidc }, conflict)} />
              <Range label={t('feature.iconSize')} min={16} max={100} step={2} value={feature.style.iconSize} onChange={(iconSize) => patchStyle({ iconSize })} />
            </Section>
          )}

          {feature.kind === 'text' && (
            <Section title={t('feature.style')}>
              <Color label={t('feature.textColor')} value={feature.style.textColor} onChange={(textColor) => patchStyle({ textColor })} />
              <Range label={t('feature.textSize')} min={8} max={48} step={1} value={feature.style.textSize} onChange={(textSize) => patchStyle({ textSize })} />
            </Section>
          )}

          {feature.kind === 'point' && (
            <Section title={t('feature.style')}>
              <Color label={t('feature.fill')} value={feature.style.fillColor} onChange={(fillColor) => patchStyle({ fillColor })} />
            </Section>
          )}

          {hasLine && (
            <Section title={t('feature.style')}>
              <Color label={t('feature.stroke')} value={feature.style.strokeColor} onChange={(strokeColor) => patchStyle({ strokeColor })} />
              <Range label={t('feature.strokeWidth')} min={1} max={12} step={0.5} value={feature.style.strokeWidth} onChange={(strokeWidth) => patchStyle({ strokeWidth })} />
              <Range label={t('feature.strokeOpacity')} min={0} max={1} step={0.05} value={feature.style.strokeOpacity} onChange={(strokeOpacity) => patchStyle({ strokeOpacity })} percent />
              <Row label={t('feature.dashed')}>
                <Switch label={t('feature.dashed')} checked={feature.style.strokeDash} onChange={(strokeDash) => patchStyle({ strokeDash })} />
              </Row>
              {isArea && (
                <>
                  <Color label={t('feature.fill')} value={feature.style.fillColor} onChange={(fillColor) => patchStyle({ fillColor })} />
                  <Range label={t('feature.fillOpacity')} min={0} max={1} step={0.05} value={feature.style.fillOpacity} onChange={(fillOpacity) => patchStyle({ fillOpacity })} percent />
                </>
              )}
            </Section>
          )}
        </fieldset>

        <Section title={t('feature.info')} className="metrics">
          {feature.geometry.type === 'Point' && (
            <Row label={t('feature.position')}>
              <span dir="ltr">{coord(feature.geometry.coordinates)}</span>
            </Row>
          )}
          {metrics.length && (
            <Row label={t('feature.length')}>
              <span dir="ltr">{metrics.length}</span>
            </Row>
          )}
          {metrics.radius && (
            <Row label={t('feature.radius')}>
              <span dir="ltr">{metrics.radius}</span>
            </Row>
          )}
          {feature.center && (
            <Row label={t('feature.center')}>
              <span dir="ltr">{coord(feature.center)}</span>
            </Row>
          )}
          {metrics.area && (
            <>
              <Row label={t('feature.area')}>
                <span dir="ltr">{metrics.area}</span>
              </Row>
              <Row label={t('feature.perimeter')}>
                <span dir="ltr">{metrics.perimeter}</span>
              </Row>
            </>
          )}
        </Section>

        {feature.geometry.type === 'LineString' && !editing && <ElevationProfile coords={feature.geometry.coordinates} />}

        <div className="actions">
          {editing ? (
            <>
              <button type="button" className="button" onClick={() => s.setEditing(null)}>
                {t('feature.cancelEdit')}
              </button>
              <button type="button" className="button prominent" onClick={() => void finishEdit()}>
                {t('feature.finishEdit')}
              </button>
            </>
          ) : (
            <>
              {!readonly && (
                <button type="button" className="button destructive" onClick={() => void remove()}>
                  {t('feature.delete')}
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="button" onClick={zoom}>
                {t('feature.zoom')}
              </button>
              {!readonly && (
                <button type="button" className="button" onClick={() => s.setEditing(feature.id)}>
                  {t('feature.editShape')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <input type="color" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </Row>
  );
}

function Range(props: { label: string; min: number; max: number; step: number; value: number; percent?: boolean; onChange: (v: number) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => v !== props.value && props.onChange(v);
  return (
    <Row label={props.label}>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={v}
        aria-label={props.label}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <span className="value-badge">{props.percent ? `${Math.round(v * 100)}%` : v}</span>
    </Row>
  );
}
