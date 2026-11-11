// Copies of a set: each physical box or build, with its own status, condition, location, cost basis and value.
// The set row (lib/service/sets.ts) holds the catalog data and the fetched prices; copies hold everything per box.
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Lookup } from '../bricklink/client';
import { setCopies, sets } from '../db/schema';
import type { DB } from '../db/types';
import { copyGuide, displayNo, estValue, setGuide, type CopyInput, type CopyRow, type SetRow } from '../sets';
import { copiesBySet, getCurrency, getSet, lookupInto, today, type Result } from './sets';
import { hasMissing } from './missing';
import { partOutCopy, unPartCopy } from './lots';
import { latestGuide, primarySource, recentAmount } from './prices';

/** A BrickLink price in the other guide is used for a copy's value when it's at most this old. */
const SNAPSHOT_DAYS = 90;
const nowIso = () => new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.parse(today()) - n * 86_400_000).toISOString().slice(0, 10);
/** A set's needed guide is looked up again when its newest price in it is older than this. */
const FRESH_DAYS = 7;

/**
 * After copies changed, whether the set needs a BrickLink lookup now: it has been priced before, but not in the guide
 * most of its copies now need within the last week.
 */
export async function needsRelookup(db: DB, setNo: string, copies: Pick<CopyRow, 'status' | 'condition'>[]): Promise<boolean> {
  if (!(await latestGuide(db, 'set', setNo))) return false;
  return !(await recentAmount(db, 'set', setNo, { source: 'bricklink', condition: setGuide(copies), currency: await getCurrency(db), since: daysAgo(FRESH_DAYS), withEmpty: true }));
}

/** Inserts `n` copies of a set with the same fields. Sealed means New; a gift with purchase costs 0. */
export async function insertCopies(db: DB, setId: number, c: CopyInput, n: number): Promise<number[]> {
  if (n < 1) return [];
  const status = c.status ?? (c.condition === 'New' ? 'sealed' : 'built');
  const row = {
    setId, status, condition: status === 'sealed' ? 'New' as const : (c.condition ?? 'Used'), missingPct: c.missingPct ?? null, location: c.location ?? null,
    acquiredDate: c.acquiredDate ?? null, buildDate: c.buildDate ?? null, pricePaid: c.gwp ? 0 : (c.pricePaid ?? null), tax: c.tax ?? null,
    shipping: c.shipping ?? null, gwp: c.gwp ?? false, notes: c.notes ?? null,
  };
  const ids = await db.insert(setCopies).values(Array.from({ length: n }, () => row)).returning({ id: setCopies.id }).all();
  return ids.map((r) => r.id);
}

/**
 * Re-values every copy of a set from the primary price source (Settings → Value source, default BrickLink).
 *
 * BrickLink: a copy in the fetched guide uses today's average; a copy in the other guide uses the newest BrickLink
 * price in its guide from the last 90 days, else today's average (est_guide then says which guide it really came
 * from, and the UI labels it). Roadmap #4 replaces this with both guides.
 * Another source: each copy uses that source's newest value in its own condition, or none (never BrickLink's).
 */
export async function repriceCopies(db: DB, setId: number, fetched?: 'N' | 'U'): Promise<void> {
  const s = await db.select({ setNo: sets.setNo, avgSold: sets.avgSold }).from(sets).where(eq(sets.id, setId)).get();
  if (!s) return;
  const copies = (await copiesBySet(db, [setId])).get(setId) ?? [];
  if (!copies.length) return;
  const [source, currency] = await Promise.all([primarySource(db), getCurrency(db)]);
  const save = async (c: CopyRow, price: number | null, guide: 'N' | 'U') => {
    const value = price == null ? null : estValue(price, c.missingPct);
    const v = value == null ? null : Math.round(value * 100) / 100;
    const g = price == null ? null : guide;
    if (v !== c.estValue || g !== c.estGuide) await db.update(setCopies).set({ estValue: v, estGuide: g }).where(eq(setCopies.id, c.id));
  };
  if (source !== 'bricklink') {
    for (const c of copies) {
      const g = copyGuide(c);
      await save(c, (await recentAmount(db, 'set', s.setNo, { source, condition: g, currency }))?.amount ?? null, g);
    }
    return;
  }
  // Each copy's own guide: its newest BrickLink answer from the last 90 days ("no sales" included). Without one,
  // the other guide's newest price, labelled; without that, today's lookup.
  const since = daysAgo(SNAPSHOT_DAYS);
  const own = {
    N: await recentAmount(db, 'set', s.setNo, { source: 'bricklink', condition: 'N', currency, since, withEmpty: true }),
    U: await recentAmount(db, 'set', s.setNo, { source: 'bricklink', condition: 'U', currency, since, withEmpty: true }),
  };
  const got = fetched ?? setGuide(copies);
  for (const c of copies) {
    const g = copyGuide(c), other = g === 'N' ? 'U' : 'N';
    const alt = own[other]?.amount != null ? own[other] : null;
    const [price, guide]: [number | null, 'N' | 'U'] = own[g] ? [own[g]!.amount, g] : alt ? [alt.amount, other] : [s.avgSold, got];
    await save(c, price, guide);
  }
}

/** Re-values every set's copies, after the primary source changed or a source's sync wrote new prices. */
export async function refreshEstValues(db: DB): Promise<void> {
  for (const { id } of await db.select({ id: sets.id }).from(sets).all()) await repriceCopies(db, id);
}

export async function listCopies(db: DB, setId: number): Promise<CopyRow[]> {
  return (await copiesBySet(db, [setId])).get(setId) ?? [];
}

