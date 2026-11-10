// Where a wish stands against its target, for the Wishlist page. Pure, so the page and tests share it.

export type WishStatus = { tone: 'ok' | 'neutral' | 'danger'; label: string; rank: number; by: 'average' | 'offer' | null };

/**
 * Under target on BrickLink's average sold price, or on the best recent retailer offer (posted to /api/v1/prices),
 * the same rule as the alerts and the nav badge. Lower rank sorts first.
 */
export function wishStatus(w: { blError: string | null; avgSold: number | null; target: number | null }, offer?: { amount: number } | null): WishStatus {
  const avgUnder = !w.blError && w.avgSold != null && w.target != null && w.avgSold <= w.target;
  if (avgUnder) return { tone: 'ok', label: 'Under target', rank: 0, by: 'average' };
  if (w.target != null && offer && offer.amount <= w.target) return { tone: 'ok', label: 'Under target · offer', rank: 0, by: 'offer' };
  if (w.blError) return { tone: 'danger', label: 'Lookup failed', rank: 4, by: null };
  if (w.avgSold === null) return { tone: 'neutral', label: 'No recent sales', rank: 3, by: null };
  if (w.target === null) return { tone: 'neutral', label: 'No target', rank: 2, by: null };
  return { tone: 'neutral', label: `${Math.round(((w.avgSold - w.target) / w.target) * 100)}% above`, rank: 1, by: null };
}

/** "3 hours ago", "yesterday", … for a past ISO time. */
export function timeAgo(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
