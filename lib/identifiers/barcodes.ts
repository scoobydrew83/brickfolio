// Retail barcodes in the identifiers map: kind 'set', scheme 'gtin', value the GTIN, canonical the set number, plus
// what the provider said about the box (barcode_details). The barcode scanner, the community list and Brickset use
// these helpers, so no other module touches the tables.
import { and, asc, eq, inArray, isNotNull, notInArray, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/types';
import { barcodeDetails, identifiers } from '../db/schema';
import { upcOf, type BarcodeFormat } from '../barcode/gtin';
import type { Source } from './resolve';

export type BarcodeRow = {
  id: number; barcode: string; format: BarcodeFormat; gtin: string; setNo: string; source: Source; verified: boolean;
  region: string | null; sourceRef: string | null; name: string | null; year: number | null; pieces: number | null; imageUrl: string | null;
  firstSeenAt: string; lastSeenAt: string; verifiedAt: string | null; createdAt: string; updatedAt: string;
};
export type NewBarcode = {
  barcode: string; format: BarcodeFormat; gtin: string; setNo: string; source: Source; verified?: boolean; verifiedAt?: string | null;
  region?: string | null; sourceRef?: string | null; name?: string | null; year?: number | null; pieces?: number | null; imageUrl?: string | null;
};

const nowIso = () => new Date().toISOString();
const isBarcode = and(eq(identifiers.kind, 'set'), eq(identifiers.scheme, 'gtin'));

/** A GTIN saved without details (e.g. from an offer feed) still has a barcode to show: its shortest spelling. */
const fallback = (gtin: string): { barcode: string; format: BarcodeFormat } =>
  upcOf(gtin) ? { barcode: upcOf(gtin)!, format: 'UPC_A' } : { barcode: gtin, format: gtin.length === 8 ? 'EAN_8' : 'EAN_13' };

/** Saved barcodes with their details, oldest first. */
export async function barcodeRows(db: DB, where: { gtin?: string; setNo?: string | string[]; source?: Source; verified?: boolean; named?: boolean; ids?: number[] } = {}, limit?: number): Promise<BarcodeRow[]> {
  const conds: (SQL | undefined)[] = [isBarcode];
  if (where.gtin) conds.push(eq(identifiers.value, where.gtin));
  if (typeof where.setNo === 'string') conds.push(eq(identifiers.canonical, where.setNo));
  if (Array.isArray(where.setNo)) conds.push(inArray(identifiers.canonical, where.setNo));
  if (where.ids) conds.push(inArray(identifiers.id, where.ids));
  if (where.source) conds.push(eq(identifiers.source, where.source));
  if (where.verified !== undefined) conds.push(eq(identifiers.verified, where.verified));
  if (where.named) conds.push(isNotNull(barcodeDetails.name));
  const q = db.select({
    id: identifiers.id, gtin: identifiers.value, setNo: identifiers.canonical, source: identifiers.source, verified: identifiers.verified,
    region: identifiers.region, sourceRef: identifiers.sourceRef, firstSeenAt: identifiers.firstSeenAt, lastSeenAt: identifiers.lastSeenAt,
    verifiedAt: identifiers.verifiedAt, createdAt: identifiers.createdAt, updatedAt: identifiers.updatedAt,
    barcode: barcodeDetails.barcode, format: barcodeDetails.format, name: barcodeDetails.name, year: barcodeDetails.year, pieces: barcodeDetails.pieces, imageUrl: barcodeDetails.imageUrl,
  }).from(identifiers).leftJoin(barcodeDetails, eq(barcodeDetails.identifierId, identifiers.id)).where(and(...conds)).orderBy(asc(identifiers.id));
  const rows = await (limit ? q.limit(limit) : q).all();
  return rows.map((r) => ({ ...r, ...(r.barcode && r.format ? { barcode: r.barcode, format: r.format } : fallback(r.gtin)) }));
}

/**
 * Saves a barcode → set link. When it's already saved (same GTIN, set and source), `onConflict` says what changes:
 * 'keep' nothing; 'seen' the last-seen time (and the confirmation, for a confirmed one); 'refresh' the provider's
 * details as well. Returns true when the link is new.
 */
export async function saveBarcode(db: DB, b: NewBarcode, onConflict: 'keep' | 'seen' | 'refresh' = 'keep'): Promise<boolean> {
  const t = nowIso();
  const details = { barcode: b.barcode, format: b.format, name: b.name ?? null, year: b.year ?? null, pieces: b.pieces ?? null, imageUrl: b.imageUrl ?? null };
  const [made] = await db.insert(identifiers).values({
    kind: 'set', scheme: 'gtin', value: b.gtin, canonical: b.setNo, source: b.source, verified: !!b.verified, verifiedAt: b.verifiedAt ?? null, region: b.region ?? null, sourceRef: b.sourceRef ?? null,
  }).onConflictDoNothing().returning({ id: identifiers.id }).all();
  if (made) {
    await db.insert(barcodeDetails).values({ identifierId: made.id, ...details }).onConflictDoNothing();
    return true;
  }
  if (onConflict === 'keep') return false;
  const key = and(isBarcode, eq(identifiers.value, b.gtin), eq(identifiers.canonical, b.setNo), eq(identifiers.source, b.source));
  const set = onConflict === 'refresh' ? { sourceRef: b.sourceRef ?? null, lastSeenAt: t, updatedAt: t } : { lastSeenAt: t, ...(b.verified ? { verified: true, verifiedAt: t, updatedAt: t } : {}) };
  const [row] = await db.update(identifiers).set(set).where(key).returning({ id: identifiers.id }).all();
  if (row && onConflict === 'refresh') {
    const { barcode: _b, format: _f, ...info } = details;
    await db.insert(barcodeDetails).values({ identifierId: row.id, ...details }).onConflictDoUpdate({ target: barcodeDetails.identifierId, set: info });
  }
  return false;
}

/** Marks every link of a GTIN as seen now (a scan hit it). */
export async function touchBarcode(db: DB, gtin: string) {
  await db.update(identifiers).set({ lastSeenAt: nowIso() }).where(and(isBarcode, eq(identifiers.value, gtin)));
}

/** Forgets every saved link between a GTIN and a set, whatever its source, details included. Returns how many were removed. */
export async function forgetBarcodeLinks(db: DB, gtin: string, setNo: string): Promise<number> {
  const gone = await db.delete(identifiers).where(and(isBarcode, eq(identifiers.value, gtin), eq(identifiers.canonical, setNo))).returning({ id: identifiers.id }).all();
  return gone.length;
}

/** Drops a source's links except `keep` ("gtin|setNo"), e.g. entries removed from the community list. */
export async function pruneBarcodes(db: DB, source: Source, keep: string[]) {
  const doomed = and(isBarcode, eq(identifiers.source, source), keep.length ? notInArray(sql`${identifiers.value} || '|' || ${identifiers.canonical}`, keep) : sql`1 = 1`);
  await db.delete(identifiers).where(doomed); // details go with them (on delete cascade)
}

/** Saved barcode links by source. */
export async function barcodeCounts(db: DB): Promise<Record<string, number>> {
  const rows = await db.select({ source: identifiers.source, n: sql<number>`count(*)` }).from(identifiers).where(isBarcode).groupBy(identifiers.source).all();
  return Object.fromEntries(rows.map((r) => [r.source, Number(r.n)]));
}
