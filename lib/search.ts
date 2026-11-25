// The command palette's search (#107): types, query limits and the page list. No server imports, so the palette (a
// client component) and the server search (lib/service/search.ts) share one list of pages and one set of rules.

/** Result groups, in the order the palette shows them. */
export const SEARCH_GROUPS = ['Pages', 'Sets', 'Minifigures', 'Wishlist', 'Parts', 'Loose parts'] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

/** One result: where it goes and what it says. `image` is a photo already stored for the item (sets, minifigures). */
export type SearchHit = { group: SearchGroup; label: string; hint: string | null; href: string; image?: string | null };

/** Fewer characters than this search nothing (the palette still lists pages and actions). */
export const SEARCH_MIN = 2;
/** Longer queries are refused (400 on the API). */
export const SEARCH_MAX = 64;
/** At most this many results per group. */
export const SEARCH_PER_GROUP = 8;

/** A query trimmed and checked: null when it's too short to search, an error when it's too long. */
export function parseQuery(raw: unknown): { ok: true; q: string | null } | { ok: false; error: string } {
  const q = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (q.length > SEARCH_MAX) return { ok: false, error: `Search for ${SEARCH_MAX} characters at most.` };
  return { ok: true, q: q.length < SEARCH_MIN ? null : q };
}

/** A page the palette can jump to. `admin`: Store and Orders, an admin's BrickLink business (#50). `words`: other names it answers to. */
export type PageEntry = { href: string; label: string; words?: string; admin?: boolean; account?: boolean };

/** Every page, in the order the palette lists them: the nav's pages first (components/Nav LINKS), then the rest. */
export const PAGES: readonly PageEntry[] = [
  { href: '/', label: 'Sets', words: 'collection home value' },
  { href: '/wishlist', label: 'Wishlist', words: 'wanted target' },
  { href: '/radar', label: 'Radar', words: 'retiring retirement' },
  { href: '/parts', label: 'Parts', words: 'pieces bricks' },
  { href: '/layouts', label: 'Layouts', words: 'mils modules' },
  { href: '/store', label: 'Store', words: 'bricklink inventory', admin: true },
  { href: '/orders', label: 'Orders', words: 'bricklink sales', admin: true },
  { href: '/settings', label: 'Settings', words: 'keys tokens people collections' },
  { href: '/account', label: 'Account', words: 'password passkey profile', account: true },
  { href: '/minifigs', label: 'Minifigures', words: 'figs figures cmf' },
  { href: '/parts/lots', label: 'Loose parts', words: 'lots bins' },
  { href: '/build', label: 'What can I build?', words: 'builds moc alternate' },
];

/** The pages `admin` may open; `account` adds the account page (AUTH_MODE=better-auth). */
export const pagesFor = (admin: boolean, account = false) => PAGES.filter((p) => (admin || !p.admin) && (account || !p.account));

/** Whether every word of `q` starts a word of `text` or appears in it (case-insensitive). Empty matches everything. */
export function matches(q: string, ...text: (string | null | undefined)[]): boolean {
  const hay = text.filter(Boolean).join(' ').toLowerCase();
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** The pages matching `q` that `admin` may open, as results. */
export const matchPages = (q: string, admin: boolean, account = false): SearchHit[] =>
  pagesFor(admin, account).filter((p) => matches(q, p.label, p.words)).map((p) => ({ group: 'Pages', label: p.label, hint: null, href: p.href }));
