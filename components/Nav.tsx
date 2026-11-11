'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, Heart, Puzzle, Radar, Receipt, Settings, Store } from 'lucide-react';

const LINKS = [
  ['/', 'Sets', Boxes],
  ['/wishlist', 'Wishlist', Heart],
  ['/radar', 'Radar', Radar],
  ['/parts', 'Parts', Puzzle],
  ['/store', 'Store', Store],
  ['/orders', 'Orders', Receipt],
  ['/settings', 'Settings', Settings],
] as const;

const isActive = (path: string, href: string) =>
  href === '/' ? path === '/' || path.startsWith('/sets/') || path.startsWith('/minifigs') || path.startsWith('/scan') : href === '/parts' ? path.startsWith('/parts') || path.startsWith('/build') || path.startsWith('/layouts') : path.startsWith(href);

/** Top-level page links: a row in the header on wider screens, a bottom tab bar on phones. */
/** `alerts` = wishlist sets under target, shown as a count on the Wishlist link; `update` = a newer release is out (a dot on Settings). */
export function Nav({ variant = 'top', alerts = 0, update = false }: { variant?: 'top' | 'bottom'; alerts?: number; update?: boolean }) {
  const dot = (href: string) => update && href === '/settings';
  const badge = (href: string) => (href === '/wishlist' && alerts > 0 ? alerts : 0);
  const path = usePathname();
  if (variant === 'bottom') {
    return (
      <nav aria-label="Pages" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {LINKS.map(([href, label, Icon]) => {
          const active = isActive(path, href);
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-2xs font-medium ${active ? 'text-fg' : 'text-fg-3'}`}>
              <span className={`relative flex h-7 w-10 items-center justify-center rounded-full ${active ? 'bg-primary text-on-primary' : ''}`}>
                <Icon aria-hidden className="size-5" />
                {badge(href) > 0 && <span className="absolute -top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-center text-2xs font-bold text-on-primary ring-2 ring-surface">{badge(href)}</span>}
                {dot(href) && <span aria-hidden className="absolute top-0 right-1.5 size-2 rounded-full bg-primary ring-2 ring-surface" />}
              </span>
              {label}
              {badge(href) > 0 && <span className="sr-only">, {badge(href)} under target</span>}
              {dot(href) && <span className="sr-only">, update available</span>}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav className="hidden gap-1 text-sm sm:flex" aria-label="Pages">
      {LINKS.map(([href, label, Icon]) => {
        const active = isActive(path, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-control px-3 py-1.5 font-medium transition-colors ${active ? 'bg-primary text-on-primary' : 'text-on-header hover:bg-white/10 hover:text-white'}`}
          >
            <Icon aria-hidden className="size-4" />
            {label}
            {badge(href) > 0 && (
              <span className={`rounded-full px-1.5 text-xs font-bold tabular-nums ${active ? 'bg-header text-white' : 'bg-primary text-on-primary'}`}>
                {badge(href)}<span className="sr-only"> under target</span>
              </span>
            )}
            {dot(href) && <span className={`size-2 rounded-full ${active ? 'bg-header' : 'bg-primary'}`} title="Update available"><span className="sr-only">Update available</span></span>}
          </Link>
        );
      })}
    </nav>
  );
}
