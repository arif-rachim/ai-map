import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';

/** Borderless symbol button (HIG: symbols without borders; the group provides the container). */
export function IconButton(props: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  size?: 'regular' | 'small';
  className?: string;
  control?: string;
  pressed?: boolean;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      className={['icon-button', props.size === 'small' && 'small', props.active && 'active', props.destructive && 'destructive', props.className].filter(Boolean).join(' ')}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      data-control={props.control}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Icon size={props.size === 'small' ? 16 : 18} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/** Text-only segmented control (HIG: nouns, equal widths, no mixing text and images). */
export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label} style={{ gridTemplateColumns: `repeat(${props.options.length}, 1fr)` }}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'selected' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={props.checked} aria-label={props.label} className={`switch ${props.checked ? 'on' : ''}`} onClick={() => props.onChange(!props.checked)}>
      <span className="knob" />
    </button>
  );
}

/** Inset grouped list section. */
export function Section(props: { title?: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${props.className ?? ''}`}>
      {props.title && <h3 className="section-title">{props.title}</h3>}
      <div className="section-body">{props.children}</div>
      {props.footer && <p className="section-footer">{props.footer}</p>}
    </section>
  );
}

export function Row(props: { label?: ReactNode; children?: ReactNode; stacked?: boolean; control?: string; className?: string }) {
  return (
    <div className={`row ${props.stacked ? 'stacked' : ''} ${props.className ?? ''}`} data-control={props.control}>
      {props.label !== undefined && <span className="row-label">{props.label}</span>}
      {props.children !== undefined && <div className="row-value">{props.children}</div>}
    </div>
  );
}

/**
 * Popover anchored to its trigger (HIG: one at a time, closes on outside click / Esc, small amount of functionality).
 * Rendered in a portal so it is never clipped by glass containers.
 */
export function Popover(props: {
  trigger: (p: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLDivElement | null> }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  width?: number;
  className?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const id = useId();
  const width = props.width ?? 300;

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const rtl = document.documentElement.dir === 'rtl';
      const alignEnd = (props.align ?? 'end') === 'end' ? !rtl : rtl;
      const left = alignEnd ? r.right - width : r.left;
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(innerWidth - width - 8, left)) });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [open, props.align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <>
      <div ref={anchor} className="popover-anchor" aria-controls={id}>
        {props.trigger({ open, toggle: () => setOpen((o) => !o), ref: anchor })}
      </div>
      {open &&
        pos &&
        createPortal(
          <div ref={pop} id={id} role="dialog" aria-label={props.label} className={`popover glass ${props.className ?? ''}`} style={{ top: pos.top, left: pos.left, width }}>
            {typeof props.children === 'function' ? props.children(close) : props.children}
          </div>,
          document.querySelector('.app') ?? document.body,
        )}
    </>
  );
}

/** Centered alert (HIG: destructive actions in red, never the default; Cancel always available). */
export function AlertDialog() {
  const { t } = useTranslation();
  const dialog = useStore((s) => s.dialog);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialog) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useStore.getState().closeDialog(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog]);

  if (!dialog) return null;
  const close = (ok: boolean) => useStore.getState().closeDialog(ok);
  return (
    <div className="alert-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="alert glass" role="alertdialog" aria-modal="true" aria-labelledby="alert-title">
        <h2 id="alert-title">{dialog.title}</h2>
        {dialog.message && <p>{dialog.message}</p>}
        <div className="alert-actions">
          <button ref={cancelRef} type="button" className="alert-button" onClick={() => close(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className={`alert-button ${dialog.destructive ? 'destructive' : 'default'}`} onClick={() => close(true)}>
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
