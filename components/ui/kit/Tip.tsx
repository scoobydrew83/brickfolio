'use client';
import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';

const FOCUSABLE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
/** As TooltipProvider's `delay` in AppShell: a hover opens the tip after this long. */
const HOVER_DELAY = 400;

/**
 * A short tooltip on a control or a cut-off value: `<Tip label="…">{child}</Tip>`. Shows on hover, on keyboard focus
 * and on a tap (touch screens never fire hover); hides on the next tap, Escape or scroll. The tap still reaches the
 * child, so a button's or link's own action runs. Never covers the child: it sits above it (or flips below), clear of it.
 *
 * - A plain element (`<span>`, `<p>`) is made focusable (`tabIndex={0}`); buttons, links and components are left alone.
 * - The label is also given to screen readers as the child's description, unless it is already the child's `aria-label`
 *   or its text
 *   (`describe={false}` when the child's name already says it, e.g. visually hidden text).
 * - No label (`undefined`, `''`): renders the child as it is, so a conditional tip needs no branch.
 *
 * - `whenCut`: for a value that is only sometimes cut off (`truncate`, `line-clamp`): opens only while the child overflows,
 *   so it doesn't repeat text that is fully visible.
 *
 * `className` styles the tip (e.g. `lg:hidden` where the label is visible from that width).
 * Works without a TooltipProvider (pages outside AppShell); the provider only makes neighbouring tips open instantly.
 */
export function Tip({ label, side = 'top', className, describe: describeProp, whenCut = false, children }: { label: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string; describe?: boolean; whenCut?: boolean; children: React.ReactElement<Record<string, unknown>> }) {
  const [open, setOpenState] = React.useState(false);
  // A native modal <dialog> (our Dialog) is in the top layer and makes the rest inert: render in it. (The phone menu is
  // a Base UI sheet, not a <dialog>: the tip portals to <body> after it and shows above it.)
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  const trigger = React.useRef<HTMLButtonElement>(null); // any element; typed as the default button
  const touch = React.useRef(false);
  const id = React.useId();
  const ownId = children.props.id;
  const triggerId = typeof ownId === 'string' ? ownId : `${id}t`; // a controlled tooltip needs to know its trigger
  const setOpen = (next: boolean) => {
    const el = trigger.current;
    if (next && whenCut && el && el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
    if (next) setContainer(trigger.current?.closest('dialog') ?? null);
    setOpenState(next);
  };

  // Hide on scroll: a tip opened by a tap has no pointer to leave.
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpenState(false);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', close, { capture: true });
  }, [open]);

  // Lazy: until first used, render only the child. A table of 500 sets would otherwise mount 500 tooltips, which made
  // switching to the table and sorting it noticeably slower. Mounting the tooltip remounts the child, so it arms on a
  // mouse hover (nothing in flight), on keyboard focus (focus is put back) and after a tap's click (the child's own
  // action has already run).
  const [armed, setArmed] = React.useState(false);
  const after = React.useRef<'hover' | 'focus' | 'tap' | null>(null);
  React.useEffect(() => {
    if (!armed || !after.current) return;
    const el = trigger.current;
    const how = after.current;
    after.current = null;
    if (how === 'focus') { el?.focus(); setOpen(true); return; }
    // A tap shows the tip, unless it opened a dialog or otherwise moved focus on. Mounting the tooltip dropped the
    // element's focus (focus is on <body>); a dialog the tap opened may take focus a frame later, so look then.
    if (how === 'tap') {
      const f = requestAnimationFrame(() => {
        if (document.activeElement !== document.body && !el?.contains(document.activeElement)) return;
        el?.focus();
        touch.current = true;
        setOpen(true);
      });
      return () => cancelAnimationFrame(f);
    }
    const t = setTimeout(() => { if (el?.matches(':hover')) setOpen(true); }, HOVER_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, right after the tooltip mounts
  }, [armed]);

  if (label == null || label === false || label === '') return children;

  const plain = typeof children.type === 'string' && !FOCUSABLE.has(children.type) && children.props.tabIndex == null;
  const describe = describeProp ?? (children.props['aria-label'] !== label && children.props.children !== label);

  if (!armed) {
    const own = children.props as { tabIndex?: number; 'aria-describedby'?: string; onPointerEnter?: (e: React.PointerEvent) => void; onPointerDown?: (e: React.PointerEvent) => void; onFocus?: (e: React.FocusEvent) => void; onClick?: (e: React.MouseEvent) => void };
    return (
      <>
        <Idle
          describedBy={describe ? id : own['aria-describedby']}
          tabIndex={plain ? 0 : own.tabIndex}
          onArm={(how) => { after.current = how; setArmed(true); }}
          touch={touch}
        >{children}</Idle>
        {describe && <span id={id} hidden>{label}</span>}
      </>
    );
  }

  return (
    <>
      <Tooltip
        open={open}
        triggerId={triggerId}
        onOpenChange={(next, details) => {
          // A tap toggles the tip (below). The tap's own press and its emulated mouse events would close it again at once.
          if (touch.current && !next && (details.reason === 'trigger-press' || details.reason === 'trigger-hover')) return;
          if (!next) touch.current = false;
          setOpen(next);
        }}
      >
        <TooltipTrigger
          ref={trigger}
          id={triggerId}
          render={children}
          tabIndex={plain ? 0 : undefined}
          aria-describedby={describe ? id : undefined}
          onPointerDown={(e: React.PointerEvent) => { touch.current = e.pointerType === 'touch' || e.pointerType === 'pen'; }}
          onClick={() => { if (touch.current) setOpen(!open); }}
        />
        <TooltipContent side={side} className={className} container={container ?? undefined}>{label}</TooltipContent>
      </Tooltip>
      {describe && <span id={id} hidden>{label}</span>}
    </>
  );
}

/** The child before its tooltip is first needed: hands the first hover, keyboard focus or tap to `onArm`. */
function Idle({ children, describedBy, tabIndex, onArm, touch }: { children: React.ReactElement<Record<string, unknown>>; describedBy?: string; tabIndex?: number; onArm: (how: 'hover' | 'focus' | 'tap' | null) => void; touch: React.RefObject<boolean> }) {
  const own = children.props as { onPointerEnter?: (e: React.PointerEvent) => void; onPointerDown?: (e: React.PointerEvent) => void; onFocus?: (e: React.FocusEvent) => void; onClick?: (e: React.MouseEvent) => void };
  const onPointerEnter = (e: React.PointerEvent) => { own.onPointerEnter?.(e); if (e.pointerType === 'mouse') onArm('hover'); };
  const onPointerDown = (e: React.PointerEvent) => { own.onPointerDown?.(e); touch.current = e.pointerType === 'touch' || e.pointerType === 'pen'; };
  const onFocus = (e: React.FocusEvent) => { own.onFocus?.(e); if ((e.currentTarget as HTMLElement).matches(':focus-visible')) onArm('focus'); };
  const onClick = (e: React.MouseEvent) => { own.onClick?.(e); if (touch.current) onArm(e.currentTarget.contains(document.activeElement) ? 'tap' : null); };
  return React.cloneElement(children, { tabIndex, 'aria-describedby': describedBy, onPointerEnter, onPointerDown, onFocus, onClick });
}
