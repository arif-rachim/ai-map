import { useMemo } from 'react';
import { uiLayout, type UiLayout } from '../lib/layout';
import { useStore } from '../store';

export function useLayout(): UiLayout {
  const controls = useStore((s) => s.controls);
  const readonly = useStore((s) => s.readonly);
  const caps = useStore((s) => s.capabilities);
  return useMemo(() => uiLayout(controls, readonly, caps), [controls, readonly, caps]);
}
