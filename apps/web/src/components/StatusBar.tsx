import { Mountain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCoordinates } from '@ai-map/shared';
import { useStore } from '../store';

/** Compact glass pill: cursor coordinates, elevation, zoom and live connection. */
export function StatusBar() {
  const { t } = useTranslation();
  const cursor = useStore((s) => s.cursor);
  const zoom = useStore((s) => s.zoom);
  const format = useStore((s) => s.coordFormat);
  const online = useStore((s) => s.online);
  const caps = useStore((s) => s.capabilities);
  const elevation = useStore((s) => s.cursorElevation);

  return (
    <div className="status-pill glass statusbar" role="status">
      <span className="coords item" dir="ltr">
        {cursor ? formatCoordinates({ lon: cursor[0], lat: cursor[1] }, format) : '—'}
      </span>
      {caps?.terrain && (
        <span className="item" dir="ltr" title={t('status.elevation')}>
          <Mountain size={13} strokeWidth={2} aria-hidden />
          {cursor && elevation !== null ? `${Math.round(elevation).toLocaleString()} m` : '—'}
        </span>
      )}
      <span className="item" dir="ltr" title={t('status.zoom')}>
        z{zoom.toFixed(1)}
      </span>
      {caps && !caps.region && !caps.world && <span className="item warn">{t('status.noTiles')}</span>}
      <span className="item" title={online ? t('status.online') : t('status.offline')}>
        <span className={`status-dot ${online ? '' : 'off'}`} aria-hidden />
        {!online && t('status.offline')}
      </span>
    </div>
  );
}
