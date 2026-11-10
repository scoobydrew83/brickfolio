// Collection logic shared by server actions, the REST API and the scheduler.
// Every function takes the database (and BrickLink lookup) as arguments, so tests can pass an in-memory one.
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { QUOTA_MESSAGE, type Lookup, type MinifigLookup, type PartPriceLookup, type PriceLookup, type Store } from '../bricklink/client';
import type { BuildSource, Catalog, IdCatalog } from '../rebrickable/client';
import type { DB } from '../db/types';
import { history, locations, minifigs, setCopies, sets, settings, syncRuns, wishlist } from '../db/schema';
import { hasParts, replaceParts } from './parts';
import { syncStore } from './store';
import { syncCatalog, themeMap, themeNames } from './catalog';
import { syncWishlist } from './wishlist';
import { syncBuilds } from './builds';
import { syncIdentifiers } from './identifiers';
import { syncRetail } from './retail';
import { reapplyMissing } from './missing';
import { partoutBudget, refreshPartPrices } from './partout';
import { Budget, otherGuideDailyCalls } from './budget';
import { refreshOtherGuide } from './other-guide';
import type { RetailSource } from '../brickset/client';
import { syncOmrModels } from './models';
import { alertsFromEnv, notifyUnderTarget } from './alerts';
import { notifyRetiring } from './radar';
import { notifyDesigner } from './designer';
import { addMinifig, syncMinifigs } from './minifigs';
import { syncCommunity } from '../barcode/community';
import { checkForUpdate } from './updates';
import type { ImageStore } from '../images/cache';
import { warmImages } from './images';
import { estValue, parseLocation, placeholderName, setGuide, totals, withCopies, type Condition, type CopyInput, type CopyRow, type HistoryRow, type QuickList, type SetInput, type SetRow } from '../sets';
import { editCopy, insertCopies, repriceCopies } from './copies';
import { priceSeries, recordPrice } from './prices';

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
  imageUrl: sets.imageUrl, pieces: sets.pieces, partLots: sets.partLots,
  registered: sets.registered, avgSold: sets.avgSold, minSold: sets.minSold,
  maxSold: sets.maxSold, qtySold: sets.qtySold, blError: sets.blError, lastUpdated: sets.lastUpdated, notes: sets.notes,
  themeId: sets.themeId, minifigs: sets.minifigs,
  retailPrice: sets.retailPrice, retailCurrency: sets.retailCurrency, launchDate: sets.launchDate, exitDate: sets.exitDate, retired: sets.retired,
  // Table-qualified on purpose: inside a subquery an unqualified "id" would mean the subquery table's own id.
  hasModel: sql<number>`exists (select 1 from "set_models" m where m."set_id" = "sets"."id")`,
  missingMarked: sql<number>`(select coalesce(sum(mp."qty"), 0) from "set_missing_parts" mp where mp."set_id" = "sets"."id")`,
};

type BaseRow = { [K in keyof typeof columns]: K extends 'hasModel' | 'missingMarked' ? number : unknown } & { id: number; themeId: number | null };

const copyColumns = {
  id: setCopies.id, setId: setCopies.setId, collectionId: setCopies.collectionId, status: setCopies.status, condition: setCopies.condition,
  missingPct: setCopies.missingPct, location: setCopies.location, acquiredDate: setCopies.acquiredDate, buildDate: setCopies.buildDate,
  pricePaid: setCopies.pricePaid, tax: setCopies.tax, shipping: setCopies.shipping, gwp: setCopies.gwp, estValue: setCopies.estValue,
  estGuide: setCopies.estGuide, notes: setCopies.notes,
  missingMarked: sql<number>`(select coalesce(sum(mp."qty"), 0) from "set_missing_parts" mp where mp."copy_id" = "set_copies"."id")`,
};

/** Copies per set id, oldest first. Without `setIds`, every copy (one query either way, no N+1). */
export async function copiesBySet(db: DB, setIds?: number[]): Promise<Map<number, CopyRow[]>> {
  if (setIds && !setIds.length) return new Map();
  const q = db.select(copyColumns).from(setCopies);
  const rows = await (setIds ? q.where(inArray(setCopies.setId, setIds)) : q).orderBy(asc(setCopies.setId), asc(setCopies.id)).all();
  const map = new Map<number, CopyRow[]>();
  for (const r of rows) {
    const c: CopyRow = { ...r, gwp: Boolean(r.gwp), missingMarked: Number(r.missingMarked ?? 0) };
    map.set(r.setId, [...(map.get(r.setId) ?? []), c]);
  }
  return map;
}

