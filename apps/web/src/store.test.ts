import { beforeEach, describe, expect, it } from 'vitest';
import { resolveControls } from '@ai-map/shared';
import { detectEmbed, useStore } from './store';

describe('detectEmbed', () => {
  it('parses parameters only on /embed', () => {
    expect(detectEmbed({ pathname: '/', search: '?controls=none' })).toEqual({ enabled: false, params: {} });
    const e = detectEmbed({ pathname: '/embed/', search: '?controls=none&theme=auto&unit=nm' });
    expect(e.enabled).toBe(true);
    expect(e.params).toMatchObject({ controls: ['none'], theme: 'auto', unit: 'nm' });
  });
});

describe('store', () => {
  beforeEach(() => {
    useStore.setState({ controls: resolveControls(undefined), readonly: false, tool: { type: 'none' }, editingId: null, selectedId: null, dialog: null });
  });

  it('stops a tool whose button gets hidden or when switching to read-only', () => {
    const s = useStore.getState();
    s.setTool({ type: 'draw', kind: 'point' });
    s.setControls(resolveControls(['draw.polygon']));
    expect(useStore.getState().tool).toEqual({ type: 'none' });

    s.setTool({ type: 'measure', kind: 'distance' });
    s.setControls(resolveControls(['measure']), true);
    expect(useStore.getState().tool).toEqual({ type: 'measure', kind: 'distance' });
    expect(useStore.getState().readonly).toBe(true);

    s.setTool({ type: 'draw', kind: 'line' });
    useStore.setState({ editingId: 'x' });
    s.setControls(resolveControls(undefined), true);
    expect(useStore.getState()).toMatchObject({ tool: { type: 'none' }, editingId: null });
  });

  it('clears the selection when neither selecting nor the feature panel is available', () => {
    useStore.setState({ selectedId: 'f1' });
    useStore.getState().setControls(resolveControls(['search']));
    expect(useStore.getState().selectedId).toBeNull();
  });

  it('resolves the theme preference', () => {
    const s = useStore.getState();
    s.setTheme('dark');
    expect(useStore.getState().resolvedTheme).toBe('dark');
    s.setTheme('light');
    expect(useStore.getState().resolvedTheme).toBe('light');
    s.setTheme('auto');
    expect(['light', 'dark']).toContain(useStore.getState().resolvedTheme);
  });

  it('confirm dialogs resolve with the user choice and a new dialog cancels the previous one', async () => {
    const s = useStore.getState();
    const first = s.confirm({ title: 'A', confirmLabel: 'OK' });
    const second = s.confirm({ title: 'B', confirmLabel: 'OK', destructive: true });
    await expect(first).resolves.toBe(false);
    expect(useStore.getState().dialog?.title).toBe('B');
    useStore.getState().closeDialog(true);
    await expect(second).resolves.toBe(true);
    expect(useStore.getState().dialog).toBeNull();
  });
});
