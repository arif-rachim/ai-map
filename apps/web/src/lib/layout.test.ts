import { describe, expect, it } from 'vitest';
import { resolveControls, type DataCapabilities } from '@ai-map/shared';
import { uiLayout } from './layout';

const caps = (terrain: boolean): DataCapabilities => ({ region: true, world: true, terrain, terrainMaxzoom: terrain ? 12 : null, terrainBounds: null, geocoder: true });

describe('uiLayout', () => {
  it('shows everything by default', () => {
    const l = uiLayout(resolveControls(undefined), false, caps(true));
    expect(l.drawTools).toHaveLength(7);
    expect(l.measureTools).toEqual(['distance', 'area', 'rings']);
    expect(l.terrainToggles).toEqual(['hillshade', 'contours', '3d']);
    expect(l).toMatchObject({ search: true, toolbar: true, mapOptions: true, layers: true, status: true, zoom: true, compass: true, scale: true, featurePanel: true, select: true, notices: true, editable: true });
  });

  it('renders nothing for a pure map', () => {
    const l = uiLayout(resolveControls(['none']), false, caps(true));
    expect(Object.entries(l).filter(([k, v]) => k !== 'editable' && (v === true || (Array.isArray(v) && v.length > 0)))).toEqual([]);
  });

  it('hides drawing tools when read-only, and the toolbar when nothing else is in it', () => {
    const l = uiLayout(resolveControls(['draw']), true, caps(true));
    expect(l.drawTools).toEqual([]);
    expect(l.toolbar).toBe(false);
    expect(l.editable).toBe(false);
  });

  it('never shows terrain toggles without terrain data, so the toolbar stays empty', () => {
    const l = uiLayout(resolveControls(['terrain']), false, caps(false));
    expect(l.terrainToggles).toEqual([]);
    expect(l.mapOptions).toBe(false);
    expect(l.toolbar).toBe(false);
  });

  it('keeps individual leaves and settings', () => {
    const l = uiLayout(resolveControls(['draw.point', 'draw.polygon', 'settings.unit', 'zoom']), false, caps(true));
    expect(l.drawTools).toEqual(['point', 'polygon']);
    expect(l.settings).toEqual(['unit']);
    expect(l.mapOptions).toBe(true);
    expect(l).toMatchObject({ zoom: true, compass: false, scale: false, search: false });
  });
});
