import { useMemo } from 'react';
import { uiLayout, type UiLayout } from '../lib/layout';
import { canEdit, useStore } from '../store';

export function useLayout(): UiLayout {
  const controls = useStore((s) => s.controls);
  const readonly = !useStore(canEdit);
  const caps = useStore((s) => s.capabilities);
  return useMemo(() => uiLayout(controls, readonly, caps), [controls, readonly, caps]);
}
