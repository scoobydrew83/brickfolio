// Loose parts in lots (roadmap 5): bins, drawers and bags, and the parts of set copies you've parted out. Filled by hand,
// by BrickLink XML or Rebrickable CSV import (lib/service/partfile.ts), and by marking a copy "parted out".
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { insertChunked } from '../db/chunk';
import { colors, partLotImports, partLots, setCopies, setMissingParts, setParts, sets } from '../db/schema';
import type { DB } from '../db/types';
import type { PartLookup } from '../rebrickable/client';
import { displayNo } from '../sets';
import { buildNames, lotReservations } from './allocations';
import { readPartsFile, type FileKind } from './partfile';
import type { Result } from './sets';

const nowIso = () => new Date().toISOString();
const NO_COLOR = -1;

export type LotInput = {
  type?: string; partNo?: string; colorId?: number | null; name?: string | null; qty?: number; condition?: 'N' | 'U' | null;
  location?: string | null; approximate?: boolean; notes?: string | null;
};
export type LotRow = {
  id: number; type: string; partNo: string; colorId: number | null; name: string | null; colorName: string | null; rgb: string | null;
  qty: number; condition: 'N' | 'U' | null; location: string | null; source: 'bin' | 'set_copy'; setCopyId: number | null;
  /** The parted-out copy it came from: "10280-1, copy 2". */
  from: string | null;
  approximate: boolean; mapped: boolean; notes: string | null; importBatch: string | null;
  reserved: number; reservedFor: { mocNo: string; name: string; qty: number }[];
  createdAt: string; updatedAt: string;
};

const TYPES = ['PART', 'MINIFIG', 'GEAR', 'BOOK', 'CATALOG', 'INSTRUCTION', 'SET', 'ORIGINAL_BOX'];

/** Validates a lot from a form or JSON. `partial` = edit. The location must be one you have, or empty. */
export function parseLotInput(raw: unknown, locations: readonly string[], partial = false): { ok: true; value: LotInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (r[k] === undefined || r[k] === null ? undefined : String(r[k]).trim());
  const value: LotInput = {};
  const type = str('type');
  if (type) {
    if (!TYPES.includes(type.toUpperCase())) return { ok: false, error: `Type must be one of: ${TYPES.join(', ')}.` };
    value.type = type.toUpperCase();
  }
  const partNo = str('partNo');
  if (partNo !== undefined) {
    if (!partNo || partNo.length > 64 || /\s/.test(partNo)) return { ok: false, error: 'Enter the BrickLink part number, e.g. 3001.' };
    value.partNo = partNo;
  } else if (!partial) return { ok: false, error: 'Enter the BrickLink part number, e.g. 3001.' };
  const color = str('colorId');
  if (color !== undefined) {
    if (color === '' || color === '-1') value.colorId = null;
    else if (!/^\d+$/.test(color)) return { ok: false, error: 'Colour must be a BrickLink colour number, e.g. 5 for red.' };
    else value.colorId = Number(color);
  }
  const qty = str('qty');
  if (qty !== undefined || !partial) {
    const n = Number(qty);
    if (!qty || !Number.isInteger(n) || n < 1 || n > 1_000_000) return { ok: false, error: 'Quantity must be a whole number of 1 or more.' };
    value.qty = n;
  }
  const cond = str('condition');
  if (cond !== undefined) {
    if (cond && cond !== 'N' && cond !== 'U') return { ok: false, error: 'Condition must be N (new) or U (used).' };
    value.condition = (cond || null) as LotInput['condition'];
  }
  const loc = str('location');
  if (loc !== undefined) {
    if (loc && !locations.includes(loc)) return { ok: false, error: `Location must be one of: ${locations.join(', ') || '(none yet: add them in Settings)'}.` };
    value.location = loc || null;
  }
  for (const [k, max] of [['name', 120], ['notes', 2000]] as const) {
    const v = str(k);
    if (v === undefined) continue;
    if (v.length > max) return { ok: false, error: `${k === 'name' ? 'Name' : 'Notes'} is too long (${max} characters at most).` };
    value[k] = v || null;
  }
  if (r.approximate !== undefined) value.approximate = r.approximate === true || r.approximate === 'on' || r.approximate === 'true';
  return { ok: true, value };
}

