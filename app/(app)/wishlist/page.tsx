import { Suspense } from 'react';
import { connection } from 'next/server';
import WishlistView from '@/components/WishlistView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { getCurrency } from '@/lib/service/sets';
import { listWishlist } from '@/lib/service/wishlist';
import { bestOffers } from '@/lib/service/offers';
import { sourceLabel } from '@/lib/service/prices';
import { bricklink, currentUser } from '@/lib/session';

export const metadata = { title: 'Wishlist' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton tiles={2} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const db = await getDb();
  const [items, currency] = await Promise.all([listWishlist(db), getCurrency(db)]);
  // The best recent retailer offer for each wish, in its own condition (posted by your flows to /api/v1/prices).
  const best = await bestOffers(db, items.map((w) => w.setNo), { currency });
  const offers = Object.fromEntries(items.flatMap((w) => {
    const o = best.get(w.setNo)?.[w.condition === 'Used' ? 'U' : 'N'];
    return o ? [[w.setNo, { ...o, label: sourceLabel(o.source) }]] : [];
  }));
  return <WishlistView items={items} currency={currency} priced={!!bricklink()} offers={offers} />;
}
