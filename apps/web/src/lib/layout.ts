import { hasControl, type DataCapabilities } from '@ai-map/shared';
import type { DrawTool, MeasureTool } from '../store';

export const DRAW_TOOLS: DrawTool[] = ['point', 'line', 'rectangle', 'polygon', 'circle', 'text', 'milsymbol'];
export const MEASURE_TOOLS: MeasureTool[] = ['distance', 'area', 'rings'];
export const TERRAIN_TOGGLES = ['hillshade', 'contours', '3d'] as const;
export const SETTINGS = ['unit', 'coords', 'theme'] as const;

export interface UiLayout {
  search: boolean;
  drawTools: DrawTool[];
  measureTools: MeasureTool[];
  terrainToggles: (typeof TERRAIN_TOGGLES)[number][];
  settings: (typeof SETTINGS)[number][];
  /** Map display options popover (terrain toggles and/or settings). */
  mapOptions: boolean;
  /** Any floating toolbar group is visible. */
  toolbar: boolean;
  layers: boolean;
  status: boolean;
  zoom: boolean;
  compass: boolean;
  scale: boolean;
  featurePanel: boolean;
  select: boolean;
  notices: boolean;
  /** Drawing actions (create/edit/delete, save measurement or search result) available to the user. */
  editable: boolean;
}

/** Decides which parts of the UI render, from visible controls, read-only mode and installed data. */
export function uiLayout(visible: ReadonlySet<string>, readonly: boolean, caps: DataCapabilities | null): UiLayout {
  const drawTools = readonly ? [] : DRAW_TOOLS.filter((t) => visible.has(`draw.${t}`));
  const measureTools = MEASURE_TOOLS.filter((t) => visible.has(`measure.${t}`));
  const terrainToggles = caps?.terrain ? TERRAIN_TOGGLES.filter((t) => visible.has(`terrain.${t}`)) : [];
  const settings = SETTINGS.filter((t) => visible.has(`settings.${t}`));
  const search = visible.has('search');
  return {
    search,
    drawTools,
    measureTools,
    terrainToggles,
    settings,
    mapOptions: terrainToggles.length > 0 || settings.length > 0,
    toolbar: drawTools.length > 0 || measureTools.length > 0 || terrainToggles.length > 0 || settings.length > 0,
    layers: hasControl(visible, 'layers'),
    status: visible.has('status'),
    zoom: visible.has('zoom'),
    compass: visible.has('compass'),
    scale: visible.has('scale'),
    featurePanel: visible.has('featurePanel'),
    select: visible.has('select'),
    notices: visible.has('notices'),
    editable: !readonly,
  };
}
