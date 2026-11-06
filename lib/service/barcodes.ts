// Barcode writes: barcodes you confirm, corrections, and adding a batch of scanned sets. Adding goes through the
// existing collection and wishlist services (quickAdd, addWish), so their rules apply unchanged.
import { and, eq, sql } from 'drizzle-orm';
import type { Lookup, MinifigLookup } from '../bricklink/client';
import type { DB } from '../db/types';
import { barcodeMisses, sets } from '../db/schema';
import { withIdempotency } from './idempotency';
import { barcodeRows, forgetBarcodeLinks, saveBarcode } from '../identifiers/barcodes';
import { parseBarcode, type BarcodeFormat } from '../barcode/gtin';
import { CONDITIONS, placeholderName, setNo as fullSetNo, type Condition } from '../sets';
import { listLocations, quickAdd, type Result } from './sets';
import { addWish } from './wishlist';
import { addMinifig } from './minifigs';

const SET_NO = /^\d{3,7}(-\d{1,2})?$/;
const nowIso = () => new Date().toISOString();

/**
 * "This barcode is that set": saved as your own, confirmed barcode. It wins over anything a provider said, and is
 * used for every later scan. The set doesn't have to be in the collection.
 */
export async function rememberBarcode(db: DB, raw: unknown, no: unknown, hint?: BarcodeFormat | null): Promise<Result<{ gtin: string; setNo: string }>> {
  const b = parseBarcode(raw, hint);
  if (!b.ok) return { ok: false, status: 400, error: b.error };
  const n = String(no ?? '').trim();
  if (!SET_NO.test(n)) return { ok: false, status: 400, error: 'Set number must look like 10280 or 10280-1' };
  const setNo = fullSetNo(n);
  const t = nowIso();
  await saveBarcode(db, { barcode: b.raw, format: b.format, gtin: b.gtin, setNo, source: 'user', verified: true, verifiedAt: t }, 'seen');
  await db.delete(barcodeMisses).where(eq(barcodeMisses.gtin, b.gtin));
  return { ok: true, gtin: b.gtin, setNo };
}

/** "That's wrong": forgets every saved link between this barcode and this set, yours and providers'. */
export async function forgetBarcode(db: DB, raw: unknown, no: unknown): Promise<Result<{ removed: number }>> {
  const b = parseBarcode(raw);
  if (!b.ok) return { ok: false, status: 400, error: b.error };
  const n = String(no ?? '').trim();
  if (!SET_NO.test(n)) return { ok: false, status: 400, error: 'Set number must look like 10280 or 10280-1' };
  const removed = await forgetBarcodeLinks(db, b.gtin, fullSetNo(n));
  return removed ? { ok: true, removed } : { ok: false, status: 404, error: 'That barcode isn’t saved for that set.' };
}

/**
 * Saves barcodes Brickset sent with its set details (source 'brickset'), so sets you own or want scan without any
 * outside call. Existing rows are left alone; invalid codes are skipped.
 */
export async function saveBarcodesFromBrickset(db: DB, found: { setNo: string; ean?: string | null; upc?: string | null }[]): Promise<number> {
  let saved = 0;
  for (const s of found) {
    for (const code of [s.ean, s.upc]) {
      const b = code ? parseBarcode(code) : null;
      if (!b?.ok) continue;
      if (await saveBarcode(db, { barcode: b.raw, format: b.format, gtin: b.gtin, setNo: s.setNo, source: 'brickset' })) saved++;
    }
  }
  return saved;
}

// ---- adding scanned sets ----

export type ScanItem = { setNo: string; qty: number; target: 'collection' | 'wishlist'; condition: Condition; location: string | null };
export type ScanAddResult = { added: number; merged: number; wished: number; alreadyWished: number; waiting: number; figsAdded: number; figsMerged: number; replayed?: boolean };
/** A scanned Collectible Minifigure, by its Rebrickable number (from the series checklist). */
export type ScanFig = { rbFigNo: string; name: string; imageUrl: string | null; qty: number };
export const SCAN_BATCH_MAX = 200;

