// Collection logic shared by server actions, the REST API and the scheduler.
// Every function takes the database (and BrickLink lookup) as arguments, so tests can pass an in-memory one.
import { and, asc, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';
import type { Lookup, Store } from '../bricklink/client';
import type { BuildSource, Catalog } from '../rebrickable/client';
import type { DB } from '../db/types';
import { history, locations, priceSnapshots, setModels, sets, settings, syncRuns } from '../db/schema';
import { hasParts, replaceParts } from './parts';
import { syncStore } from './store';
import { syncCatalog, themeMap, themeNames } from './catalog';
import { syncWishlist } from './wishlist';
import { syncBuilds } from './builds';
import { syncRetail } from './retail';
import type { RetailSource } from '../brickset/client';
import { syncOmrModels } from './models';
import { alertsFromEnv, notifyUnderTarget } from './alerts';
import { estValue, parseLocation, priceGuide, totals, type HistoryRow, type SetInput, type SetRow } from '../sets';

/** `status` lets the REST API pick an HTTP code. `existing` = already in stock, so the UI asks before adding. */
export type Result<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status?: 400 | 404 | 409; existing?: { name: string; qty: number } };

export type SyncStatus = { running: boolean; startedAt: string; finishedAt: string | null; total: number; processed: number; errors: number; message: string | null } | null;

/** A sync still "running" after this long is assumed dead (server restarted mid-sync). */
const STALE_MS = 30 * 60_000;
const nowIso = () => new Date().toISOString();
/** Local calendar date, YYYY-MM-DD, in the server's TZ. */
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ || undefined });

const columns = {
  id: sets.id, setNo: sets.setNo, name: sets.name, blName: sets.blName, year: sets.year, categoryId: sets.categoryId,
  imageUrl: sets.imageUrl, pieces: sets.pieces, partLots: sets.partLots, location: sets.location, condition: sets.condition,
  registered: sets.registered, missingPct: sets.missingPct, qty: sets.qty, avgSold: sets.avgSold, minSold: sets.minSold,
  maxSold: sets.maxSold, qtySold: sets.qtySold, estValue: sets.estValue, blError: sets.blError, lastUpdated: sets.lastUpdated, notes: sets.notes,
  themeId: sets.themeId, minifigs: sets.minifigs,
  retailPrice: sets.retailPrice, retailCurrency: sets.retailCurrency, launchDate: sets.launchDate, exitDate: sets.exitDate, retired: sets.retired,
  hasModel: sql<number>`exists (select 1 from ${setModels} where ${setModels.setId} = ${sets.id})`,
};

/** Swaps the Rebrickable theme id for readable theme and subtheme names. */
async function withThemes(db: DB, rows: (Omit<SetRow, 'theme' | 'subtheme' | 'hasModel'> & { themeId: number | null; hasModel: number | boolean })[]): Promise<SetRow[]> {
  const map = rows.some((r) => r.themeId !== null) ? await themeMap(db) : new Map();
  return rows.map(({ themeId, hasModel, ...r }) => ({ ...r, hasModel: Boolean(hasModel), ...themeNames(map, themeId) }));
}

// ---- reads ----

export async function getCurrency(db: DB): Promise<string> {
  const row = await db.select().from(settings).where(eq(settings.key, 'currency')).get();
  return row?.value || 'USD';
}

export async function listLocations(db: DB): Promise<string[]> {
  return (await db.select().from(locations).orderBy(asc(locations.sort), asc(locations.name)).all()).map((l) => l.name);
}

export async function listSets(db: DB): Promise<SetRow[]> {
  return withThemes(db, await db.select(columns).from(sets).orderBy(asc(sets.setNo)).all());
}

export async function getSet(db: DB, no: string): Promise<SetRow | undefined> {
  const row = await db.select(columns).from(sets).where(eq(sets.setNo, no)).get();
  return row && (await withThemes(db, [row]))[0];
}

export async function listHistory(db: DB): Promise<HistoryRow[]> {
  return db.select().from(history).orderBy(asc(history.date)).all();
}