/* ---------- reading ---------- */

export type LotFilter = { q?: string; location?: string; limit?: number; offset?: number };

/** Lots matching a search (part number, name, colour, location), with colour names and what's reserved on each. */
export async function listLots(db: DB, f: LotFilter = {}): Promise<{ lots: LotRow[]; total: number; pieces: number }> {
  const q = f.q?.trim();
  const where = and(
    f.location === '' ? undefined : f.location === '-' ? isNull(partLots.location) : f.location ? eq(partLots.location, f.location) : undefined,
    q ? or(like(partLots.partNo, `%${q}%`), like(partLots.name, `%${q}%`), like(colors.name, `%${q}%`), like(partLots.location, `%${q}%`)) : undefined,
  );
  const [{ n, pieces }] = await db.select({ n: sql<number>`count(*)`, pieces: sql<number>`coalesce(sum(${partLots.qty}), 0)` }).from(partLots).leftJoin(colors, eq(colors.id, partLots.colorId)).where(where).all();
  const rows = await db.select({
    lot: partLots, colorName: colors.name, rgb: colors.rgb, setNo: sets.setNo,
    copyNo: sql<number | null>`(select count(*) from "set_copies" c where c."set_id" = "set_copies"."set_id" and c."id" <= "set_copies"."id")`,
    copies: sql<number | null>`(select count(*) from "set_copies" c where c."set_id" = "set_copies"."set_id")`,
  }).from(partLots).leftJoin(colors, eq(colors.id, partLots.colorId))
    .leftJoin(setCopies, eq(setCopies.id, partLots.setCopyId)).leftJoin(sets, eq(sets.id, setCopies.setId))
    .where(where).orderBy(asc(partLots.location), asc(partLots.partNo), asc(partLots.colorId), asc(partLots.id))
    .limit(Math.min(Math.max(f.limit ?? 200, 1), 1000)).offset(Math.max(f.offset ?? 0, 0)).all();
  const res = await lotReservations(db, rows.map((r) => r.lot.id));
  return {
    total: Number(n), pieces: Number(pieces),
    lots: rows.map(({ lot: l, colorName, rgb, setNo, copyNo, copies }) => ({
      id: l.id, type: l.type, partNo: l.partNo, colorId: l.colorId === NO_COLOR ? null : l.colorId, name: l.name, colorName, rgb, qty: l.qty,
      condition: l.condition, location: l.location, source: l.source, setCopyId: l.setCopyId,
      from: l.source !== 'set_copy' ? null : setNo ? `${displayNo(setNo)}${Number(copies) > 1 ? `, copy ${copyNo}` : ''}` : 'a removed set copy',
      approximate: l.approximate, mapped: l.mapped, notes: l.notes, importBatch: l.importBatch,
      reserved: res.get(l.id)?.qty ?? 0, reservedFor: res.get(l.id)?.builds ?? [], createdAt: l.createdAt, updatedAt: l.updatedAt,
    })),
  };
}

/** Locations that hold lots, for the filter. */
export async function lotLocations(db: DB): Promise<(string | null)[]> {
  return (await db.selectDistinct({ location: partLots.location }).from(partLots).orderBy(asc(partLots.location)).all()).map((r) => r.location);
}

/** A part's name from the sets' parts lists, when one has it. */
async function nameOf(db: DB, type: string, partNo: string): Promise<string | null> {
  return (await db.select({ name: setParts.name }).from(setParts).where(and(eq(setParts.type, type), sql`lower(${setParts.partNo}) = ${partNo.toLowerCase()}`)).limit(1).get())?.name ?? null;
}

/* ---------- writing ---------- */

export async function addLot(db: DB, input: LotInput): Promise<Result<{ id: number }>> {
  if (!input.partNo || !input.qty) return { ok: false, status: 400, error: 'Part number and quantity are required.' };
  const type = input.type ?? 'PART';
  const [row] = await db.insert(partLots).values({
    type, partNo: input.partNo, colorId: type === 'PART' ? (input.colorId ?? NO_COLOR) : NO_COLOR, name: input.name ?? (await nameOf(db, type, input.partNo)),
    qty: input.qty, condition: input.condition ?? null, location: input.location ?? null, approximate: input.approximate ?? false, notes: input.notes ?? null,
  }).returning({ id: partLots.id }).all();
  return { ok: true, id: row.id };
}

