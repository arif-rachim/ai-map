import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CoordFormat, DistanceUnit, ThemePreference } from '@ai-map/shared';
import { useStore } from '../store';
import i18n, { applyDirection } from '../i18n';
import { DRAW_ICONS, MEASURE_ICONS } from './icons';
import { IconButton, Popover, Row, Section, Segmented, Switch } from './ui';
import { useLayout } from './useLayout';

/** Floating toolbar: drawing tools, measuring tools, map display options (HIG: at most three groups). */
export function Toolbar() {
  const { t } = useTranslation();
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const layout = useLayout();
  if (!layout.toolbar) return null;

  const isActive = (type: 'draw' | 'measure', kind: string) => tool.type === type && tool.kind === kind;
  const toggle = (type: 'draw' | 'measure', kind: string) => setTool(isActive(type, kind) ? { type: 'none' } : ({ type, kind } as never));

  return (
    <div className="toolbar" role="toolbar" aria-label={t('tools.toolbar')}>
      {layout.drawTools.length > 0 && (
        <div className="tool-group glass" role="group" aria-label={t('tools.draw')}>
          {layout.drawTools.map((kind) => (
            <IconButton
              key={kind}
              icon={DRAW_ICONS[kind]}
              label={t(`tools.${kind}`)}
              active={isActive('draw', kind)}
              pressed={isActive('draw', kind)}
              control={`draw.${kind}`}
              onClick={() => toggle('draw', kind)}
            />
          ))}
        </div>
      )}
      {layout.measureTools.length > 0 && (
        <div className="tool-group glass" role="group" aria-label={t('tools.measure')}>
          {layout.measureTools.map((kind) => (
            <IconButton
              key={kind}
              icon={MEASURE_ICONS[kind]}
              label={t(`tools.${kind}`)}
              active={isActive('measure', kind)}
              pressed={isActive('measure', kind)}
              control={`measure.${kind}`}
              onClick={() => toggle('measure', kind)}
            />
          ))}
        </div>
      )}
      {layout.mapOptions && (
        <div className="tool-group glass">
          <Popover
            label={t('options.title')}
            width={300}
            trigger={({ open, toggle: toggleOpen }) => (
              <IconButton icon={SlidersHorizontal} label={t('options.title')} pressed={open} onClick={toggleOpen} className={`options-button ${open ? 'selected' : ''}`} />
            )}
          >
            <MapOptions />
          </Popover>
        </div>
      )}
    </div>
  );
}

function MapOptions() {
  const { t } = useTranslation();
  const s = useStore();
  const layout = useLayout();
  const has = (k: string) => (layout.settings as readonly string[]).includes(k);

  return (
    <div className="map-options">
      {layout.terrainToggles.length > 0 && (
        <Section title={t('terrain.group')} footer={layout.terrainToggles.includes('3d') ? t('terrain.tiltHint') : undefined}>
          {layout.terrainToggles.includes('hillshade') && (
            <Row label={t('terrain.hillshade')} control="terrain.hillshade">
              <Switch label={t('terrain.hillshade')} checked={s.hillshade} onChange={(v) => s.setTerrainOption('hillshade', v)} />
            </Row>
          )}
          {layout.terrainToggles.includes('contours') && (
            <Row label={t('terrain.contours')} control="terrain.contours">
              <Switch label={t('terrain.contours')} checked={s.contours} onChange={(v) => s.setTerrainOption('contours', v)} />
            </Row>
          )}
          {layout.terrainToggles.includes('3d') && (
            <Row label={t('terrain.terrain3d')} control="terrain.3d">
              <Switch label={t('terrain.terrain3d')} checked={s.terrain3d} onChange={(v) => s.setTerrainOption('terrain3d', v)} />
            </Row>
          )}
        </Section>
      )}

      {(has('theme') || has('labels') || has('ui')) && (
        <Section title={t('options.appearance')}>
          {has('theme') && (
            <Row label={t('settings.theme')} stacked control="settings.theme">
              <Segmented<ThemePreference>
                label={t('settings.theme')}
                value={s.theme}
                onChange={s.setTheme}
                options={[
                  { value: 'auto', label: t('settings.auto') },
                  { value: 'light', label: t('settings.light') },
                  { value: 'dark', label: t('settings.dark') },
                ]}
              />
            </Row>
          )}
          {has('labels') && (
            <Row label={t('settings.labels')} stacked control="settings.labels">
              <Segmented
                label={t('settings.labels')}
                value={s.labelLang}
                onChange={s.setLabelLang}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ar', label: 'العربية' },
                ]}
              />
            </Row>
          )}
          {has('ui') && (
            <Row label={t('settings.ui')} stacked control="settings.ui">
              <Segmented
                label={t('settings.ui')}
                value={s.uiLang}
                onChange={(lang) => {
                  s.setUiLang(lang);
                  applyDirection(lang);
                  void i18n.changeLanguage(lang);
                }}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ar', label: 'العربية' },
                ]}
              />
            </Row>
          )}
        </Section>
      )}

      {(has('unit') || has('coords')) && (
        <Section title={t('options.units')}>
          {has('unit') && (
            <Row label={t('settings.unit')} stacked control="settings.unit">
              <Segmented<DistanceUnit>
                label={t('settings.unit')}
                value={s.unit}
                onChange={s.setUnit}
                options={[
                  { value: 'km', label: 'km' },
                  { value: 'nm', label: 'NM' },
                  { value: 'mi', label: 'mi' },
                ]}
              />
            </Row>
          )}
          {has('coords') && (
            <Row label={t('settings.coords')} stacked control="settings.coords">
              <Segmented<CoordFormat>
                label={t('settings.coords')}
                value={s.coordFormat}
                onChange={s.setCoordFormat}
                options={[
                  { value: 'dd', label: 'DD' },
                  { value: 'dms', label: 'DMS' },
                  { value: 'mgrs', label: 'MGRS' },
                  { value: 'utm', label: 'UTM' },
                ]}
              />
            </Row>
          )}
        </Section>
      )}
    </div>
  );
}
