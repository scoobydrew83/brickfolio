'use client';
import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../alert-dialog';
import { Loader2 } from 'lucide-react';

export type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  /** The confirm button's label: say what happens ("Delete", "Revoke"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for anything that loses data: a red confirm button, and focus starts on Cancel. */
  tone?: 'danger' | 'default';
};

/**
 * A native modal <dialog> (our Dialog) makes everything outside it inert, so a confirmation asked from inside one is
 * rendered inside it.
 */
function topDialog(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => { try { return d.matches(':modal'); } catch { return false; } });
  return open.at(-1) ?? null;
}

/** The dialog both APIs share. `onConfirm` may be async: the button spins until it settles, then the dialog closes. */
function ConfirmDialog({ open, container, options: o, onOpenChange, onConfirm, trigger }: {
  open: boolean;
  container: HTMLElement | null;
  options: ConfirmOptions;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => unknown;
  trigger?: React.ReactNode;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const danger = o.tone === 'danger';
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); onOpenChange(false); }
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      {trigger}
      <AlertDialogContent container={container ?? undefined} initialFocus={danger ? cancel : true}>
        <AlertDialogHeader>
          <AlertDialogTitle>{o.title}</AlertDialogTitle>
          {o.body && <AlertDialogDescription>{o.body}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel} disabled={busy}>{o.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction variant={danger ? 'danger' : 'primary'} disabled={busy} aria-busy={busy || undefined} onClick={confirm}>
            {busy && <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
            {o.confirmLabel ?? 'OK'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Asks before an action: `<Confirm title="Delete set?" body="…" confirmLabel="Delete" tone="danger" onConfirm={…}>{trigger}</Confirm>`.
 * The child (usually a Button or IconButton) opens the dialog instead of acting.
 */
export function Confirm({ children, onConfirm, ...options }: ConfirmOptions & { onConfirm: () => unknown; children: React.ReactElement<{ onClick?: React.MouseEventHandler }> }) {
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const trigger = isValidElement(children)
    ? cloneElement(children, { onClick: (e: React.MouseEvent) => { children.props.onClick?.(e); if (!e.defaultPrevented) { setContainer(topDialog()); setOpen(true); } } })
    : children;
  return <ConfirmDialog open={open} container={container} options={options} onOpenChange={setOpen} onConfirm={onConfirm} trigger={trigger} />;
}

type Request = ConfirmOptions & { resolve: (ok: boolean) => void; container: HTMLElement | null };
let ask: ((r: Request) => void) | null = null;

/**
 * For event handlers: `if (await confirmAction({ title: 'Clear the list?', confirmLabel: 'Clear', tone: 'danger' })) clear();`.
 * Resolves true on confirm, false on Cancel, Escape or a tap outside. Needs <ConfirmHost /> mounted (the root layout does).
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ask) { resolve(false); return; }
    ask({ ...options, resolve, container: topDialog() });
  });
}

/** Renders the dialogs confirmAction() asks for. Mount once. */
export function ConfirmHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const result = useRef(false);
  useEffect(() => {
    ask = (r) => {
      setReq((prev) => { prev?.resolve(false); return r; });
      result.current = false;
      setOpen(true);
    };
    return () => { ask = null; };
  }, []);
  if (!req) return null;
  return (
    <ConfirmDialog
      open={open}
      container={req.container}
      options={req}
      onConfirm={() => { result.current = true; }}
      onOpenChange={(next) => {
        if (next) return;
        setOpen(false);
        req.resolve(result.current);
      }}
    />
  );
}
