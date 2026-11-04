// Read-only share links: a URL that shows the collection to someone without access to the app. Like API tokens,
// the link is shown once and only its SHA-256 hash is stored. The public view is built field by field from an
// explicit list, so nothing private (locations, notes, values, ids, errors) leaks unless the link allows it.
import { desc, eq, sql } from 'drizzle-orm';
import { shareLinks } from '../db/schema';
import type { DB } from '../db/types';
import { copiesSummary, isActive, totals } from '../sets';
import { listMinifigs } from './minifigs';
import { listSets, type Result } from './sets';
import { sha256Hex } from './tokens';

export const SHARE_PREFIX = 'bfs_';
const MAX_YEARS = 5;

export type ShareLink = typeof shareLinks.$inferSelect;
export type ShareLinkRow = Omit<ShareLink, 'hash'> & { expired: boolean };
export type ShareInput = { name: string; showValues: boolean; showLocations: boolean; showNotes: boolean; showMinifigs: boolean; expiresAt: string | null };

const truthy = (v: unknown) => v === true || ['on', 'true', '1', 'yes'].includes(String(v ?? '').trim().toLowerCase());

/**
 * Validates the create form or JSON. `expires`: 'never', '7' or '30' (days), or a date (YYYY-MM-DD, end of that
 * day UTC) or ISO time in the future, at most 5 years out. Minifigures are on unless turned off.
 */
export function parseShareInput(form: Record<string, unknown>, now = new Date()): { ok: true; value: ShareInput } | { ok: false; error: string } {
  const name = String(form.name ?? '').trim();
  if (!name || name.length > 60) return { ok: false, error: 'Name must be 1–60 characters' };
  const raw = String(form.expires ?? form.expiresAt ?? '').trim();
  let expiresAt: string | null = null;
  if (/^\d{1,4}$/.test(raw)) expiresAt = new Date(now.getTime() + Number(raw) * 86_400_000).toISOString();
  else if (raw && raw !== 'never') {
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw);
    if (Number.isNaN(t)) return { ok: false, error: 'Expiry must be never, a number of days, or a date' };
    expiresAt = new Date(t).toISOString();
  }
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (t <= now.getTime()) return { ok: false, error: 'Expiry must be in the future' };
    if (t > now.getTime() + MAX_YEARS * 366 * 86_400_000) return { ok: false, error: `Expiry must be within ${MAX_YEARS} years` };
  }
  const minifigs = form.showMinifigs ?? form.minifigs;
  return {
    ok: true,
    value: {
      name, expiresAt, showValues: truthy(form.showValues), showLocations: truthy(form.showLocations), showNotes: truthy(form.showNotes),
      showMinifigs: minifigs === undefined || minifigs === null || minifigs === '' ? true : truthy(minifigs),
    },
  };
}

export async function createShareLink(db: DB, input: ShareInput): Promise<Result<{ token: string; id: number }>> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = SHARE_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const [row] = await db.insert(shareLinks).values({ ...input, hash: await sha256Hex(token), prefix: token.slice(0, 8) }).returning({ id: shareLinks.id }).all();
  return { ok: true, token, id: row.id };
}

/** Every link, newest first, without its hash. */
export async function listShareLinks(db: DB, now = new Date()): Promise<ShareLinkRow[]> {
  const rows = await db.select().from(shareLinks).orderBy(desc(shareLinks.id)).all();
  return rows.map(({ hash: _h, ...r }) => ({ ...r, expired: !!r.expiresAt && Date.parse(r.expiresAt) <= now.getTime() }));
}

export async function revokeShareLink(db: DB, id: number): Promise<Result> {
  const r = await db.delete(shareLinks).where(eq(shareLinks.id, id)).returning({ id: shareLinks.id }).all();
  return r.length ? { ok: true } : { ok: false, status: 404, error: 'Share link not found.' };
}

/** The link for a token when it exists and hasn't expired, counting the view. Null otherwise (one answer for every failure). */
export async function checkShareLink(db: DB, token: string, now = new Date()): Promise<ShareLink | null> {
  if (!token.startsWith(SHARE_PREFIX) || token.length > 100) return null;
  const row = await db.select().from(shareLinks).where(eq(shareLinks.hash, await sha256Hex(token))).get();
  if (!row || (row.expiresAt && Date.parse(row.expiresAt) <= now.getTime())) return null;
  await db.update(shareLinks).set({ lastViewedAt: now.toISOString(), views: sql`${shareLinks.views} + 1` }).where(eq(shareLinks.id, row.id));
  return row;
}

/** One set as a shared page shows it. Optional fields are present only when the link allows them. */
export type SharedSet = {
  setNo: string; name: string; year: number | null; theme: string | null; subtheme: string | null; pieces: number | null;
  minifigs: number | null; qty: number; copies: string; condition: string | null; image: string | null;
  estValue?: number | null; retailPrice?: number | null; retailCurrency?: string | null; location?: string | null; notes?: string | null;
};
export type SharedFig = { figNo: string | null; name: string; year: number | null; qty: number; condition: string; image: string | null; estValue?: number | null; location?: string | null; notes?: string | null };
export type SharedCollection = {
  name: string; currency: string | null;
  options: { values: boolean; locations: boolean; notes: boolean; minifigs: boolean };
  totals: { sets: number; copies: number; pieces: number; estValue?: number; minifigs?: number };
  sets: SharedSet[]; minifigs: SharedFig[];
};

/** The public view of the collection for a link. Built from an explicit field list: never spread a row here. */
export async function sharedCollection(db: DB, link: Pick<ShareLink, 'name' | 'showValues' | 'showLocations' | 'showNotes' | 'showMinifigs'>, currency: string): Promise<SharedCollection> {
  const rows = (await listSets(db)).filter((s) => s.qty > 0);
  const t = totals(rows);
  const sets = rows.map((s): SharedSet => {
    const o: SharedSet = {
      setNo: s.setNo, name: s.name, year: s.year, theme: s.theme ?? null, subtheme: s.subtheme ?? null, pieces: s.pieces,
      minifigs: s.minifigs ?? null, qty: s.qty, copies: copiesSummary(s.copies.filter(isActive)), condition: s.condition, image: s.imageUrl,
    };
    if (link.showValues) { o.estValue = s.valueTotal; o.retailPrice = s.retailPrice ?? null; o.retailCurrency = s.retailCurrency ?? null; }
    if (link.showLocations) o.location = s.location ?? ([...new Set(s.copies.filter(isActive).map((c) => c.location).filter(Boolean))].join(', ') || null);
    if (link.showNotes) o.notes = s.notes;
    return o;
  });
  const figs = link.showMinifigs ? (await listMinifigs(db)).map((m): SharedFig => {
    const o: SharedFig = { figNo: m.figNo, name: m.name, year: m.year, qty: m.qty, condition: m.condition, image: m.imageUrl };
    if (link.showValues) o.estValue = m.estValue;
    if (link.showLocations) o.location = m.location;
    if (link.showNotes) o.notes = m.notes;
    return o;
  }) : [];
  const total: SharedCollection['totals'] = { sets: t.count, copies: t.copies, pieces: t.pieces };
  if (link.showValues) total.estValue = Math.round((t.estValue + figs.reduce((v, f) => v + (f.estValue ?? 0) * f.qty, 0)) * 100) / 100;
  if (link.showMinifigs) total.minifigs = figs.reduce((n, f) => n + f.qty, 0);
  return {
    name: link.name, currency: link.showValues ? currency : null,
    options: { values: link.showValues, locations: link.showLocations, notes: link.showNotes, minifigs: link.showMinifigs },
    totals: total, sets, minifigs: figs,
  };
}