/** Swaps the Rebrickable theme id for readable theme and subtheme names, and attaches each set's copies. */
async function withThemes(db: DB, rows: BaseRow[], all = false): Promise<SetRow[]> {
  const map = rows.some((r) => r.themeId !== null) ? await themeMap(db) : new Map();
  const copies = await copiesBySet(db, all ? undefined : rows.map((r) => r.id));
  return rows.map(({ themeId, hasModel, missingMarked, ...r }) =>
    withCopies({ ...(r as unknown as Omit<SetRow, 'theme' | 'subtheme'>), hasModel: Boolean(hasModel), missingMarked: Number(missingMarked ?? 0), ...themeNames(map, themeId) }, copies.get(r.id) ?? []));
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
  return withThemes(db, (await db.select(columns).from(sets).orderBy(asc(sets.setNo)).all()) as BaseRow[], true);
}

export async function getSet(db: DB, no: string): Promise<SetRow | undefined> {
  const row = await db.select(columns).from(sets).where(eq(sets.setNo, no)).get();
  return row && (await withThemes(db, [row as BaseRow]))[0];
}

export async function listHistory(db: DB): Promise<HistoryRow[]> {
  return db.select().from(history).orderBy(asc(history.date)).all();
}

export type PricePointRow = { date: string; guide: 'N' | 'U'; avgSold: number | null; minSold: number | null; maxSold: number | null; qtySold: number | null };

/**
 * A set's BrickLink sold prices per day in today's currency, oldest first, in whichever guide each lookup used (the
 * last row is the latest lookup's guide). Kept by set number, so it survives removing and re-adding the set.
 */
export async function priceHistory(db: DB, setNo: string): Promise<PricePointRow[]> {
  return (await priceSeries(db, 'set', setNo, { source: 'bricklink', type: 'sold_avg', currency: await getCurrency(db) }))
    .map((p) => ({ date: p.observedOn, guide: p.condition, avgSold: p.amount, minSold: p.low, maxSold: p.high, qtySold: p.sampleSize }));
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
 * Runs the BrickLink lookup for one set and stores the result (or the error) on it, then re-prices its copies.
 * Until both guides are fetched (roadmap #4), one guide per set: the one most of its copies need (setGuide).
 * The parts list is only fetched while the set has no piece count, since it rarely changes on BrickLink.
 */
export async function lookupInto(db: DB, s: Pick<SetRow, 'id' | 'setNo'> & { copies?: Pick<CopyRow, 'status' | 'condition'>[] }, lookup: Lookup, currency: string): Promise<string | null> {
  const guide = setGuide(s.copies ?? (await copiesBySet(db, [s.id])).get(s.id) ?? []);
  try {
    const { parts, pieces: _p, partLots: _l, ...r } = await lookup(s.setNo, guide, currency, { parts: !(await hasParts(db, s.id)) });
    if (parts) await replaceParts(db, s.id, parts); // also sets pieces and part lots
    await db.update(sets)
      .set({
        ...r, estValue: estValue(r.avgSold, null), blError: null, lastUpdated: nowIso(), updatedAt: nowIso(),
        // A pasted set keeps its placeholder name until BrickLink answers.
        name: sql`case when ${sets.name} = ${placeholderName(s.setNo)} then ${r.blName} else ${sets.name} end`,
      })
      .where(eq(sets.id, s.id));
    await recordPrice(db, {
      itemKind: 'set', itemId: s.setNo, source: 'bricklink', type: 'sold_avg', condition: guide, currency,
      amount: r.avgSold, low: r.minSold, high: r.maxSold, sampleSize: r.qtySold, observedOn: today(),
    });
    await repriceCopies(db, s.id, guide);
    return null;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db.update(sets).set({ blError: error, lastUpdated: nowIso() }).where(eq(sets.id, s.id));
    return error;
  }
}

/** The copy fields a set-level input carries (condition, location, Missing %, plus `copy`). */
const copyFields = (input: SetInput): CopyInput => {
  const c: CopyInput = { ...input.copy };
  if (input.condition !== undefined) c.condition ??= input.condition;
  if (input.location !== undefined) c.location ??= input.location;
  if (input.missingPct !== undefined) c.missingPct ??= input.missingPct;
  if (c.condition === 'New' && !c.status) c.status = 'sealed';
  if (c.status === 'sealed') c.condition = 'New';
  return c;
};

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
    await insertCopies(db, have.id, copyFields(input), 1);
    await db.update(sets).set({ updatedAt: nowIso() }).where(eq(sets.id, have.id));
    await repriceCopies(db, have.id);
    return { ok: true, set: (await getSet(db, input.setNo))! };
  }
  const inserted = await db.insert(sets)
    .values({ setNo: input.setNo, name: input.name!, registered: input.registered ?? null, notes: input.notes ?? null })
    .onConflictDoNothing()
    .returning({ id: sets.id })
    .all();
  if (!inserted.length) return { ok: false, status: 409, error: `#${input.setNo} was just added by someone else.` };
  await insertCopies(db, inserted[0].id, copyFields(input), input.qty ?? 1);
  const row = (await getSet(db, input.setNo))!;
  if (opts.lookup) await lookupInto(db, row, opts.lookup, await getCurrency(db));
  return { ok: true, set: (await getSet(db, input.setNo))! };
}

