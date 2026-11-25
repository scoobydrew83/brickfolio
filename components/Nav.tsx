'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, Heart, LayoutGrid, Puzzle, Radar, Receipt, Settings, Store, type LucideIcon } from 'lucide-react';
import { Tip } from './ui';

/** Every top-level page: [href, label, icon]. Store and Orders are an admin's BrickLink business (#50). */
export const LINKS = [
  ['/', 'Sets', Boxes],
  ['/wishlist', 'Wishlist', Heart],
  ['/radar', 'Radar', Radar],
  ['/parts', 'Parts', Puzzle],
  ['/layouts', 'Layouts', LayoutGrid],
  ['/store', 'Store', Store],
  ['/orders', 'Orders', Receipt],
  ['/settings', 'Settings', Settings],
] as const;
export type NavLink = readonly [href: string, label: string, icon: LucideIcon];
export const navLinks = (admin: boolean): readonly NavLink[] => (admin ? LINKS : LINKS.filter(([href]) => href !== '/store' && href !== '/orders'));

export const isActive = (path: string, href: string) =>
  href === '/' ? path === '/' || path.startsWith('/sets/') || path.startsWith('/minifigs') || path.startsWith('/scan') : href === '/parts' ? path.startsWith('/parts') || path.startsWith('/build') : path.startsWith(href);

/** Top-level page links in the header from 640px. Phones use the menu button instead (shell/MobileMenu). */
/** `alerts` = wishlist sets under target, shown as a count on the Wishlist link; `update` = a newer release is out (a dot on Settings). */
/** `admin` (#50): Store and Orders (your BrickLink store's business) are shown to admins only. */
export function Nav({ alerts = 0, update = false, admin = true }: { alerts?: number; update?: boolean; admin?: boolean }) {
  const links = navLinks(admin);
  const dot = (href: string) => update && href === '/settings';
  const badge = (href: string) => (href === '/wishlist' && alerts > 0 ? alerts : 0);
  const path = usePathname();
  return (
    <nav className="hidden gap-0.5 text-sm sm:flex lg:gap-1" aria-label="Pages">
      {links.map(([href, label, Icon]) => {
        const active = isActive(path, href);
        return (
          // Icons only between phone and laptop widths: the tip names the page there (and the update dot at any width).
          <Tip key={href} label={dot(href) ? `${label} · Update available` : label} side="bottom" describe={false} className={dot(href) ? undefined : 'lg:hidden'}>
          <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-control px-2.5 py-1.5 lg:px-3 font-medium transition-colors ${active ? 'bg-primary text-on-primary' : 'text-on-header hover:bg-header-hover hover:text-on-header-strong'}`}
          >
            <Icon aria-hidden className="size-4" />
            {/* Icons only between phone and laptop widths, where eight labels don't fit. */}
            <span className="sr-only lg:not-sr-only">{label}</span>
            {badge(href) > 0 && (
              <span className={`rounded-full px-1.5 text-xs font-bold tabular-nums ${active ? 'bg-header text-on-header-strong' : 'bg-primary text-on-primary'}`}>
                {badge(href)}<span className="sr-only"> under target</span>
              </span>
            )}
            {dot(href) && <span className={`size-2 rounded-full ${active ? 'bg-header' : 'bg-primary'}`}><span className="sr-only">Update available</span></span>}
          </Link>
          </Tip>
        );
      })}
    </nav>
  );
}