/** Validates a scan batch at the trust boundary. */
export function parseScanItems(raw: unknown, locations: readonly string[]): { ok: true; items: ScanItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Nothing to add.' };
  if (raw.length > SCAN_BATCH_MAX) return { ok: false, error: `Add at most ${SCAN_BATCH_MAX} sets at a time.` };
  const items: ScanItem[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const no = String(r?.setNo ?? '').trim();
    if (!SET_NO.test(no)) return { ok: false, error: `“${no.slice(0, 20)}” isn’t a set number.` };
    const qty = Number(r.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return { ok: false, error: 'Qty must be a whole number 1–999' };
    const target = r.target === 'wishlist' ? 'wishlist' : 'collection';
    const condition = (r.condition ?? 'New') as Condition;
    if (!(CONDITIONS as readonly string[]).includes(condition)) return { ok: false, error: `Condition must be one of: ${CONDITIONS.join(', ')}` };
    if (target === 'wishlist' && condition === 'Partial') return { ok: false, error: 'A wishlist set is New or Used.' };
    const location = r.location ? String(r.location) : null;
    if (location && !locations.includes(location)) return { ok: false, error: `Location must be one of: ${locations.join(', ')}` };
    items.push({ setNo: fullSetNo(no), qty, target, condition, location });
  }
  return { ok: true, items };
}

/** Validates scanned minifigures at the trust boundary. */
export function parseScanFigs(raw: unknown): { ok: true; figs: ScanFig[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, figs: [] };
  if (!Array.isArray(raw) || raw.length > SCAN_BATCH_MAX) return { ok: false, error: `Add at most ${SCAN_BATCH_MAX} minifigures at a time.` };
  const figs: ScanFig[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const rb = String(r?.rbFigNo ?? '').trim().toLowerCase();
    if (!/^fig-\d{6}$/.test(rb)) return { ok: false, error: 'Rebrickable numbers look like fig-013525.' };
    const qty = Number(r.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { ok: false, error: 'Qty must be a whole number 1–99' };
    const name = String(r.name ?? '').trim().slice(0, 120) || rb;
    const img = typeof r.imageUrl === 'string' && /^https:\/\//.test(r.imageUrl) ? r.imageUrl.slice(0, 500) : null;
    figs.push({ rbFigNo: rb, name, imageUrl: img, qty });
  }
  return { ok: true, figs };
}

/**
 * Adds scanned sets: to the collection through quickAdd (a set you own gets more copies, as you confirmed on the
 * review screen) and to the wishlist through addWish. With a `key`, sending the same batch again returns the
 * first answer instead of adding twice; a batch that failed part-way can be sent again with a new key.
 */
export async function addScanned(
  db: DB, items: ScanItem[],
  opts: { key?: string | null; lookup: Lookup | null; minifig: MinifigLookup | null; figs?: ScanFig[] },
): Promise<Result<ScanAddResult>> {
  return withIdempotency<ScanAddResult>(db, '', opts.key, async () => {
  try {
    const out: ScanAddResult = { added: 0, merged: 0, wished: 0, alreadyWished: 0, waiting: 0, figsAdded: 0, figsMerged: 0 };
    // quickAdd takes one condition and location per list, so group by them. Repeats of a set add up.
    const groups = new Map<string, { condition: Condition; location: string | null; sets: Map<string, number> }>();
    for (const i of items.filter((x) => x.target === 'collection')) {
      const g = `${i.condition}|${i.location ?? ''}`;
      if (!groups.has(g)) groups.set(g, { condition: i.condition, location: i.location, sets: new Map() });
      const m = groups.get(g)!.sets;
      m.set(i.setNo, (m.get(i.setNo) ?? 0) + i.qty);
    }
    // Check every location before writing anything, so a bad one can't leave half a batch added.
    const known = await listLocations(db);
    const bad = [...groups.values()].find((g) => g.location && !known.includes(g.location));
    if (bad) throw new Error(`Unknown location ${bad.location}.`);
    // Look sets up on BrickLink now only for a small batch, like Paste a list.
    const total = [...groups.values()].reduce((t, g) => t + g.sets.size, 0);
    for (const g of groups.values()) {
      const list = { sets: [...g.sets].map(([setNo, qty]) => ({ setNo, qty })), minifigs: [], invalid: [] };
      const r = await quickAdd(db, list, { condition: g.condition, location: g.location, lookup: total <= 10 ? opts.lookup : null, minifig: opts.minifig });
      if (!r.ok) throw new Error(r.error);
      out.added += r.added; out.merged += r.merged; out.waiting += r.waiting;
    }
    await nameFromBarcodes(db, [...new Set(items.filter((i) => i.target === 'collection').map((i) => i.setNo))]);
    for (const i of [...new Map(items.filter((x) => x.target === 'wishlist').map((x) => [x.setNo, x])).values()]) {
      const r = await addWish(db, { setNo: i.setNo, condition: i.condition === 'Used' ? 'Used' : 'New' }, opts.lookup);
      if (r.ok) out.wished++; else if (r.status === 409) out.alreadyWished++; else throw new Error(r.error);
    }
    // Minifigures go to the Minifigures list as unpriced checklist figures (more copies of ones you have).
    for (const f of opts.figs ?? []) {
      const r = await addMinifig(db, { rbFigNo: f.rbFigNo, name: f.name, imageUrl: f.imageUrl, qty: f.qty, condition: 'New' }, { lookup: null, merge: true });
      if (!r.ok) throw new Error(r.error);
      if (r.merged) out.figsMerged++; else out.figsAdded++;
    }
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  });
}

/**
 * A scanned set added without a BrickLink lookup keeps its placeholder name ("Set 75192"). When the barcode
 * provider gave a name, photo or piece count, use them until BrickLink fills in its own.
 */
async function nameFromBarcodes(db: DB, nos: string[]) {
  if (!nos.length) return;
  const known = await barcodeRows(db, { setNo: nos, named: true });
  for (const k of known) {
    await db.update(sets).set({
      name: k.name!,
      year: sql`coalesce(${sets.year}, ${k.year})`,
      pieces: sql`coalesce(${sets.pieces}, ${k.pieces})`,
      imageUrl: sql`coalesce(${sets.imageUrl}, ${k.imageUrl})`,
    }).where(and(eq(sets.setNo, k.setNo), eq(sets.name, placeholderName(k.setNo))));
  }
}
