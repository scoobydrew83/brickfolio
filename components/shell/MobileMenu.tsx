'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Search, UserRound, X } from 'lucide-react';
import { cx } from '../ui';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '../ui/sheet';
import { isActive, navLinks, type NavLink } from '../Nav';
import { ThemeToggle } from './ThemeToggle';
import { OPEN_SEARCH } from './CommandPalette';

type Props = { alerts?: number; update?: boolean; admin?: boolean; account?: boolean };

/**
 * Phones: a menu button in the header opening a side panel with every page (replaces the bottom tab bar, which ran
 * out of room at eight pages). shadcn's `sheet` from the right (Base UI dialog): focus stays inside, Escape and a tap
 * outside close it, and it closes on navigation. The button carries a dot when the wishlist has alerts or an update is out.
 */
export function MobileMenu({ alerts = 0, update = false, admin = true, account = false }: Props) {
  const [open, setOpen] = useState(false);
  // Leaving for the command palette: don't put focus back on the menu button (it would take it from the palette), and
  // open the palette once the sheet has closed.
  const toSearch = useRef(false);
  const path = usePathname();
  const links = navLinks(admin);
  const close = () => setOpen(false);

  // A link to the page you're on doesn't navigate: close on any tap of a link, and on route changes too.
  // (Adjusted while rendering, not in an effect: https://react.dev/learn/you-might-not-need-an-effect.)
  const [shownPath, setShownPath] = useState(path);
  if (path !== shownPath) { setShownPath(path); setOpen(false); }
  // From 640px the panel is hidden (sm:hidden) but the modal sheet would still block the page: close it when the
  // screen gets that wide (a phone turned to landscape, a window resized).
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 640px)');
    const onChange = () => { if (wide.matches) setOpen(false); };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  const row = ([href, label, Icon]: NavLink) => {
    const active = isActive(path, href);
    const badge = href === '/wishlist' && alerts > 0 ? alerts : 0;
    const dot = update && href === '/settings';
    return (
      <li key={href}>
        <Link
          href={href}
          onClick={close}
          aria-current={active ? 'page' : undefined}
          className={cx('flex items-center gap-3 rounded-control px-3 py-2.5 font-medium', active ? 'bg-primary text-on-primary' : 'text-fg hover:bg-muted')}
        >
          <Icon aria-hidden className="size-5" />
          <span className="flex-1">{label}</span>
          {badge > 0 && <span className={cx('rounded-full px-1.5 text-xs font-bold tabular-nums', active ? 'bg-header text-on-header-strong' : 'bg-primary text-on-primary')}>{badge}<span className="sr-only"> under target</span></span>}
          {dot && <span className={cx('size-2 rounded-full', active ? 'bg-header' : 'bg-primary')}><span className="sr-only">Update available</span></span>}
        </Link>
      </li>
    );
  };
  const store = links.filter(([href]) => href === '/store' || href === '/orders');
  const main = links.filter(([href]) => !store.some(([h]) => h === href) && href !== '/settings');
  const settings = links.filter(([href]) => href === '/settings');

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => { if (o) toSearch.current = false; setOpen(o); }}
      // toSearch stays set until the menu next opens: finalFocus reads it as the sheet unmounts, after this runs.
      onOpenChangeComplete={(o) => { if (!o && toSearch.current) window.dispatchEvent(new Event(OPEN_SEARCH)); }}
    >
      <SheetTrigger
        aria-label={`Menu${alerts > 0 ? `, ${alerts} wishlist alert${alerts === 1 ? '' : 's'}` : ''}${update ? ', update available' : ''}`}
        className="relative -my-1 flex size-9 shrink-0 items-center justify-center rounded-control text-on-header hover:bg-header-hover hover:text-on-header-strong sm:hidden"
      >
        <Menu aria-hidden className="size-5" />
        {(alerts > 0 || update) && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-header" />}
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-label="Menu"
        finalFocus={() => !toSearch.current}
        className="gap-0 p-0 text-base data-[side=right]:h-dvh data-[side=right]:w-[min(20rem,85vw)] data-[side=right]:border-l-0 sm:hidden"
      >
        <nav aria-label="Pages" className="flex h-full flex-col overflow-y-auto px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-center justify-between px-3">
            <span className="font-semibold">Menu</span>
            <SheetClose aria-label="Close menu" className="-mr-2 rounded-control p-2 text-fg-3 hover:bg-muted hover:text-fg">
              <X aria-hidden className="size-5" />
            </SheetClose>
          </div>
          {/* The command palette (#107): on phones it opens from here, so the header keeps its two buttons. */}
          <button
            type="button"
            onClick={() => { toSearch.current = true; close(); }}
            className="mb-3 flex w-full items-center gap-3 rounded-control border border-line-strong px-3 py-2.5 text-left text-fg-3 hover:bg-muted hover:text-fg"
          >
            <Search aria-hidden className="size-5" />
            <span className="flex-1">Search</span>
          </button>
          <ul className="space-y-0.5">{main.map(row)}</ul>
          {store.length > 0 && (
            <>
              <p className="mt-5 mb-1 px-3 text-xs text-fg-3">Your BrickLink store</p>
              <ul className="space-y-0.5">{store.map(row)}</ul>
            </>
          )}
          <ul className="mt-5 space-y-0.5 border-t border-line pt-3">
            {settings.map(row)}
            {account && row(['/account', 'Your account', UserRound])}
          </ul>
          <div className="mt-auto flex items-center justify-between border-t border-line px-3 pt-3 text-sm text-fg-3">
            Theme
            <ThemeToggle tone="surface" />
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
