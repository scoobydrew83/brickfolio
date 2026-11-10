import { expect, it } from 'vitest';
import { timeAgo, wishStatus } from './wishlist-status';

const w = (o: Partial<{ blError: string | null; avgSold: number | null; target: number | null }>) => ({ blError: null, avgSold: 500, target: 450, ...o });

it('counts a wish as under target on the BrickLink average or a recent offer', () => {
  expect(wishStatus(w({ avgSold: 400 }))).toMatchObject({ label: 'Under target', rank: 0, by: 'average' });
  expect(wishStatus(w({}), { amount: 420 })).toMatchObject({ label: 'Under target · offer', rank: 0, by: 'offer' });
  expect(wishStatus(w({ avgSold: 400 }), { amount: 420 })).toMatchObject({ by: 'average' }); // both: the average says it
  expect(wishStatus(w({}), { amount: 460 })).toMatchObject({ label: '11% above', rank: 1, by: null });
  expect(wishStatus(w({ blError: 'down' }), { amount: 400 })).toMatchObject({ by: 'offer' }); // a failed lookup doesn't hide a deal
  expect(wishStatus(w({ blError: 'down' }))).toMatchObject({ label: 'Lookup failed', rank: 4 });
  expect(wishStatus(w({ avgSold: null }))).toMatchObject({ label: 'No recent sales' });
  expect(wishStatus(w({ target: null }), { amount: 1 })).toMatchObject({ label: 'No target' });
});

it('says how long ago', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  expect(['2026-11-06T11:59:30Z', '2026-11-06T11:40:00Z', '2026-11-06T09:00:00Z', '2026-11-05T10:00:00Z', '2026-11-01T12:00:00Z'].map((t) => timeAgo(t, now)))
    .toEqual(['just now', '20 minutes ago', '3 hours ago', 'yesterday', '5 days ago']);
});
