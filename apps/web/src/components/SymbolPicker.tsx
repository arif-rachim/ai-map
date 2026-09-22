import { useTranslation } from 'react-i18next';
import { buildSidc, ECHELONS, ENTITIES, isValidSidc, parseSidc, STANDARD_IDENTITIES, SYMBOL_SETS, symbolSvg } from '../lib/milsymbol';
import { Row, Switch } from './ui';

/** MIL-STD-2525D/E symbol builder rendered as grouped-list rows (place inside a Section). */
export function SymbolPicker({ sidc, onChange }: { sidc: string; onChange: (sidc: string) => void }) {
  const { t } = useTranslation();
  const valid = isValidSidc(sidc);
  const p = parseSidc(sidc.padEnd(20, '0'));
  const update = (patch: Partial<typeof p>) => {
    const next = { ...p, ...patch };
    if (patch.set && !ENTITIES[patch.set]?.some((e) => e.code === next.entity)) next.entity = '000000';
    onChange(buildSidc(next));
  };
  const entities = ENTITIES[p.set] ?? [];

  return (
    <div className="symbol-picker">
      <Row>
        <div className="symbol-preview" dir="ltr" style={{ width: '100%' }}>
          {valid ? <span dangerouslySetInnerHTML={{ __html: symbolSvg(sidc, 48) }} /> : <span className="warn">{t('mil.invalid')}</span>}
        </div>
      </Row>
      <Row label={t('mil.identity')}>
        <select value={p.identity} aria-label={t('mil.identity')} onChange={(e) => update({ identity: e.target.value })}>
          {STANDARD_IDENTITIES.map((o) => (
            <option key={o.code} value={o.code}>
              {t(`mil.${o.key}`)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('mil.set')}>
        <select value={p.set} aria-label={t('mil.set')} onChange={(e) => update({ set: e.target.value })}>
          {SYMBOL_SETS.map((o) => (
            <option key={o.code} value={o.code}>
              {t(`mil.${o.key}`)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('mil.entity')}>
        <select value={p.entity} aria-label={t('mil.entity')} onChange={(e) => update({ entity: e.target.value })}>
          {!entities.some((e) => e.code === p.entity) && <option value={p.entity}>{p.entity}</option>}
          {entities.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {p.set === '10' && (
        <Row label={t('mil.echelon')}>
          <select value={p.echelon} aria-label={t('mil.echelon')} onChange={(e) => update({ echelon: e.target.value })}>
            {ECHELONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label={t('mil.status')}>
        <select value={p.status} aria-label={t('mil.status')} onChange={(e) => update({ status: e.target.value as '0' | '1' })}>
          <option value="0">{t('mil.present')}</option>
          <option value="1">{t('mil.planned')}</option>
        </select>
      </Row>
      <Row label={t('mil.hq')}>
        <Switch label={t('mil.hq')} checked={p.hq === '2'} onChange={(v) => update({ hq: v ? '2' : '0' })} />
      </Row>
      <Row label={t('mil.sidc')} stacked>
        <input dir="ltr" value={sidc} maxLength={30} aria-label={t('mil.sidc')} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} className={valid ? '' : 'invalid'} />
      </Row>
    </div>
  );
}
