import ms from 'milsymbol';

export { milImageId, registerMilSymbolImages, MIL_IMAGE_PREFIX } from '@ai-map/sdk';

export function isValidSidc(sidc: string): boolean {
  if (!/^\d{20}(\d{10})?$/.test(sidc)) return false;
  return new ms.Symbol(sidc).isValid() === true;
}

export function symbolSvg(sidc: string, size = 40): string {
  return new ms.Symbol(sidc, { size }).asSVG();
}

/** MIL-STD-2525D/E SIDC builder options (subset covering common use). */
export const STANDARD_IDENTITIES = [
  { code: '3', key: 'friend' },
  { code: '6', key: 'hostile' },
  { code: '4', key: 'neutral' },
  { code: '1', key: 'unknown' },
  { code: '5', key: 'suspect' },
  { code: '2', key: 'assumedFriend' },
] as const;

export const SYMBOL_SETS = [
  { code: '10', key: 'landUnit' },
  { code: '15', key: 'landEquipment' },
  { code: '20', key: 'landInstallation' },
  { code: '01', key: 'air' },
  { code: '30', key: 'seaSurface' },
  { code: '35', key: 'seaSubsurface' },
] as const;

export const ENTITIES: Record<string, { code: string; label: string }[]> = {
  '10': [
    { code: '000000', label: 'Unspecified' },
    { code: '121100', label: 'Infantry' },
    { code: '120500', label: 'Armor' },
    { code: '130300', label: 'Field Artillery' },
    { code: '130100', label: 'Air Defense' },
    { code: '120100', label: 'Air Assault' },
    { code: '121000', label: 'Combined Arms' },
    { code: '140700', label: 'Engineer' },
    { code: '110000', label: 'Command and Control' },
    { code: '160600', label: 'Medical' },
    { code: '161300', label: 'Supply' },
    { code: '111000', label: 'Signal' },
    { code: '151000', label: 'Military Intelligence' },
    { code: '130700', label: 'Special Forces' },
  ],
  '15': [
    { code: '000000', label: 'Unspecified' },
    { code: '120100', label: 'Tank' },
    { code: '120200', label: 'Armored Personnel Carrier' },
    { code: '110300', label: 'Rocket Launcher' },
    { code: '111000', label: 'Howitzer' },
    { code: '130300', label: 'Truck' },
  ],
  '20': [
    { code: '000000', label: 'Unspecified' },
    { code: '120100', label: 'Airport / Air Base' },
    { code: '120800', label: 'Military Base' },
    { code: '111100', label: 'Headquarters' },
  ],
  '01': [
    { code: '000000', label: 'Unspecified' },
    { code: '110100', label: 'Fixed Wing' },
    { code: '110200', label: 'Rotary Wing' },
    { code: '110300', label: 'UAV' },
  ],
  '30': [
    { code: '000000', label: 'Unspecified' },
    { code: '120000', label: 'Surface Combatant' },
    { code: '140000', label: 'Non-Combatant' },
  ],
  '35': [
    { code: '000000', label: 'Unspecified' },
    { code: '110000', label: 'Submarine' },
  ],
};

export const ECHELONS = [
  { code: '00', label: '—' },
  { code: '11', label: 'Team' },
  { code: '12', label: 'Squad' },
  { code: '13', label: 'Section' },
  { code: '14', label: 'Platoon' },
  { code: '15', label: 'Company' },
  { code: '16', label: 'Battalion' },
  { code: '17', label: 'Regiment' },
  { code: '18', label: 'Brigade' },
  { code: '21', label: 'Division' },
  { code: '22', label: 'Corps' },
] as const;

/** 2525D SIDC: version(2) context(1) identity(1) set(2) status(1) hq(1) echelon(2) entity(6) mod1(2) mod2(2). */
export function buildSidc(p: { identity: string; set: string; status: '0' | '1'; hq: string; echelon: string; entity: string }): string {
  return `10${'0'}${p.identity}${p.set}${p.status}${p.hq}${p.echelon}${p.entity}0000`;
}

export function parseSidc(sidc: string) {
  return {
    identity: sidc.slice(3, 4),
    set: sidc.slice(4, 6),
    status: sidc.slice(6, 7) as '0' | '1',
    hq: sidc.slice(7, 8),
    echelon: sidc.slice(8, 10),
    entity: sidc.slice(10, 16),
  };
}
