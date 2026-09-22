import { useEffect, useMemo, useRef, useState } from 'react';
import type { Position } from 'geojson';
import { useTranslation } from 'react-i18next';
import { formatDistance, greatCirclePath } from '@ai-map/shared';
import { elevationProfile, type Profile } from '../lib/terrain';
import { useStore } from '../store';

const W = 276;
const H = 130;
const M = { top: 8, right: 8, bottom: 20, left: 40 };

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

function ticks(min: number, max: number, target: number): number[] {
  const step = niceStep(max - min, target);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const meters = (v: number) => `${Math.round(v).toLocaleString()} m`;

/** Elevation along a line (great-circle between vertices). */
export function ElevationProfile({ coords }: { coords: [number, number][] }) {
  const { t } = useTranslation();
  const maxzoom = useStore((s) => s.capabilities?.terrainMaxzoom ?? null);
  const unit = useStore((s) => s.unit);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const key = JSON.stringify(coords);

  useEffect(() => {
    if (maxzoom === null || coords.length < 2) return;
    let cancelled = false;
    // Debounced: the line changes on every pointer move while drawing.
    const timer = setTimeout(async () => {
      const path = greatCirclePath(coords as Position[]).geometry.coordinates;
      const p = await elevationProfile(path, maxzoom);
      if (!cancelled) setProfile(p);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, maxzoom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => useStore.getState().setProfileHover(null), []);

  const geom = useMemo(() => {
    if (!profile || profile.min === null || profile.max === null) return null;
    const total = profile.points.at(-1)!.distanceM || 1;
    const pad = Math.max(10, (profile.max - profile.min) * 0.1);
    const yMin = Math.max(profile.min >= 0 ? 0 : -Infinity, profile.min - pad);
    const yMax = profile.max + pad;
    const x = (d: number) => M.left + (d / total) * (W - M.left - M.right);
    const y = (e: number) => M.top + (1 - (e - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);
    // Split into runs where DEM data exists.
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    for (const p of profile.points) {
      if (p.elevation === null) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push({ x: x(p.distanceM), y: y(p.elevation) });
    }
    if (run.length) runs.push(run);
    const base = H - M.bottom;
    return {
      total,
      x,
      y,
      yTicks: ticks(yMin, yMax, 4),
      xTicks: ticks(0, total, 3),
      lines: runs.map((r) => r.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join('')),
      areas: runs.map((r) => `M${r[0]!.x.toFixed(1)},${base}${r.map((pt) => `L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join('')}L${r.at(-1)!.x.toFixed(1)},${base}Z`),
    };
  }, [profile]);

  if (maxzoom === null) return null;
  if (!profile) return <div className="muted profile-loading">{t('profile.loading')}</div>;
  if (!geom) return <div className="muted">{t('profile.noData')}</div>;

  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const d = ((px - M.left) / (W - M.left - M.right)) * geom.total;
    let best = 0;
    profile.points.forEach((p, i) => {
      if (Math.abs(p.distanceM - d) < Math.abs(profile.points[best]!.distanceM - d)) best = i;
    });
    setHover(best);
    useStore.getState().setProfileHover(profile.points[best]!.coord);
  };
  const onLeave = () => {
    setHover(null);
    useStore.getState().setProfileHover(null);
  };

  const hp = hover !== null ? profile.points[hover]! : null;
  const tableRows = profile.points.filter((_, i) => i % 10 === 0 || i === profile.points.length - 1);

  return (
    <div className="profile" dir="ltr">
      <div className="profile-title">{t('profile.title')}</div>
      <div className="profile-chart">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={t('profile.title')}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          {geom.yTicks.map((v) => (
            <g key={`y${v}`}>
              <line className="grid" x1={M.left} x2={W - M.right} y1={geom.y(v)} y2={geom.y(v)} />
              <text className="tick" x={M.left - 4} y={geom.y(v) + 3} textAnchor="end">
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          ))}
          {geom.xTicks.map((v) => (
            <text key={`x${v}`} className="tick" x={geom.x(v)} y={H - 6} textAnchor={v === 0 ? 'start' : 'middle'}>
              {formatDistance(v, unit)}
            </text>
          ))}
          {geom.areas.map((d, i) => (
            <path key={`a${i}`} className="area" d={d} />
          ))}
          {geom.lines.map((d, i) => (
            <path key={`l${i}`} className="line" d={d} />
          ))}
          {hp && hp.elevation !== null && (
            <g>
              <line className="crosshair" x1={geom.x(hp.distanceM)} x2={geom.x(hp.distanceM)} y1={M.top} y2={H - M.bottom} />
              <circle className="marker" cx={geom.x(hp.distanceM)} cy={geom.y(hp.elevation)} r={4} />
            </g>
          )}
        </svg>
        {hp && (
          <div className="profile-tooltip" style={{ left: `${(geom.x(hp.distanceM) / W) * 100}%` }}>
            <strong>{hp.elevation === null ? '—' : meters(hp.elevation)}</strong>
            <span>{formatDistance(hp.distanceM, unit)}</span>
          </div>
        )}
      </div>
      <dl className="profile-stats">
        <dt>{t('profile.min')}</dt>
        <dd>{meters(profile.min!)}</dd>
        <dt>{t('profile.max')}</dt>
        <dd>{meters(profile.max!)}</dd>
        <dt>{t('profile.ascent')}</dt>
        <dd>↑ {meters(profile.ascentM)}</dd>
        <dt>{t('profile.descent')}</dt>
        <dd>↓ {meters(profile.descentM)}</dd>
      </dl>
      <details className="profile-table">
        <summary>{t('profile.table')}</summary>
        <table className="segments">
          <thead>
            <tr>
              <th>{t('profile.distance')}</th>
              <th>{t('profile.elevation')}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((p) => (
              <tr key={p.distanceM}>
                <td>{formatDistance(p.distanceM, unit)}</td>
                <td>{p.elevation === null ? '—' : meters(p.elevation)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
