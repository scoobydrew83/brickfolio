'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Sets | Minifigs switch at the top of the two collection pages. */
export function CollectionTabs() {
  const path = usePathname();
  const tabs = [['/', 'Sets'], ['/minifigs', 'Minifigs']] as const;
  return (
    <nav aria-label="Collection" className="flex w-fit rounded-control border border-line-strong bg-surface p-0.5 text-sm">
      {tabs.map(([href, label]) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`rounded-md px-3 py-1.5 transition-colors ${active ? 'bg-primary font-medium text-on-primary' : 'text-fg-2 hover:text-fg'}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