/** Up to this many new items in a pasted list are looked up right away; the rest wait for the next sync. */
export const QUICK_LOOKUPS = 10;

export type QuickAddResult = { added: number; merged: number; waiting: number; figsAdded: number; figsMerged: number; invalid: string[] };

/**
 * Adds a pasted list (see parseQuickList). Sets already in the collection get more copies. New ones are added
 * with a placeholder name; small lists are looked up straight away, bigger ones at the next sync so a long
 * paste can't use up the BrickLink daily limit.
 */
export async function quickAdd(
  db: DB, list: QuickList,
  opts: { location?: string | null; condition?: Condition; lookup: Lookup | null; minifig: MinifigLookup | null },
): Promise<Result<QuickAddResult>> {
  if (opts.location && !(await listLocations(db)).includes(opts.location)) return { ok: false, status: 400, error: `Unknown location ${opts.location}.` };
  const out: QuickAddResult = { added: 0, merged: 0, waiting: 0, figsAdded: 0, figsMerged: 0, invalid: list.invalid };
  const now = list.sets.length + list.minifigs.length <= QUICK_LOOKUPS;
  const currency = await getCurrency(db);
  for (const { setNo: no, qty } of list.sets) {
    const have = await getSet(db, no);
    const copy = copyFields({ setNo: no, condition: opts.condition ?? 'Used', location: opts.location ?? null });
    if (have) {
      await insertCopies(db, have.id, copy, qty);
      await db.update(sets).set({ updatedAt: nowIso() }).where(eq(sets.id, have.id));
      await repriceCopies(db, have.id);
      out.merged++;
      continue;
    }
    const ins = await db.insert(sets).values({ setNo: no, name: placeholderName(no) }).onConflictDoNothing().returning({ id: sets.id }).all();
    if (ins.length) await insertCopies(db, ins[0].id, copy, qty);
    out.added++;
    const row = await getSet(db, no);
    if (row && now && opts.lookup) await lookupInto(db, row, opts.lookup, currency);
    else out.waiting++;
  }
  for (const f of list.minifigs) {
    const r = await addMinifig(db, { figNo: f.figNo, qty: f.qty, condition: opts.condition === 'New' ? 'New' : 'Used', location: opts.location ?? null }, { lookup: now ? opts.minifig : null, merge: true });
    if (!r.ok) { out.invalid.push(f.figNo); continue; }
    if (r.merged) out.figsMerged++; else { out.figsAdded++; if (!now || !opts.minifig) out.waiting++; }
  }
  return { ok: true, ...out };
}

/**
 * Updates the given fields. Name, notes and registered belong to the set. Condition, location and Missing % belong
 * to copies: they're applied when the set has one copy, and refused (409) with several unless they're unchanged.
 * `qty` adds copies (cloned from the newest, without cost) or removes the newest ones.
 */
