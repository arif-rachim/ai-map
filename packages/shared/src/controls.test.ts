import { describe, expect, it } from 'vitest';
import { ALL_CONTROLS, hasControl, resolveControls, unknownControls } from './controls';

describe('resolveControls', () => {
  it('defaults to everything and supports a pure map', () => {
    expect([...resolveControls(undefined)]).toEqual([...ALL_CONTROLS]);
    expect(resolveControls([]).size).toBe(0);
    expect(resolveControls(['none']).size).toBe(0);
  });

  it('expands groups and keeps individual leaves', () => {
    const v = resolveControls(['draw', 'measure.distance', 'zoom']);
    expect([...v]).toEqual(['draw.point', 'draw.line', 'draw.rectangle', 'draw.polygon', 'draw.circle', 'draw.text', 'draw.milsymbol', 'measure.distance', 'zoom']);
    expect(hasControl(v, 'draw')).toBe(true);
    expect(hasControl(v, 'measure')).toBe(true);
    expect(hasControl(v, 'terrain')).toBe(false);
  });

  it('applies exclusions, starting from all when the list begins with one', () => {
    const v = resolveControls(['-draw', '-status']);
    expect(v.has('draw.point')).toBe(false);
    expect(v.has('status')).toBe(false);
    expect(v.has('search')).toBe(true);
    expect([...resolveControls(['all', '-draw.text'])]).toHaveLength(ALL_CONTROLS.length - 1);
    expect([...resolveControls(['draw', '-draw.milsymbol'])]).toHaveLength(6);
  });

  it('ignores unknown names but reports them', () => {
    expect([...resolveControls(['zoom', 'bogus', 'draw.hexagon'])]).toEqual(['zoom']);
    expect(unknownControls(['zoom', '-bogus', 'draw.hexagon', 'all', 'none'])).toEqual(['bogus', 'draw.hexagon']);
  });
});