/** A copy with its set number, or undefined. */
export async function getCopy(db: DB, copyId: number): Promise<(CopyRow & { setNo: string }) | undefined> {
  const r = await db.select({ setId: setCopies.setId, setNo: sets.setNo }).from(setCopies).innerJoin(sets, eq(sets.id, setCopies.setId)).where(eq(setCopies.id, copyId)).get();
  if (!r) return undefined;
  const c = (await listCopies(db, r.setId)).find((x) => x.id === copyId);
  return c && { ...c, setNo: r.setNo };
}

/** Adds one copy to a set that's already in the collection. Re-prices when it changes the guide the set needs. */
export async function addCopy(db: DB, no: string, input: CopyInput, lookup: Lookup | null = null): Promise<Result<{ set: SetRow; copyId: number }>> {
  const s = await getSet(db, no);
  if (!s) return { ok: false, status: 404, error: `#${displayNo(no)} isn't in the collection.` };
  const [id] = await insertCopies(db, s.id, input, 1);
  await touch(db, s.id);
  await reprice(db, (await getSet(db, no))!, lookup);
  return { ok: true, set: (await getSet(db, no))!, copyId: id };
}

/**
 * Changes a copy. Sealed means New (a Partial copy can't be sealed). While parts are marked missing on it, its
 * Missing % comes from them and isn't typed.
 */
export async function editCopy(db: DB, copyId: number, input: CopyInput, lookup: Lookup | null = null): Promise<Result<{ set: SetRow; lots?: number }>> {
  const c = await getCopy(db, copyId);
  if (!c) return { ok: false, status: 404, error: `Copy ${copyId} doesn't exist.` };
  const fields: CopyInput = { ...input };
  if (fields.missingPct !== undefined && (await hasMissing(db, c.setId, c.id))) delete fields.missingPct;
  const after = { ...c, ...fields };
  if (after.status === 'sealed') {
    if (after.condition === 'Partial') return { ok: false, status: 400, error: "A sealed copy can't be Partial." };
    fields.condition = 'New';
  }
  if (fields.gwp) fields.pricePaid = 0;
  // A copy parted out becomes loose-part lots; put back together, its lots go (refused if they were changed or reserved).
  const partingOut = after.status === 'parted_out' && c.status !== 'parted_out';
  if (c.status === 'parted_out' && after.status !== 'parted_out') {
    const r = await unPartCopy(db, copyId);
    if (!r.ok) return r;
  }
  if (Object.keys(fields).length) await db.update(setCopies).set({ ...fields, updatedAt: nowIso() }).where(eq(setCopies.id, copyId));
  const lots = partingOut ? await partOutCopy(db, copyId) : undefined;
  await touch(db, c.setId);
  const s = (await getSet(db, c.setNo))!;
  await reprice(db, s, lookup);
  return { ok: true, set: (await getSet(db, c.setNo))!, ...(lots !== undefined ? { lots } : {}) };
}

/** Removes a copy. The set goes with its last copy. `remaining` counts copies that aren't parted out. */
export async function removeCopy(db: DB, copyId: number): Promise<Result<{ remaining: number; setNo: string }>> {
  const c = await getCopy(db, copyId);
  if (!c) return { ok: false, status: 404, error: `Copy ${copyId} doesn't exist.` };
  await db.delete(setCopies).where(eq(setCopies.id, copyId));
  const left = await listCopies(db, c.setId);
  if (!left.length) {
    await db.delete(sets).where(eq(sets.id, c.setId));
    return { ok: true, remaining: 0, setNo: c.setNo };
  }
  await touch(db, c.setId);
  await repriceCopies(db, c.setId);
  return { ok: true, remaining: left.filter((x) => x.status !== 'parted_out').length, setNo: c.setNo };
}

const touch = (db: DB, setId: number) => db.update(sets).set({ updatedAt: nowIso() }).where(eq(sets.id, setId));

/** After copies changed: a fresh lookup when the set now needs the other guide (and BrickLink is set up), else re-value. */
async function reprice(db: DB, s: SetRow, lookup: Lookup | null): Promise<void> {
  if (lookup && (await needsRelookup(db, s.setNo, s.copies))) await lookupInto(db, s, lookup, await getCurrency(db));
  else await repriceCopies(db, s.id);
}

/**
 * What you own per set number, from the copies that aren't parted out: how many, and the condition and location when
 * they all share one (else null). Sets with no such copies are left out. Used by the scanner and the Designer list.
 */
export async function ownedSummary(db: DB, nos?: string[]): Promise<Map<string, { qty: number; condition: CopyRow['condition'] | null; location: string | null; name: string }>> {
  if (nos && !nos.length) return new Map();
  const q = db.select({ setNo: sets.setNo, name: sets.name, status: setCopies.status, condition: setCopies.condition, location: setCopies.location })
    .from(setCopies).innerJoin(sets, eq(sets.id, setCopies.setId));
  const rows = await (nos ? q.where(and(inArray(sets.setNo, nos), ne(setCopies.status, 'parted_out'))) : q.where(ne(setCopies.status, 'parted_out'))).all();
  const out = new Map<string, { qty: number; condition: CopyRow['condition'] | null; location: string | null; name: string }>();
  for (const r of rows) {
    const o = out.get(r.setNo);
    if (!o) out.set(r.setNo, { qty: 1, condition: r.condition, location: r.location, name: r.name });
    else {
      o.qty++;
      if (o.condition !== r.condition) o.condition = null;
      if (o.location !== r.location) o.location = null;
    }
  }
  return out;
}