export async function priceHistory(db: DB, setId: number) {
  return db.select().from(priceSnapshots).where(eq(priceSnapshots.setId, setId)).orderBy(asc(priceSnapshots.date)).all();
}

export async function syncStatus(db: DB): Promise<SyncStatus> {
  const r = await db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(1).get();
  if (!r) return null;
  return { running: r.status === 'running', startedAt: r.startedAt, finishedAt: r.finishedAt, total: r.total, processed: r.processed, errors: r.errors, message: r.message };
}

/** Everything the dashboard page needs, in one call. */
export async function getCollection(db: DB) {
  const [rows, hist, sync, locs, currency] = await Promise.all([listSets(db), listHistory(db), syncStatus(db), listLocations(db), getCurrency(db)]);
  return { sets: rows, history: hist, sync, locations: locs, currency, readAt: nowIso() };
}

// ---- writes ----

/**
 * Runs the BrickLink lookup for one set and stores the result (or the error) on it. Returns the error, if any.
 * The parts list is only fetched while the set has no piece count, since it rarely changes on BrickLink.
 */
export async function lookupInto(db: DB, s: Pick<SetRow, 'id' | 'setNo' | 'condition' | 'missingPct'>, lookup: Lookup, currency: string): Promise<string | null> {
  const guide = priceGuide(s.condition);
  try {
    const { parts, pieces: _p, partLots: _l, ...r } = await lookup(s.setNo, guide, currency, { parts: !(await hasParts(db, s.id)) });
    if (parts) await replaceParts(db, s.id, parts); // also sets pieces and part lots
    await db.update(sets)
      .set({ ...r, estValue: estValue(r.avgSold, s.missingPct), blError: null, lastUpdated: nowIso(), updatedAt: nowIso() })
      .where(eq(sets.id, s.id));
    const snap = { guide, avgSold: r.avgSold, minSold: r.minSold, maxSold: r.maxSold, qtySold: r.qtySold };
    await db.insert(priceSnapshots).values({ setId: s.id, date: today(), ...snap })
      .onConflictDoUpdate({ target: [priceSnapshots.setId, priceSnapshots.date], set: snap });
    return null;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db.update(sets).set({ blError: error, lastUpdated: nowIso() }).where(eq(sets.id, s.id));
    return error;
  }
}

/**
 * Adds a set and looks it up on BrickLink. If it's already in stock, returns `existing` unless `another`
 * is set, in which case it adds one copy.
 */
export async function addSet(db: DB, input: SetInput, opts: { another?: boolean; lookup: Lookup | null }): Promise<Result<{ set: SetRow }>> {
  const have = await getSet(db, input.setNo);
  if (have && !opts.another) {
    return { ok: false, status: 409, error: `You already have ${have.qty} of #${have.setNo} (${have.name}).`, existing: { name: have.name, qty: have.qty } };
  }
  if (have) {
    await db.update(sets).set({ qty: sql`${sets.qty} + 1`, updatedAt: nowIso() }).where(eq(sets.id, have.id));
    return { ok: true, set: (await getSet(db, input.setNo))! };
  }
  const inserted = await db.insert(sets)
    .values({
      setNo: input.setNo, name: input.name!, location: input.location ?? null, condition: input.condition ?? 'Used',
      registered: input.registered ?? null, missingPct: input.missingPct ?? null, qty: input.qty ?? 1, notes: input.notes ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: sets.id })
    .all();
  if (!inserted.length) return { ok: false, status: 409, error: `#${input.setNo} was just added by someone else.` };
  const row = (await getSet(db, input.setNo))!;
  if (opts.lookup) await lookupInto(db, row, opts.lookup, await getCurrency(db));
  return { ok: true, set: (await getSet(db, input.setNo))! };
}