/** Changes a lot. Its quantity can't go below what's reserved on it. */
export async function editLot(db: DB, id: number, input: LotInput): Promise<Result<{ id: number }>> {
  const lot = await db.select().from(partLots).where(eq(partLots.id, id)).get();
  if (!lot) return { ok: false, status: 404, error: `Lot ${id} doesn't exist.` };
  const res = (await lotReservations(db, [id])).get(id);
  if (res && input.qty !== undefined && input.qty < res.qty) {
    return { ok: false, status: 409, error: `${res.qty} of this lot ${res.qty === 1 ? 'is' : 'are'} reserved for ${buildNames(res.builds)}. Release some first, or keep at least ${res.qty}.` };
  }
  const changesPart = (input.partNo !== undefined && input.partNo.toLowerCase() !== lot.partNo.toLowerCase()) || (input.colorId !== undefined && (input.colorId ?? NO_COLOR) !== lot.colorId) || (input.type !== undefined && input.type !== lot.type);
  if (res && changesPart) return { ok: false, status: 409, error: `This lot is reserved for ${buildNames(res.builds)}. Release it before changing the part or colour.` };
  const { colorId, ...rest } = input;
  const fields = { ...rest, ...(colorId !== undefined ? { colorId: colorId ?? NO_COLOR } : {}), ...(changesPart ? { mapped: true } : {}) };
  // The floor is checked in the same statement, so a reservation made meanwhile can't end up above the new qty.
  const floor = sql`coalesce((select sum("qty") from "part_allocations" where "lot_id" = ${id}), 0) <= ${input.qty ?? lot.qty}`;
  const done = await db.update(partLots).set({ ...fields, updatedAt: nowIso() }).where(and(eq(partLots.id, id), floor)).returning({ id: partLots.id }).all();
  if (!done.length) return { ok: false, status: 409, error: 'Builds reserved more of this lot meanwhile. Reload and try again.' };
  return { ok: true, id };
}

/** Removes a lot. A reserved lot is refused unless `force`, which drops its reservations too. */
export async function removeLot(db: DB, id: number, force = false): Promise<Result> {
  const lot = await db.select({ id: partLots.id }).from(partLots).where(eq(partLots.id, id)).get();
  if (!lot) return { ok: false, status: 404, error: `Lot ${id} doesn't exist.` };
  const res = (await lotReservations(db, [id])).get(id);
  if (res && !force) return { ok: false, status: 409, error: `This lot is reserved for ${buildNames(res.builds)}. Release it first, or remove it anyway (force).` };
  await db.delete(partLots).where(eq(partLots.id, id));
  return { ok: true };
}

/* ---------- import ---------- */

export type ImportInput = { kind: FileKind; text: string; location: string | null; mode: 'add' | 'replace'; approximate: boolean; fileName?: string | null };
export type ImportResult = { batch: string; lots: number; pieces: number; merged: number; unmapped: number; skipped: number; note: string | null };

/** The key "add to a matching lot" merges on: same part, colour and location, a bin, and equally approximate. */
const mergeKey = (type: string, partNo: string, colorId: number, approximate: boolean, mapped: boolean) => `${type}|${partNo.toLowerCase()}|${colorId}|${approximate}|${mapped}`;

/**
 * Imports a parts file into one location. `add` adds to matching lots there (or makes new ones); `replace` sets their
 * quantity to the file's. A malformed file is refused whole. Each import can be undone (undoImport).
 */