export async function editSet(db: DB, input: SetInput, lookup: Lookup | null): Promise<Result<{ set: SetRow }>> {
  const before = await getSet(db, input.setNo);
  if (!before) return { ok: false, status: 404, error: `#${input.setNo} isn't in the collection.` };
  const { setNo: _no, qty, condition, location, missingPct, copy: _c, ...fields } = input;
  const active = before.copies.filter((c) => c.status !== 'parted_out');
  const changes: CopyInput = {};
  if (condition !== undefined && (before.mixed.condition || condition !== before.condition)) changes.condition = condition;
  if (location !== undefined && (before.mixed.location || location !== before.location)) changes.location = location;
  if (missingPct !== undefined && missingPct !== before.missingPct) changes.missingPct = missingPct;
  if (Object.keys(changes).length && active.length > 1) {
    return { ok: false, status: 409, error: `#${input.setNo} has ${active.length} copies. Edit the copies instead.` };
  }
  if (Object.keys(fields).length) await db.update(sets).set({ ...fields, updatedAt: nowIso() }).where(eq(sets.id, before.id));
  if (Object.keys(changes).length && active.length === 1) {
    const r = await editCopy(db, active[0].id, changes, lookup);
    if (!r.ok) return r;
  }
  if (qty !== undefined && qty !== active.length) {
    if (qty > active.length) {
      const src = active.at(-1) ?? before.copies.at(-1);
      await insertCopies(db, before.id, src ? { status: src.status === 'parted_out' ? 'built' : src.status, condition: src.condition, location: src.location, missingPct: src.missingPct } : copyFields(input), qty - active.length);
      await repriceCopies(db, before.id);
    } else {
      const drop = active.slice(qty).map((c) => c.id);
      await db.delete(setCopies).where(inArray(setCopies.id, drop));
    }
  }
  return { ok: true, set: (await getSet(db, input.setNo))! };
}