/** Updates the given fields. A condition change that switches new/used prices triggers a fresh lookup. */
export async function editSet(db: DB, input: SetInput, lookup: Lookup | null): Promise<Result<{ set: SetRow }>> {
  const before = await getSet(db, input.setNo);
  if (!before) return { ok: false, status: 404, error: `#${input.setNo} isn't in the collection.` };
  const { setNo: _no, ...fields } = input;
  const after = { ...before, ...fields };
  const guideChanged = priceGuide(before.condition) !== priceGuide(after.condition);
  await db.update(sets)
    .set({ ...fields, estValue: guideChanged ? before.estValue : estValue(after.avgSold, after.missingPct), updatedAt: nowIso() })
    .where(eq(sets.id, before.id));
  if (guideChanged && lookup) await lookupInto(db, after, lookup, await getCurrency(db));
  return { ok: true, set: (await getSet(db, input.setNo))! };
}

/** Removes one copy: lowers qty when there are several, deletes the set on the last one. */
export async function removeOne(db: DB, no: string): Promise<Result<{ remaining: number }>> {
  const lowered = await db.update(sets).set({ qty: sql`${sets.qty} - 1`, updatedAt: nowIso() })
    .where(and(eq(sets.setNo, no), gt(sets.qty, 1)))
    .returning({ qty: sets.qty })
    .all();
  if (lowered.length) return { ok: true, remaining: lowered[0].qty };
  const deleted = await db.delete(sets).where(and(eq(sets.setNo, no), lte(sets.qty, 1))).returning({ id: sets.id }).all();
  return deleted.length ? { ok: true, remaining: 0 } : { ok: false, status: 404, error: `#${no} isn't in the collection.` };
}

/** Throws away a set's parts list and fetches it again (and its prices). */
export async function refreshParts(db: DB, no: string, lookup: Lookup | null): Promise<Result<{ set: SetRow }>> {
  if (!lookup) return { ok: false, status: 400, error: 'BrickLink API keys are not set.' };
  const s = await getSet(db, no);
  if (!s) return { ok: false, status: 404, error: `#${no} isn't in the collection.` };
  await replaceParts(db, s.id, []);
  const error = await lookupInto(db, s, lookup, await getCurrency(db));
  return error ? { ok: false, error } : { ok: true, set: (await getSet(db, no))! };
}

/** Re-runs the BrickLink lookup for one set. */
export async function relookup(db: DB, no: string, lookup: Lookup | null): Promise<Result<{ set: SetRow }>> {
  if (!lookup) return { ok: false, status: 400, error: 'BrickLink API keys are not set.' };
  const s = await getSet(db, no);
  if (!s) return { ok: false, status: 404, error: `#${no} isn't in the collection.` };
  const error = await lookupInto(db, s, lookup, await getCurrency(db));
  return error ? { ok: false, error: `Still failing: ${error}` } : { ok: true, set: (await getSet(db, no))! };
}

// ---- sync ----

/** Claims the sync lock. Returns the run id, or an error if a sync is already running. */
export async function startSync(db: DB): Promise<Result<{ runId: number }>> {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  await db.update(syncRuns).set({ status: 'failed', finishedAt: nowIso(), message: 'Stopped (server restarted?)' })
    .where(and(eq(syncRuns.status, 'running'), lt(syncRuns.startedAt, cutoff)));
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(sets).all();
  const run = await db.insert(syncRuns).values({ total: n }).onConflictDoNothing().returning({ id: syncRuns.id }).all();
  return run.length ? { ok: true, runId: run[0].id } : { ok: false, status: 409, error: 'A sync is already running.' };
}

/**
 * Looks up every set, saves today's collection totals, then refreshes your store inventory and orders
 * (when `store` is given) and Rebrickable themes and minifigs (when `catalog` is given). Updates progress as it goes.
 */
