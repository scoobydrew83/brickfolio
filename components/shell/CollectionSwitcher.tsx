'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Library } from 'lucide-react';
import { selectCollection } from '@/app/actions';

/**
 * Picks the collection every page shows (#49): All collections, or one. Remembered per browser in a cookie the server
 * reads, so pages render already filtered. Only shown once there are two or more collections.
 */
export function CollectionSwitcher({ collections, current }: { collections: { id: number; name: string }[]; current: number | 'all' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label data-switcher className="relative -my-1 flex min-w-0 items-center gap-1.5 rounded-control px-2 py-1.5 text-sm text-on-header hover:bg-header-hover focus-within:bg-header-hover sm:shrink-0">
      <Library aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">Collection</span>
      <select
        value={String(current)}
        disabled={pending}
        onChange={(e) => start(async () => { const v = e.target.value; await selectCollection(v === 'all' ? 'all' : Number(v)); router.refresh(); })}
        className="max-w-[9rem] min-w-0 cursor-pointer truncate bg-transparent font-medium text-on-header-strong outline-none sm:max-w-[12rem] [&>option]:bg-surface [&>option]:text-fg"
      >
        <option value="all">All collections</option>
        {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
}