export async function importLots(db: DB, input: ImportInput, deps: { rebrickable: PartLookup | null }): Promise<Result<ImportResult>> {
  const read = await readPartsFile(db, input.kind, input.text, deps.rebrickable);
  if (!read.ok) return { ok: false, status: read.status === 413 ? 413 : 400, error: read.error };
  const where = and(eq(partLots.source, 'bin'), input.location ? eq(partLots.location, input.location) : isNull(partLots.location), eq(partLots.approximate, input.approximate));
  const existing = new Map((await db.select().from(partLots).where(where).orderBy(asc(partLots.id)).all()).map((l) => [mergeKey(l.type, l.partNo, l.colorId, l.approximate, l.mapped), l]));

  const updates: { id: number; qty: number; prev: number }[] = [];
  const inserts: (typeof partLots.$inferInsert)[] = [];
  const batch = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  for (const l of read.lines) {
    const colorId = l.type === 'PART' ? (l.colorId ?? NO_COLOR) : NO_COLOR;
    const hit = existing.get(mergeKey(l.type, l.partNo, colorId, input.approximate, l.mapped));
    if (hit) updates.push({ id: hit.id, qty: input.mode === 'add' ? hit.qty + l.qty : l.qty, prev: hit.qty });
    else inserts.push({ type: l.type, partNo: l.partNo, colorId, qty: l.qty, condition: l.condition, location: input.location, approximate: input.approximate, mapped: l.mapped, importBatch: batch });
  }
  // Replacing can't drop a lot below what builds have reserved on it.
  if (input.mode === 'replace' && updates.length) {
    const res = await lotReservations(db, updates.map((u) => u.id));
    const low = updates.find((u) => (res.get(u.id)?.qty ?? 0) > u.qty);
    if (low) {
      const lot = [...existing.values()].find((l) => l.id === low.id)!;
      return { ok: false, status: 409, error: `${lot.name ?? lot.partNo} has ${res.get(low.id)!.qty} reserved for ${buildNames(res.get(low.id)!.builds)}, more than the file's ${low.qty}. Nothing was imported.` };
    }
  }

  const names = await partNames(db, inserts.map((i) => i.partNo));
  for (const i of inserts) i.name = names.get(`${i.type}|${i.partNo.toLowerCase()}`) ?? null;
  await insertChunked(inserts, (c) => db.insert(partLots).values(c));
  const t = nowIso();
  for (const u of updates) await db.update(partLots).set({ qty: u.qty, importBatch: batch, importPrevQty: u.prev, updatedAt: t }).where(eq(partLots.id, u.id));
  const pieces = read.lines.reduce((s, l) => s + l.qty, 0);
  await db.insert(partLotImports).values({ id: batch, kind: input.kind, fileName: input.fileName?.slice(0, 200) ?? null, location: input.location, mode: input.mode, lots: read.lines.length, pieces });
  return { ok: true, batch, lots: inserts.length, pieces, merged: updates.length, unmapped: read.unmapped, skipped: read.skipped, note: read.note };
}

/** Names for part numbers from the sets' parts lists, keyed `type|partno`. One grouped query per chunk. */
async function partNames(db: DB, partNos: string[]): Promise<Map<string, string>> {
  const nos = [...new Set(partNos.map((p) => p.toLowerCase()))];
  const out = new Map<string, string>();
  for (let i = 0; i < nos.length; i += 90) {
    const rows = await db.select({ type: setParts.type, partNo: sql<string>`lower(${setParts.partNo})`, name: sql<string>`max(${setParts.name})` }).from(setParts)
      .where(inArray(sql`lower(${setParts.partNo})`, nos.slice(i, i + 90))).groupBy(setParts.type, sql`lower(${setParts.partNo})`).all();
    for (const r of rows) out.set(`${r.type}|${r.partNo}`, r.name);
  }
  return out;
}

/** Recent imports that can still be undone, newest first. */
export async function listImports(db: DB, limit = 5) {
  return db.select().from(partLotImports).where(isNull(partLotImports.undoneAt)).orderBy(desc(partLotImports.createdAt)).limit(limit).all();
}

/**
 * Undoes an import: lots it created go, lots it added to or replaced get their quantity back. A lot a later import
 * changed again is left alone (counted in `kept`). Refused when it would take away parts reserved for a build.
 */