export async function runSync(db: DB, runId: number, lookup: Lookup, store?: Store, catalog?: Catalog & Partial<BuildSource>, retail?: RetailSource): Promise<void> {
  try {
    const currency = await getCurrency(db);
    const all = await db.select({ id: sets.id, setNo: sets.setNo, condition: sets.condition, missingPct: sets.missingPct }).from(sets).all();
    let errors = 0;
    for (const [i, s] of all.entries()) {
      if (await lookupInto(db, s, lookup, currency)) errors++;
      await db.update(syncRuns).set({ processed: i + 1, errors }).where(eq(syncRuns.id, runId));
    }
    await saveHistory(db);
    const wishErrors = await syncWishlist(db, lookup, currency);
    const send = alertsFromEnv();
    const alertError = send ? await notifyUnderTarget(db, send) : null;
    const storeErrors = store ? await syncStore(db, store) : [];
    const catalogErrors = catalog ? await syncCatalog(db, catalog) : [];
    if (catalog?.alternates && catalog.buildParts) catalogErrors.push(...(await syncBuilds(db, { alternates: catalog.alternates, buildParts: catalog.buildParts })));
    if (retail) catalogErrors.push(...(await syncRetail(db, retail)));
    // 3D models from LDraw's OMR, only when a parts library is set up (the 3D view needs it anyway).
    const hasLibrary = !!(process.env.LDRAW_LIBRARY_DIR || process.env.LDRAW_LIBRARY_URL);
    if (hasLibrary && process.env.LDRAW_OMR_SYNC !== 'off') catalogErrors.push(...(await syncOmrModels(db)));
    const message = [...storeErrors, alertError ?? '', wishErrors ? `${wishErrors} wishlist lookup${wishErrors === 1 ? '' : 's'} failed` : '', ...catalogErrors.slice(0, 3), catalogErrors.length > 3 ? `and ${catalogErrors.length - 3} more errors` : ''].filter(Boolean).join('; ');
    await db.update(syncRuns).set({ status: 'done', finishedAt: nowIso(), message: message || null }).where(eq(syncRuns.id, runId));
  } catch (e) {
    await db.update(syncRuns).set({ status: 'failed', finishedAt: nowIso(), message: e instanceof Error ? e.message : String(e) }).where(eq(syncRuns.id, runId));
  }
}

/** Stores today's collection totals (replacing an earlier row for today). */
export async function saveHistory(db: DB): Promise<void> {
  const t = totals(await listSets(db));
  const row = { sets: t.count, copies: t.copies, estValue: Math.round(t.estValue * 100) / 100, avgSold: Math.round(t.avgSold * 100) / 100, pieces: t.pieces };
  await db.insert(history).values({ date: today(), ...row }).onConflictDoUpdate({ target: history.date, set: row });
}

// ---- settings ----

export async function addLocation(db: DB, raw: unknown): Promise<Result> {
  const p = parseLocation(raw);
  if (!p.ok) return { ...p, status: 400 };
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${locations.sort}), -1)` }).from(locations).all();
  const r = await db.insert(locations).values({ name: p.value, sort: max + 1 }).onConflictDoNothing().returning().all();
  return r.length ? { ok: true } : { ok: false, status: 409, error: `${p.value} already exists.` };
}

/** Renames a location and moves its sets along with it. */
export async function renameLocation(db: DB, from: string, raw: unknown): Promise<Result> {
  const p = parseLocation(raw);
  if (!p.ok) return { ...p, status: 400 };
  if ((await listLocations(db)).includes(p.value)) return { ok: false, status: 409, error: `${p.value} already exists.` };
  const r = await db.update(locations).set({ name: p.value }).where(eq(locations.name, from)).returning().all();
  if (!r.length) return { ok: false, status: 404, error: `${from} doesn't exist.` };
  await db.update(sets).set({ location: p.value }).where(eq(sets.location, from));
  return { ok: true };
}

/** Deletes a location only when no set uses it, so nothing is silently moved. */
export async function deleteLocation(db: DB, name: string): Promise<Result> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(sets).where(eq(sets.location, name)).all();
  if (n) return { ok: false, status: 409, error: `${n} set${n === 1 ? '' : 's'} still use ${name}. Move them first.` };
  await db.delete(locations).where(eq(locations.name, name));
  return { ok: true };
}

export async function setCurrency(db: DB, raw: unknown): Promise<Result> {
  const v = String(raw ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(v)) return { ok: false, status: 400, error: 'Currency must be a 3-letter code like USD' };
  await db.insert(settings).values({ key: 'currency', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v } });
  return { ok: true };
}
