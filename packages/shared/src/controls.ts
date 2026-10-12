/**
 * UI controls of the map app that an embedding page can show or hide.
 * Groups expand to their children; leaves are the individual buttons/widgets.
 */
export const CONTROL_GROUPS = {
  search: [],
  draw: ['draw.point', 'draw.line', 'draw.rectangle', 'draw.polygon', 'draw.circle', 'draw.text', 'draw.milsymbol'],
  measure: ['measure.distance', 'measure.area', 'measure.rings'],
  terrain: ['terrain.hillshade', 'terrain.contours', 'terrain.3d'],
  settings: ['settings.unit', 'settings.coords', 'settings.theme'],
  layers: [],
  status: [],
  zoom: [],
  compass: [],
  scale: [],
  /** Details panel of the selected drawing. */
  featurePanel: [],
  /** Clicking a drawing selects it. */
  select: [],
  /** Toast messages (errors, conflicts). */
  notices: [],
} as const satisfies Record<string, readonly string[]>;

export type ControlGroup = keyof typeof CONTROL_GROUPS;

/** Every leaf control id: groups without children are leaves themselves. */
export const ALL_CONTROLS: readonly string[] = Object.entries(CONTROL_GROUPS).flatMap(([group, children]) =>
  children.length ? [...children] : [group],
);

function expand(token: string): string[] {
  if (token === 'all') return [...ALL_CONTROLS];
  if (token in CONTROL_GROUPS) {
    const children = CONTROL_GROUPS[token as ControlGroup];
    return children.length ? [...children] : [token];
  }
  return ALL_CONTROLS.includes(token) ? [token] : [];
}

/**
 * Resolves a control list into the set of visible leaf controls.
 * - `undefined` → everything (default)
 * - `none` or an empty list → nothing (pure map)
 * - group names expand (`draw` → all drawing tools); leaves select one (`draw.point`)
 * - `-name` removes (`all,-draw.text,-status`); a list starting with `-` starts from `all`
 * Unknown names are ignored.
 */
export function resolveControls(list: readonly string[] | undefined): Set<string> {
  if (list === undefined) return new Set(ALL_CONTROLS);
  const tokens = list.map((t) => t.trim()).filter(Boolean);
  const result = new Set<string>(tokens[0]?.startsWith('-') ? ALL_CONTROLS : []);
  for (const t of tokens) {
    if (t === 'none') result.clear();
    else if (t.startsWith('-')) for (const c of expand(t.slice(1))) result.delete(c);
    else for (const c of expand(t)) result.add(c);
  }
  return result;
}

/** True if the control, or for a group any of its children, is visible. */
export function hasControl(visible: ReadonlySet<string>, name: string): boolean {
  return expand(name).some((c) => visible.has(c));
}

export function unknownControls(list: readonly string[]): string[] {
  return list
    .map((t) => t.trim().replace(/^-/, ''))
    .filter((t) => t && t !== 'all' && t !== 'none' && expand(t).length === 0);
}