export async function undoImport(db: DB, batch: string): Promise<Result<{ removed: number; restored: number; kept: number }>> {
  const imp = await db.select().from(partLotImports).where(eq(partLotImports.id, batch)).get();
  if (!imp) return { ok: false, status: 404, error: 'That import doesn\'t exist.' };
  if (imp.undoneAt) return { ok: false, status: 409, error: 'That import was already undone.' };
  const lots = await db.select().from(partLots).where(eq(partLots.importBatch, batch)).all();
  const res = await lotReservations(db, lots.map((l) => l.id));
  const blocked = lots.find((l) => (res.get(l.id)?.qty ?? 0) > (l.importPrevQty ?? 0));
  if (blocked) return { ok: false, status: 409, error: `${blocked.name ?? blocked.partNo} from this import is reserved for ${buildNames(res.get(blocked.id)!.builds)}. Release it first.` };
  const created = lots.filter((l) => l.importPrevQty === null).map((l) => l.id);
  for (let i = 0; i < created.length; i += 90) await db.delete(partLots).where(inArray(partLots.id, created.slice(i, i + 90)));
  const t = nowIso();
  const changed = lots.filter((l) => l.importPrevQty !== null);
  for (const l of changed) await db.update(partLots).set({ qty: l.importPrevQty!, importBatch: null, importPrevQty: null, updatedAt: t }).where(eq(partLots.id, l.id));
  await db.update(partLotImports).set({ undoneAt: t }).where(eq(partLotImports.id, batch));
  return { ok: true, removed: created.length, restored: changed.length, kept: Math.max(0, imp.lots - created.length - changed.length) };
}

/* ---------- parted-out set copies ---------- */

/**
 * Makes lots from a parted-out copy: its set's regular parts (no alternates or counterparts) with spares, less the
 * parts marked missing from the copy, in the copy's location. Does nothing when the copy already has lots.
 */
export async function partOutCopy(db: DB, copyId: number): Promise<number> {
  const c = await db.select().from(setCopies).where(eq(setCopies.id, copyId)).get();
  if (!c) return 0;
  if (await db.select({ id: partLots.id }).from(partLots).where(eq(partLots.setCopyId, copyId)).limit(1).get()) return 0;
  const parts = await db.select().from(setParts).where(and(eq(setParts.setId, c.setId), eq(setParts.alternate, false), eq(setParts.counterpart, false))).all();
  const missing = await db.select().from(setMissingParts).where(eq(setMissingParts.copyId, copyId)).all();
  const k = (type: string, partNo: string, colorId: number | null) => `${type}|${partNo.toLowerCase()}|${colorId ?? NO_COLOR}`;
  const gone = new Map<string, number>();
  for (const m of missing) gone.set(k(m.type, m.partNo, m.colorId), (gone.get(k(m.type, m.partNo, m.colorId)) ?? 0) + m.qty);
  const by = new Map<string, typeof partLots.$inferInsert>();
  for (const p of parts) {
    const key = k(p.type, p.partNo, p.colorId);
    const row = by.get(key);
    if (row) row.qty += p.qty + p.extra;
    else by.set(key, { type: p.type, partNo: p.partNo, colorId: p.colorId ?? NO_COLOR, name: p.name, qty: p.qty + p.extra, location: c.location, source: 'set_copy', setCopyId: copyId, condition: c.condition === 'New' ? 'N' : 'U' });
  }
  const t = nowIso();
  const rows = [...by.entries()].map(([key, r]) => ({ ...r, qty: r.qty - (gone.get(key) ?? 0), createdAt: t, updatedAt: t })).filter((r) => r.qty > 0);
  await insertChunked(rows, (ch) => db.insert(partLots).values(ch));
  return rows.length;
}

/**
 * Before a parted-out copy goes back to a set: its lots are deleted, but only when none was edited or reserved
 * (otherwise refused, nothing changes).
 */
export async function unPartCopy(db: DB, copyId: number): Promise<Result<{ removed: number }>> {
  const lots = await db.select().from(partLots).where(eq(partLots.setCopyId, copyId)).all();
  if (!lots.length) return { ok: true, removed: 0 };
  const res = await lotReservations(db, lots.map((l) => l.id));
  if (res.size) return { ok: false, status: 409, error: `Parts of this copy are reserved for ${buildNames([...res.values()].flatMap((r) => r.builds))}. Release them before putting the set back together.` };
  const edited = lots.filter((l) => l.updatedAt !== l.createdAt);
  if (edited.length) return { ok: false, status: 409, error: `${edited.length} of this copy's loose-part lots ${edited.length === 1 ? 'was' : 'were'} changed since it was parted out. Fix or remove ${edited.length === 1 ? 'it' : 'them'} on the Loose parts page first.` };
  for (let i = 0; i < lots.length; i += 90) await db.delete(partLots).where(inArray(partLots.id, lots.slice(i, i + 90).map((l) => l.id)));
  return { ok: true, removed: lots.length };
}
