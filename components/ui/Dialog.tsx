'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from './primitives';

type Props = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  size?: 'md' | 'lg';
  /** Fixed height for long scrolling content such as parts lists. */
  tall?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Modal built on the native <dialog>: focus is trapped, Escape closes it, and the page behind is inert.
 * The body scrolls; the header and footer stay put.
 */
export function Dialog({ title, subtitle, onClose, size = 'md', tall, footer, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={typeof title === 'string' ? title : undefined}
      className={cx('m-auto w-full rounded-card p-0 shadow-raised backdrop:bg-black/50', size === 'md' ? 'max-w-md' : 'max-w-lg', tall && 'h-[85dvh]')}
    >
      <div className="flex h-full max-h-[90dvh] flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-fg-3">{subtitle}</p>}
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="-m-1 rounded-control p-1 text-fg-3 hover:bg-muted hover:text-fg">
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </dialog>
  );
}