/** Removes the newest copy that isn't parted out; deletes the set when its last copy goes. */
export async function removeOne(db: DB, no: string): Promise<Result<{ remaining: number }>> {
  const s = await getSet(db, no);
  if (!s) return { ok: false, status: 404, error: `#${no} isn't in the collection.` };
  const victim = s.copies.filter((c) => c.status !== 'parted_out').at(-1) ?? s.copies.at(-1);
  if (victim) await db.delete(setCopies).where(eq(setCopies.id, victim.id));
  const [{ left, active }] = await db.select({ left: sql<number>`count(*)`, active: sql<number>`coalesce(sum(case when ${setCopies.status} <> 'parted_out' then 1 else 0 end), 0)` })
    .from(setCopies).where(eq(setCopies.setId, s.id)).all();
  if (!Number(left)) {
    await db.delete(sets).where(eq(sets.id, s.id));
    return { ok: true, remaining: 0 };
  }
  await db.update(sets).set({ updatedAt: nowIso() }).where(eq(sets.id, s.id));
  return { ok: true, remaining: Number(active) };
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
/** Optional BrickLink extras for the sync: minifigure prices and part prices for part-out value. */
export type SyncExtras = { minifig?: MinifigLookup; partPrice?: PartPriceLookup; price?: PriceLookup; images?: ImageStore };

export async function runSync(db: DB, runId: number, lookup: Lookup, store?: Store, catalog?: Catalog & Partial<BuildSource> & Partial<IdCatalog>, retail?: RetailSource, extras: SyncExtras = {}): Promise<void> {
  try {
    const currency = await getCurrency(db);
    const copies = await copiesBySet(db);
    const all = (await db.select({ id: sets.id, setNo: sets.setNo }).from(sets).all()).map((r) => ({ ...r, copies: copies.get(r.id) ?? [] }));
    let errors = 0;
    // Once BrickLink's daily limit is used up, every later call fails the same way: skip the remaining BrickLink
    // steps (they keep their last prices) and still do the rest.
    let quotaAt: number | null = null;
    for (const [i, s] of all.entries()) {
      const error = await lookupInto(db, s, lookup, currency);
      if (error) errors++;
      await db.update(syncRuns).set({ processed: i + 1, errors }).where(eq(syncRuns.id, runId));
      if (error === QUOTA_MESSAGE) { quotaAt = i; break; }
    }
    const bl = quotaAt === null;
    const figErrors = extras.minifig && bl ? await syncMinifigs(db, extras.minifig, currency) : 0;
    // BrickLink calls, in priority order: sets, minifigs, wishlist and store first; then the other guide; then part prices.
    const budget = new Budget();
    budget.spend(all.length * 2 + (extras.minifig ? Number((await db.select({ n: sql<number>`count(*)` }).from(minifigs).where(sql`fig_no is not null`).all())[0].n) * 2 : 0));
    await saveHistory(db);
    const wishErrors = bl ? await syncWishlist(db, lookup, currency) : 0;
    budget.spend(Number((await db.select({ n: sql<number>`count(*)` }).from(wishlist).all())[0].n) * 2 + (store ? 3 : 0));
    const send = alertsFromEnv();
    const alertError = send ? await notifyUnderTarget(db, send) : null;
    const storeErrors = store && bl ? await syncStore(db, store) : [];
    const catalogErrors = catalog ? await syncCatalog(db, catalog) : [];
    if (catalog?.colors && catalog.partsPage) catalogErrors.push(...(await syncIdentifiers(db, { colors: catalog.colors, partsPage: catalog.partsPage })));
    if (catalog?.alternates && catalog.buildParts) catalogErrors.push(...(await syncBuilds(db, { alternates: catalog.alternates, buildParts: catalog.buildParts })));
    if (retail) catalogErrors.push(...(await syncRetail(db, retail)));
    // The shared community barcode list (one small request; unchanged lists cost almost nothing).
    const communityError = await syncCommunity(db);
    if (communityError) catalogErrors.push(communityError);
    // After Brickset, so exit dates are fresh.
    const retireError = send ? await notifyRetiring(db, send) : null;
    if (retireError) catalogErrors.push(retireError);
    const designerError = send ? await notifyDesigner(db, send) : null;
    // Whether a newer Brickfolio release is out (at most once a day; shown in Settings, never in the sync message).
    await checkForUpdate(db);
    if (designerError) catalogErrors.push(designerError);
    // 3D models from LDraw's OMR, only when a parts library is set up (the 3D view needs it anyway).
    const hasLibrary = !!(process.env.LDRAW_LIBRARY_DIR || process.env.LDRAW_LIBRARY_URL);
    if (hasLibrary && process.env.LDRAW_OMR_SYNC !== 'off') catalogErrors.push(...(await syncOmrModels(db)));
    // Photos not in the image cache yet (CDN fetches, not BrickLink API calls), after the lookups filled in image URLs.
    if (extras.images) catalogErrors.push(...(await warmImages(db, extras.images)).errors);
    // The other condition's price guide (new vs. used gap), about weekly per set, 1 call each.
    if (extras.price && bl) {
      const r = await refreshOtherGuide(db, extras.price, currency, { maxCalls: Math.min(otherGuideDailyCalls(all.length), budget.left()) });
      budget.spend(r.fetched + r.errors);
      if (r.errors) catalogErrors.push(`${r.errors} new/used price lookup${r.errors === 1 ? '' : 's'} failed`);
    }
    // Part prices for part-out value, with whatever is left of today's BrickLink budget.
    if (extras.partPrice && bl) {
      const r = await refreshPartPrices(db, extras.partPrice, currency, { maxCalls: partoutBudget(budget.used) });
      if (r.fetched) await reapplyMissing(db);
      if (r.errors) catalogErrors.push(`${r.errors} part price lookup${r.errors === 1 ? '' : 's'} failed`);
    }
    const quotaNote = bl ? '' : `${QUOTA_MESSAGE} ${quotaAt} of ${all.length} sets were looked up first.`;
    const message = [quotaNote, ...storeErrors, alertError ?? '', wishErrors ? `${wishErrors} wishlist lookup${wishErrors === 1 ? '' : 's'} failed` : '', figErrors ? `${figErrors} minifig lookup${figErrors === 1 ? '' : 's'} failed` : '', ...catalogErrors.slice(0, 3), catalogErrors.length > 3 ? `and ${catalogErrors.length - 3} more errors` : ''].filter(Boolean).join('; ');
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

/** Renames a location and moves its copies along with it. */
export async function renameLocation(db: DB, from: string, raw: unknown): Promise<Result> {
  const p = parseLocation(raw);
  if (!p.ok) return { ...p, status: 400 };
  if ((await listLocations(db)).includes(p.value)) return { ok: false, status: 409, error: `${p.value} already exists.` };
  const r = await db.update(locations).set({ name: p.value }).where(eq(locations.name, from)).returning().all();
  if (!r.length) return { ok: false, status: 404, error: `${from} doesn't exist.` };
  await db.update(setCopies).set({ location: p.value }).where(eq(setCopies.location, from));
  return { ok: true };
}

/** Deletes a location only when no copy uses it, so nothing is silently moved. */
export async function deleteLocation(db: DB, name: string): Promise<Result> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(setCopies).where(eq(setCopies.location, name)).all();
  if (n) return { ok: false, status: 409, error: `${n} cop${n === 1 ? 'y' : 'ies'} still use ${name}. Move them first.` };
  await db.delete(locations).where(eq(locations.name, name));
  return { ok: true };
}

export async function setCurrency(db: DB, raw: unknown): Promise<Result> {
  const v = String(raw ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(v)) return { ok: false, status: 400, error: 'Currency must be a 3-letter code like USD' };
  await db.insert(settings).values({ key: 'currency', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v } });
  return { ok: true };
}
