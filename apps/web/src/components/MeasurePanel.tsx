import * as turf from '@turf/turf';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_STYLE } from '@ai-map/shared';
import { api } from '../lib/api';
import { ensureLayerId } from '../lib/layers';
import { roundGeometry } from '../lib/featureGeo';
import { formatArea, formatDistance, lineSegments, ring, toMeters } from '@ai-map/shared';
import { parseRadii } from '../lib/measureOverlay';
import { useStore } from '../store';
import { ElevationProfile } from './ElevationProfile';
import { MEASURE_ICONS } from './icons';
import { Row, Section } from './ui';

export function MeasurePanel() {
  const { t } = useTranslation();
  const tool = useStore((s) => s.tool);
  const m = useStore((s) => s.measure);
  const unit = useStore((s) => s.unit);
  const readonly = useStore((s) => s.readonly);
  const s = useStore.getState();
  if (tool.type !== 'measure') return null;

  const segs = tool.kind === 'distance' && m.coords ? lineSegments(m.coords) : [];
  const total = segs.reduce((a, x) => a + x.meters, 0);

  let area: { m2: number; perimeter: number } | null = null;
  if (tool.kind === 'area' && m.coords && m.coords.length >= 3) {
    const ringCoords = [...m.coords, m.coords[0]!];
    const poly = turf.polygon([ringCoords]);
    area = { m2: turf.area(poly), perimeter: turf.length(turf.lineString(ringCoords)) * 1000 };
  }

  const hint = tool.kind === 'distance' ? t('measure.hintDistance') : tool.kind === 'area' ? t('measure.hintArea') : t('measure.hintRings');
  const hasResult = (tool.kind === 'rings' && m.center) || (m.coords && m.coords.length >= 2);

  const save = async () => {
    try {
      const layerId = await ensureLayerId();
      const created = [];
      if (tool.kind === 'distance' && m.coords) {
        created.push(
          await api.createFeature({
            layerId,
            kind: 'line',
            geometry: roundGeometry({ type: 'LineString', coordinates: m.coords }),
            name: formatDistance(total, unit),
            style: { ...DEFAULT_STYLE, strokeColor: '#007aff' },
          }),
        );
      } else if (tool.kind === 'area' && m.coords && area) {
        created.push(
          await api.createFeature({
            layerId,
            kind: 'polygon',
            geometry: roundGeometry({ type: 'Polygon', coordinates: [[...m.coords, m.coords[0]!]] }),
            name: formatArea(area.m2, unit),
            style: { ...DEFAULT_STYLE, strokeColor: '#007aff', fillColor: '#007aff' },
          }),
        );
      } else if (tool.kind === 'rings' && m.center) {
        for (const r of parseRadii(m.radii)) {
          const geometry = roundGeometry(ring(m.center, toMeters(r, unit)).geometry) as { type: 'Polygon'; coordinates: [number, number][][] };
          created.push(
            await api.createFeature({
              layerId,
              kind: 'circle',
              geometry,
              center: m.center,
              radiusM: toMeters(r, unit),
              name: formatDistance(toMeters(r, unit), unit),
              style: { ...DEFAULT_STYLE, strokeColor: '#007aff', fillOpacity: 0 },
            }),
          );
        }
      }
      created.forEach((f) => s.upsertFeature(f));
      s.setTool({ type: 'none' });
    } catch (err) {
      s.notify((err as Error).message);
    }
  };

  const Icon = MEASURE_ICONS[tool.kind];
  return (
    <div className="panel glass inspector measure-panel">
      <div className="panel-header">
        <span className="search-icon" aria-hidden>
          <Icon size={15} strokeWidth={2} />
        </span>
        <h2>
          {t(`tools.${tool.kind}`)}
          <span className="subtitle">{t('measure.title')}</span>
        </h2>
        <button type="button" className="close-button" aria-label={t('tools.cancel')} title={t('tools.cancel')} onClick={() => s.setTool({ type: 'none' })}>
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
      <div className="panel-body">
        {!hasResult && <p className="hint">{hint}</p>}

        {tool.kind === 'distance' && segs.length > 0 && (
          <>
            <div className="hero-value" dir="ltr">
              {formatDistance(total, unit)}
            </div>
            <p className="hint" dir="ltr">
              {segs.length === 1 ? `${t('measure.bearing')} ${segs[0]!.bearing.toFixed(1)}°` : t('measure.segments', { count: segs.length })}
            </p>
            {segs.length > 1 && (
              <Section>
                <table className="segments-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('measure.segment')}</th>
                      <th>{t('measure.bearing')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segs.map((x, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td dir="ltr">{formatDistance(x.meters, unit)}</td>
                        <td dir="ltr">{x.bearing.toFixed(1)}°</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}
            {m.coords && <ElevationProfile coords={m.coords} />}
          </>
        )}

        {area && (
          <>
            <div className="hero-value" dir="ltr">
              {formatArea(area.m2, unit)}
            </div>
            <Section>
              <Row label={t('measure.perimeter')}>
                <span dir="ltr">{formatDistance(area.perimeter, unit)}</span>
              </Row>
            </Section>
          </>
        )}

        {tool.kind === 'rings' && (
          <Section title={`${t('measure.radii')} (${unit === 'nm' ? 'NM' : unit})`} footer={t('measure.radiiHint')}>
            <Row stacked>
              <input dir="ltr" value={m.radii} aria-label={t('measure.radii')} onChange={(e) => s.setMeasure({ radii: e.target.value })} placeholder="10, 25, 50" />
            </Row>
          </Section>
        )}

        <div className="actions">
          <button type="button" className="button" onClick={() => s.setMeasure({ coords: null, center: null })} disabled={!hasResult}>
            {t('measure.clear')}
          </button>
          {!readonly && (
            <button type="button" className="button prominent" onClick={() => void save()} disabled={!hasResult}>
              {t('measure.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
