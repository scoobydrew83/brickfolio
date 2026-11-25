'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Toaster } from '../sonner';

export { toast } from 'sonner';

const SM = '(min-width: 640px)';
const subscribe = (fn: () => void) => { const m = window.matchMedia(SM); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); };

/**
 * Short "it worked" messages (Saved, Added …, Removed …, Copied). Errors and anything to read or copy stay inline
 * as a Banner. Bottom-centre on phones, bottom-right from 640px, clear of the safe areas.
 *
 * Native modal <dialog>s (our Dialog) sit in the browser's top layer, above any z-index. So the toaster lives in the
 * top layer too, as a manual popover, and steps back on top whenever a dialog opens. That also keeps it above the phone
 * menu (a Base UI sheet at z-50).
 */
export function ToastHost() {
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(SM).matches, () => false);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = layer.current;
    if (!el || typeof el.showPopover !== 'function') return;
    const raise = () => { try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch { /* not supported */ } };
    raise();
    const watch = new MutationObserver((records) => {
      if (records.some((r) => r.target instanceof HTMLDialogElement && r.target.open)) raise();
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={layer} popover="manual" className="pointer-events-none m-0 size-0 overflow-visible border-0 bg-transparent p-0 [&_[data-sonner-toast]]:pointer-events-auto">
      <Toaster
        position={wide ? 'bottom-right' : 'bottom-center'}
        offset={{ bottom: 'calc(24px + env(safe-area-inset-bottom))', right: 'calc(24px + env(safe-area-inset-right))', left: 'calc(24px + env(safe-area-inset-left))' }}
        mobileOffset={{ bottom: 'calc(16px + env(safe-area-inset-bottom))', right: 'calc(16px + env(safe-area-inset-right))', left: 'calc(16px + env(safe-area-inset-left))' }}
        containerAriaLabel="Notifications"
      />
    </div>
  );
}
