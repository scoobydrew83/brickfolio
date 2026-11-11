// MILS layouts (roadmap 9): a grid of baseplate modules, each holding set copies and builds, and what the whole layout
// still needs as one parts list and BrickLink Wanted List. Grid maths is in lib/layouts.ts, shared with the editor.
import { and, asc, eq, inArray, like, ne, or, sql } from 'drizzle-orm';
import { partKey, toWantedListXml, type WantedItem } from '../bricklink/wanted';
import { buildParts, builds, colors, layoutModuleItems, layoutModules, layouts, setCopies, setMissingParts, setParts, sets } from '../db/schema';
import type { DB } from '../db/types';
import { KIND_LABEL, MAX_CELLS, MAX_MODULE, MODULE_KINDS, ROTATIONS, footprint, nextRotation, placementError, type ModuleKind, type Rotation } from '../layouts';
import { displayNo, STATUS_LABEL, type CopyRow } from '../sets';
import type { Result } from './sets';
import { autoReserve, availability } from './allocations';

const nowIso = () => new Date().toISOString();

export type LayoutInput = { name?: string; cols?: number; rows?: number; notes?: string | null };
export type ModuleInput = { x?: number; y?: number; w?: number; h?: number; rotation?: Rotation; kind?: ModuleKind; name?: string | null; notes?: string | null };

export type LayoutSummary = { id: number; name: string; cols: number; rows: number; notes: string | null; modules: number; createdAt: string; updatedAt: string };
/** A set copy or build standing on a module. `refId` is the copy's or the build's id. */
export type LayoutItem = {
  kind: 'copy' | 'build'; refId: number; name: string; imageUrl: string | null;
  /** The set number (a copy's set, or the set a build is an alternate of). */
  setNo: string;
  /** "Copy 2 · Built" for a copy, the Rebrickable number for a build. */
  detail: string;
  /** Rebrickable page for a build. */
  url: string | null;
};
export type LayoutModule = { id: number; x: number; y: number; w: number; h: number; rotation: Rotation; kind: ModuleKind; name: string | null; notes: string | null; items: LayoutItem[] };
export type LayoutDetail = Omit<LayoutSummary, 'modules'> & { modules: LayoutModule[] };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/* ---------- validation ---------- */

const record = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

/** A whole number from form or JSON input, or an error naming the field. */
function int(r: Record<string, unknown>, k: string, label: string, min: number, max: number): number | undefined | { error: string } {
  if (r[k] === undefined || r[k] === null || r[k] === '') return undefined;
  const n = Number(r[k]);
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${label} must be a whole number from ${min} to ${max}.` };
  return n;
}

function text(r: Record<string, unknown>, k: string, label: string, max: number): string | null | undefined | { error: string } {
  if (r[k] === undefined) return undefined;
  const v = String(r[k] ?? '').trim();
  return v.length > max ? { error: `${label} is too long (${max} characters at most).` } : v || null;
}

const isErr = (v: unknown): v is { error: string } => !!v && typeof v === 'object' && 'error' in v;

/** Validates a layout from a form or JSON. `partial` = edit (rename or resize). */
export function parseLayoutInput(raw: unknown, partial = false): Parsed<LayoutInput> {
  const r = record(raw);
  const value: LayoutInput = {};
  const name = text(r, 'name', 'Name', 80);
  if (isErr(name)) return { ok: false, error: name.error };
  if (name) value.name = name;
  else if (!partial || name === null) return { ok: false, error: 'Give the layout a name.' };
  for (const [k, label] of [['cols', 'Columns'], ['rows', 'Rows']] as const) {
    const n = int(r, k, label, 1, MAX_CELLS);
    if (isErr(n)) return { ok: false, error: n.error };
    if (n !== undefined) value[k] = n;
    else if (!partial) return { ok: false, error: `${label} must be a whole number from 1 to ${MAX_CELLS}.` };
  }
  const notes = text(r, 'notes', 'Notes', 2000);
  if (isErr(notes)) return { ok: false, error: notes.error };
  if (notes !== undefined) value.notes = notes;
  return { ok: true, value };
}

/** Validates a module from a form or JSON. Adding needs x and y; `partial` = edit, any subset. */
export function parseModuleInput(raw: unknown, partial = false): Parsed<ModuleInput> {
  const r = record(raw);
  const value: ModuleInput = {};
  for (const [k, label, min, max] of [['x', 'Column', 0, MAX_CELLS - 1], ['y', 'Row', 0, MAX_CELLS - 1], ['w', 'Width', 1, MAX_MODULE], ['h', 'Height', 1, MAX_MODULE]] as const) {
    const n = int(r, k, label, min, max);
    if (isErr(n)) return { ok: false, error: n.error };
    if (n !== undefined) value[k] = n;
    else if (!partial && (k === 'x' || k === 'y')) return { ok: false, error: 'Say where the module goes (x and y).' };
  }
  if (r.rotation !== undefined && r.rotation !== '') {
    const n = Number(r.rotation);
    if (!(ROTATIONS as readonly number[]).includes(n)) return { ok: false, error: 'Rotation must be 0, 90, 180 or 270.' };
    value.rotation = n as Rotation;
  }
  if (r.kind !== undefined && r.kind !== '') {
    if (!(MODULE_KINDS as readonly string[]).includes(String(r.kind))) return { ok: false, error: `Type must be one of: ${MODULE_KINDS.join(', ')}.` };
    value.kind = r.kind as ModuleKind;
  }
  for (const [k, label, max] of [['name', 'Name', 60], ['notes', 'Notes', 2000]] as const) {
    const v = text(r, k, label, max);
    if (isErr(v)) return { ok: false, error: v.error };
    if (v !== undefined) value[k] = v;
  }
  return { ok: true, value };
}

/** Reads `{ setCopyIds, buildIds }`: arrays of ids, either may be left out (= none). */
export function parseItemsInput(raw: unknown): Parsed<{ setCopyIds: number[]; buildIds: number[] }> {
  const r = record(raw);
  const out = { setCopyIds: [] as number[], buildIds: [] as number[] };
  for (const k of ['setCopyIds', 'buildIds'] as const) {
    if (r[k] === undefined) continue;
    if (!Array.isArray(r[k])) return { ok: false, error: `${k} must be a list of ids.` };
    for (const v of r[k] as unknown[]) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: `${k} must be a list of ids.` };
      out[k].push(n);
    }
    out[k] = [...new Set(out[k])];
  }
  if (out.setCopyIds.length + out.buildIds.length > 200) return { ok: false, error: 'A module can hold 200 items at most.' };
  return { ok: true, value: out };
}

/* ---------- reading ---------- */

/** Layouts, newest change first, with how many modules each has. */
export async function listLayouts(db: DB): Promise<LayoutSummary[]> {
  const rows = await db.select({
    id: layouts.id, name: layouts.name, cols: layouts.cols, rows: layouts.rows, notes: layouts.notes, createdAt: layouts.createdAt, updatedAt: layouts.updatedAt,
    modules: sql<number>`(select count(*) from "layout_modules" m where m."layout_id" = "layouts"."id")`,
  }).from(layouts).orderBy(sql`${layouts.updatedAt} desc`, asc(layouts.id)).all();
  return rows.map((r) => ({ ...r, modules: Number(r.modules) }));
}

/** A layout with its modules (top to bottom, left to right) and what stands on each. Undefined when unknown. */
export async function getLayout(db: DB, id: number): Promise<LayoutDetail | undefined> {
  const l = await db.select().from(layouts).where(eq(layouts.id, id)).get();
  if (!l) return undefined;
  const mods = await db.select().from(layoutModules).where(eq(layoutModules.layoutId, id)).orderBy(asc(layoutModules.y), asc(layoutModules.x)).all();
  const items = await db.select({
    moduleId: layoutModuleItems.moduleId, setCopyId: layoutModuleItems.setCopyId, buildId: layoutModuleItems.buildId,
    copyStatus: setCopies.status,
    copyNo: sql<number>`(select count(*) from "set_copies" c where c."set_id" = "set_copies"."set_id" and c."id" <= "set_copies"."id")`,
    copies: sql<number>`(select count(*) from "set_copies" c where c."set_id" = "set_copies"."set_id")`,
    setNo: sets.setNo, setName: sets.name, setImage: sets.imageUrl,
    mocNo: builds.mocNo, buildName: builds.name, buildImage: builds.imageUrl, buildUrl: builds.url, sourceSetNo: builds.sourceSetNo,
  }).from(layoutModuleItems)
    .innerJoin(layoutModules, eq(layoutModules.id, layoutModuleItems.moduleId))
    .leftJoin(setCopies, eq(setCopies.id, layoutModuleItems.setCopyId)).leftJoin(sets, eq(sets.id, setCopies.setId))
    .leftJoin(builds, eq(builds.id, layoutModuleItems.buildId))
    .where(eq(layoutModules.layoutId, id)).orderBy(asc(layoutModuleItems.id)).all();
  const byModule = new Map<number, LayoutItem[]>();
  for (const i of items) {
    const item: LayoutItem | null = i.setCopyId != null && i.setNo
      ? {
        kind: 'copy', refId: i.setCopyId, name: i.setName ?? displayNo(i.setNo), imageUrl: i.setImage, setNo: i.setNo, url: null,
        detail: [Number(i.copies) > 1 ? `Copy ${i.copyNo}` : null, i.copyStatus ? STATUS_LABEL[i.copyStatus as CopyRow['status']] : null].filter(Boolean).join(' · '),
      }
      : i.buildId != null && i.mocNo
        ? { kind: 'build', refId: i.buildId, name: i.buildName ?? i.mocNo, imageUrl: i.buildImage, setNo: i.sourceSetNo ?? '', url: i.buildUrl, detail: i.mocNo.startsWith('custom-') ? 'your build' : i.mocNo }
        : null;
    if (item) byModule.set(i.moduleId, [...(byModule.get(i.moduleId) ?? []), item]);
  }
  return {
    id: l.id, name: l.name, cols: l.cols, rows: l.rows, notes: l.notes, createdAt: l.createdAt, updatedAt: l.updatedAt,
    modules: mods.map((m) => ({ id: m.id, x: m.x, y: m.y, w: m.w, h: m.h, rotation: m.rotation as Rotation, kind: m.kind, name: m.name, notes: m.notes, items: byModule.get(m.id) ?? [] })),
  };
}

/** A module with the layout it's on, or undefined. */
export async function getModule(db: DB, id: number) {
  return db.select().from(layoutModules).where(eq(layoutModules.id, id)).get();
}

/** "Fire Station corner (row 2, column 3)", or the type when the module has no name. */
const moduleLabel = (m: { name: string | null; kind: ModuleKind; x: number; y: number }) =>
  `${m.name ?? KIND_LABEL[m.kind].toLowerCase()} (row ${m.y + 1}, column ${m.x + 1})`;

/* ---------- layouts ---------- */

const notFound = (what: string): { ok: false; status: 404; error: string } => ({ ok: false, status: 404, error: `${what} doesn't exist.` });
const touch = (db: DB, layoutId: number) => db.update(layouts).set({ updatedAt: nowIso() }).where(eq(layouts.id, layoutId));

export async function createLayout(db: DB, input: LayoutInput): Promise<Result<{ id: number }>> {
  const p = parseLayoutInput(input);
  if (!p.ok) return { ok: false, status: 400, error: p.error };
  const [row] = await db.insert(layouts).values({ name: p.value.name!, cols: p.value.cols!, rows: p.value.rows!, notes: p.value.notes ?? null }).returning({ id: layouts.id }).all();
  return { ok: true, id: row.id };
}

/** Renames or resizes a layout. A size that would cut off a module is refused. */
export async function editLayout(db: DB, id: number, input: LayoutInput): Promise<Result<{ id: number }>> {
  const l = await db.select().from(layouts).where(eq(layouts.id, id)).get();
  if (!l) return notFound(`Layout ${id}`);
  const cols = input.cols ?? l.cols, rows = input.rows ?? l.rows;
  if (cols !== l.cols || rows !== l.rows) {
    const mods = await db.select().from(layoutModules).where(eq(layoutModules.layoutId, id)).all();
    const cut = mods.find((m) => { const f = footprint(m); return f.x + f.w > cols || f.y + f.h > rows; });
    if (cut) return { ok: false, status: 409, error: `${cols} × ${rows} would cut off ${moduleLabel(cut)}. Move or remove it first.` };
  }
  const fields = { ...input };
  if (Object.keys(fields).length) await db.update(layouts).set({ ...fields, updatedAt: nowIso() }).where(eq(layouts.id, id));
  return { ok: true, id };
}

/** Deletes a layout with its modules and links. The set copies and builds stay. */
export async function deleteLayout(db: DB, id: number): Promise<Result> {
  const l = await db.select({ id: layouts.id }).from(layouts).where(eq(layouts.id, id)).get();
  if (!l) return notFound(`Layout ${id}`);
  await db.delete(layouts).where(eq(layouts.id, id));
  return { ok: true };
}

/* ---------- modules ---------- */

/** Places a module on an empty spot. Plain, 1 × 1, unturned unless the input says otherwise. */
export async function addModule(db: DB, layoutId: number, input: ModuleInput): Promise<Result<{ id: number }>> {
  const l = await db.select().from(layouts).where(eq(layouts.id, layoutId)).get();
  if (!l) return notFound(`Layout ${layoutId}`);
  if (input.x === undefined || input.y === undefined) return { ok: false, status: 400, error: 'Say where the module goes (x and y).' };
  const m = { x: input.x, y: input.y, w: input.w ?? 1, h: input.h ?? 1, rotation: input.rotation ?? 0 };
  const others = await db.select().from(layoutModules).where(eq(layoutModules.layoutId, layoutId)).all();
  const bad = placementError(l, m, others.map((o) => ({ ...o, name: moduleLabel(o) })));
  if (bad) return { ok: false, status: 409, error: bad };
  const [row] = await db.insert(layoutModules).values({ layoutId, ...m, kind: input.kind ?? 'plain', name: input.name ?? null, notes: input.notes ?? null }).returning({ id: layoutModules.id }).all();
  await touch(db, layoutId);
  return { ok: true, id: row.id };
}

/** Changes a module: move, turn, resize, retype, rename. A new spot or footprint is checked against the layout. */
export async function editModule(db: DB, id: number, input: ModuleInput): Promise<Result<{ id: number }>> {
  const m = await getModule(db, id);
  if (!m) return notFound(`Module ${id}`);
  const next = { x: input.x ?? m.x, y: input.y ?? m.y, w: input.w ?? m.w, h: input.h ?? m.h, rotation: input.rotation ?? m.rotation };
  if (next.x !== m.x || next.y !== m.y || next.w !== m.w || next.h !== m.h || next.rotation !== m.rotation) {
    const l = (await db.select().from(layouts).where(eq(layouts.id, m.layoutId)).get())!;
    const others = await db.select().from(layoutModules).where(and(eq(layoutModules.layoutId, m.layoutId), ne(layoutModules.id, id))).all();
    const bad = placementError(l, next, others.map((o) => ({ ...o, name: moduleLabel(o) })));
    if (bad) return { ok: false, status: 409, error: bad };
  }
  await db.update(layoutModules).set({ ...input, updatedAt: nowIso() }).where(eq(layoutModules.id, id));
  await touch(db, m.layoutId);
  return { ok: true, id };
}

export const moveModule = (db: DB, id: number, x: number, y: number) => editModule(db, id, { x, y });

/** Turns a module 90° clockwise. A double module that wouldn't fit turned is refused. */
export async function rotateModule(db: DB, id: number): Promise<Result<{ id: number }>> {
  const m = await getModule(db, id);
  return m ? editModule(db, id, { rotation: nextRotation(m.rotation) }) : notFound(`Module ${id}`);
}

/** Removes a module and its links (not the copies and builds). */
export async function removeModule(db: DB, id: number): Promise<Result> {
  const m = await getModule(db, id);
  if (!m) return notFound(`Module ${id}`);
  await db.delete(layoutModules).where(eq(layoutModules.id, id));
  await touch(db, m.layoutId);
  return { ok: true };
}

/**
 * Replaces what stands on a module. Every id must exist, and a copy or build already on another module (in any layout)
 * is refused with where it is: moving one is done by removing it there first.
 */
export async function setModuleItems(db: DB, moduleId: number, items: { setCopyIds: number[]; buildIds: number[] }): Promise<Result> {
  const m = await getModule(db, moduleId);
  if (!m) return notFound(`Module ${moduleId}`);
  const copyIds = [...new Set(items.setCopyIds)], buildIds = [...new Set(items.buildIds)];
  const copies = await inChunks(copyIds, (ids) => db.select({ id: setCopies.id, setNo: sets.setNo, name: sets.name }).from(setCopies).innerJoin(sets, eq(sets.id, setCopies.setId)).where(inArray(setCopies.id, ids)).all());
  const missingCopy = copyIds.find((id) => !copies.some((c) => c.id === id));
  if (missingCopy) return { ok: false, status: 400, error: `Copy ${missingCopy} doesn't exist.` };
  const found = await inChunks(buildIds, (ids) => db.select({ id: builds.id, name: builds.name }).from(builds).where(inArray(builds.id, ids)).all());
  const missingBuild = buildIds.find((id) => !found.some((b) => b.id === id));
  if (missingBuild) return { ok: false, status: 400, error: `Build ${missingBuild} doesn't exist.` };

  const elsewhere = [
    ...await inChunks(copyIds, (ids) => placedQuery(db).where(and(inArray(layoutModuleItems.setCopyId, ids), ne(layoutModuleItems.moduleId, moduleId))).all()),
    ...await inChunks(buildIds, (ids) => placedQuery(db).where(and(inArray(layoutModuleItems.buildId, ids), ne(layoutModuleItems.moduleId, moduleId))).all()),
  ];
  if (elsewhere.length) {
    const e = elsewhere[0];
    const what = e.setCopyId != null
      ? (() => { const c = copies.find((x) => x.id === e.setCopyId)!; return `#${displayNo(c.setNo)} ${c.name}`; })()
      : found.find((b) => b.id === e.buildId)!.name;
    return { ok: false, status: 409, error: `${what} is already on ${e.layoutName}, ${moduleLabel(e)}. Remove it there first.` };
  }

  await db.delete(layoutModuleItems).where(eq(layoutModuleItems.moduleId, moduleId));
  const rows = [...copyIds.map((id) => ({ moduleId, setCopyId: id, buildId: null })), ...buildIds.map((id) => ({ moduleId, setCopyId: null, buildId: id }))];
  for (let i = 0; i < rows.length; i += 30) await db.insert(layoutModuleItems).values(rows.slice(i, i + 30));
  await touch(db, m.layoutId);
  return { ok: true };
}

/** Item links with the module and layout they're on. */
const placedQuery = (db: DB) => db.select({
  setCopyId: layoutModuleItems.setCopyId, buildId: layoutModuleItems.buildId, moduleId: layoutModules.id,
  name: layoutModules.name, kind: layoutModules.kind, x: layoutModules.x, y: layoutModules.y, layoutId: layouts.id, layoutName: layouts.name,
}).from(layoutModuleItems).innerJoin(layoutModules, eq(layoutModules.id, layoutModuleItems.moduleId)).innerJoin(layouts, eq(layouts.id, layoutModules.layoutId));

/** D1 allows 100 bound parameters per query, so long id lists are queried in chunks. */
async function inChunks<T, R>(ids: T[], q: (chunk: T[]) => R[] | Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += 90) out.push(...await q(ids.slice(i, i + 90)));
  return out;
}

/* ---------- linking: what can stand on a module ---------- */

export type Linkable = {
  kind: 'copy' | 'build'; id: number; name: string; imageUrl: string | null; setNo: string; detail: string;
  /** Where it stands now, if anywhere. */
  placed: { layoutId: number; layoutName: string; moduleId: number; label: string } | null;
};

/** Set copies (not parted out) and builds matching `q` (name, set number or MOC number), for the Link dialog. */
export async function searchLinkables(db: DB, q = '', limit = 40): Promise<Linkable[]> {
  const t = q.trim();
  const n = Math.min(Math.max(limit, 1), 100);
  const copyRows = await db.select({
    id: setCopies.id, status: setCopies.status, setNo: sets.setNo, name: sets.name, imageUrl: sets.imageUrl,
    copyNo: sql<number>`(select count(*) from "set_copies" c where c."set_id" = "set_copies"."set_id" and c."id" <= "set_copies"."id")`,
    copies: sql<number>`(select count(*) from "set_copies" c where c."set_id" = "set_copies"."set_id")`,
  }).from(setCopies).innerJoin(sets, eq(sets.id, setCopies.setId))
    .where(and(ne(setCopies.status, 'parted_out'), t ? or(like(sets.name, `%${t}%`), like(sets.setNo, `%${t}%`)) : undefined))
    .orderBy(asc(sets.setNo), asc(setCopies.id)).limit(n).all();
  const buildRows = await db.select({ id: builds.id, mocNo: builds.mocNo, name: builds.name, imageUrl: builds.imageUrl, sourceSetNo: builds.sourceSetNo, kind: builds.kind }).from(builds)
    .where(t ? or(like(builds.name, `%${t}%`), like(builds.mocNo, `%${t}%`), like(builds.sourceSetNo, `%${t}%`)) : undefined)
    .orderBy(asc(builds.name)).limit(n).all();
  const placed = [
    ...await inChunks(copyRows.map((c) => c.id), (ids) => placedQuery(db).where(inArray(layoutModuleItems.setCopyId, ids)).all()),
    ...await inChunks(buildRows.map((b) => b.id), (ids) => placedQuery(db).where(inArray(layoutModuleItems.buildId, ids)).all()),
  ];
  const where = (p: (typeof placed)[number] | undefined) => (p ? { layoutId: p.layoutId, layoutName: p.layoutName, moduleId: p.moduleId, label: moduleLabel(p) } : null);
  return [
    ...copyRows.map((c): Linkable => ({
      kind: 'copy', id: c.id, name: c.name, imageUrl: c.imageUrl, setNo: c.setNo,
      detail: [`#${displayNo(c.setNo)}`, Number(c.copies) > 1 ? `copy ${c.copyNo}` : null, STATUS_LABEL[c.status].toLowerCase()].filter(Boolean).join(' · '),
      placed: where(placed.find((p) => p.setCopyId === c.id)),
    })),
    ...buildRows.map((b): Linkable => ({
      kind: 'build', id: b.id, name: b.name, imageUrl: b.imageUrl, setNo: b.sourceSetNo,
      detail: b.kind === 'alternate' ? `${b.mocNo} · alternate build of ${displayNo(b.sourceSetNo)}` : b.kind === 'moc' ? `${b.mocNo} · Rebrickable MOC` : 'your build', placed: where(placed.find((p) => p.buildId === b.id)),
    })),
  ];
}

/* ---------- what the layout still needs (roadmap 9b) ---------- */

export type NeedLine = {
  type: string; partNo: string; colorId: number | null; name: string; colorName: string | null; rgb: string | null;
  /** Pieces the layout still lacks: builds' parts less what's reserved for them, plus set copies' missing parts. */
  need: number;
  /** Free loose parts that could cover it. */
  inLots: number;
  toBuy: number;
  /** Modules whose items need this part. */
  modules: number[];
};
export type LayoutNeeds = {
  lines: NeedLine[];
  totals: { needLots: number; needPieces: number; inLots: number; toBuyLots: number; toBuyPieces: number };
  /** Build lines Rebrickable couldn't map to BrickLink numbers, left out. */
  unmapped: number;
  builds: number;
  copies: number;
  /** Builds on the layout whose parts list isn't known yet (not fetched, or not shared by Rebrickable). */
  buildsWithoutParts: number;
  /** Pieces to buy per module, for the grid. Modules that need nothing are left out. */
  modules: Record<number, number>;
};


/**
 * Everything a layout still needs, one line per part and colour. Each build counts once, however many modules link it.
 * Builds need their whole parts list less what's reserved for them from loose parts: parts inside your sets aren't taken off, because those sets stand on the layout
 * too (unlike "What can I build?", which asks whether you could build it). Set copies add the parts marked missing
 * from them. A parted-out copy is in lots, not standing, so it adds nothing. One query per table, no per-line queries.
 */
export async function layoutNeeds(db: DB, layoutId: number): Promise<LayoutNeeds | undefined> {
  const l = await db.select({ id: layouts.id }).from(layouts).where(eq(layouts.id, layoutId)).get();
  if (!l) return undefined;
  const links = await db.select({ moduleId: layoutModuleItems.moduleId, setCopyId: layoutModuleItems.setCopyId, buildId: layoutModuleItems.buildId, copyStatus: setCopies.status })
    .from(layoutModuleItems).innerJoin(layoutModules, eq(layoutModules.id, layoutModuleItems.moduleId))
    .leftJoin(setCopies, eq(setCopies.id, layoutModuleItems.setCopyId))
    .where(eq(layoutModules.layoutId, layoutId)).orderBy(asc(layoutModuleItems.moduleId)).all();

  // Which modules each build and copy stands on (normally one).
  const buildMods = new Map<number, number[]>(), copyMods = new Map<number, number[]>();
  for (const k of links) {
    if (k.buildId != null) buildMods.set(k.buildId, [...(buildMods.get(k.buildId) ?? []), k.moduleId]);
    else if (k.setCopyId != null && k.copyStatus !== 'parted_out') copyMods.set(k.setCopyId, [...(copyMods.get(k.setCopyId) ?? []), k.moduleId]);
  }
  const { freeLots, reservedBy } = await availability(db);

  type Acc = { type: string; partNo: string; colorId: number | null; need: number; by: Map<number, number> };
  const acc = new Map<string, Acc>();
  const add = (type: string, partNo: string, colorId: number | null, qty: number, moduleId: number) => {
    if (qty <= 0) return;
    const k = partKey(type, partNo, colorId);
    const a = acc.get(k) ?? { type, partNo, colorId, need: 0, by: new Map<number, number>() };
    a.need += qty;
    a.by.set(moduleId, (a.by.get(moduleId) ?? 0) + qty);
    acc.set(k, a);
  };

  let unmapped = 0;
  const buildIds = [...buildMods.keys()];
  const bParts = await inChunks(buildIds, (ids) => db.select({ buildId: buildParts.buildId, partNo: buildParts.partNo, colorId: buildParts.colorId, qty: buildParts.qty, mapped: buildParts.mapped }).from(buildParts).where(inArray(buildParts.buildId, ids)).all());
  const withParts = new Set(bParts.map((p) => p.buildId));
  for (const p of bParts) {
    if (!p.mapped) { unmapped++; continue; }
    const reserved = reservedBy.get(p.buildId)?.get(partKey('PART', p.partNo, p.colorId)) ?? 0;
    add('PART', p.partNo, p.colorId, p.qty - reserved, buildMods.get(p.buildId)![0]);
  }

  const copyIds = [...copyMods.keys()];
  const missing = await inChunks(copyIds, (ids) => db.select({ copyId: setMissingParts.copyId, type: setMissingParts.type, partNo: setMissingParts.partNo, colorId: setMissingParts.colorId, qty: setMissingParts.qty }).from(setMissingParts).where(inArray(setMissingParts.copyId, ids)).all());
  for (const m of missing) add(m.type, m.partNo, m.colorId === -1 ? null : m.colorId, m.qty, copyMods.get(m.copyId!)![0]);

  // Names from the sets' parts lists (builds don't store them) and colours, in one grouped query each.
  const lines = [...acc.values()];
  const partNos = [...new Set(lines.map((a) => a.partNo))];
  const names = new Map<string, string>();
  for (const r of await inChunks(partNos, (nos) => db.select({ type: setParts.type, partNo: setParts.partNo, name: sql<string>`max(${setParts.name})` }).from(setParts).where(inArray(setParts.partNo, nos)).groupBy(setParts.type, setParts.partNo).all())) {
    names.set(`${r.type}|${r.partNo.toLowerCase()}`, r.name);
  }
  const colorIds = [...new Set(lines.flatMap((a) => (a.colorId == null ? [] : [a.colorId])))];
  const colorRows = new Map((await inChunks(colorIds, (ids) => db.select().from(colors).where(inArray(colors.id, ids)).all())).map((c) => [c.id, c]));

  const perModule: Record<number, number> = {};
  const out: NeedLine[] = lines.map((a) => {
    const inLots = Math.min(a.need, Math.max(freeLots.get(partKey(a.type, a.partNo, a.colorId)) ?? 0, 0));
    // Loose parts go to modules in id order; what's left over is each module's to buy.
    let left = inLots;
    for (const [mod, qty] of [...a.by].sort((x, y) => x[0] - y[0])) {
      const covered = Math.min(qty, left);
      left -= covered;
      if (qty > covered) perModule[mod] = (perModule[mod] ?? 0) + qty - covered;
    }
    const c = a.colorId == null ? undefined : colorRows.get(a.colorId);
    return {
      type: a.type, partNo: a.partNo, colorId: a.colorId, name: names.get(`${a.type}|${a.partNo.toLowerCase()}`) ?? a.partNo,
      colorName: c?.name ?? null, rgb: c?.rgb ?? null, need: a.need, inLots, toBuy: a.need - inLots, modules: [...a.by.keys()].sort((x, y) => x - y),
    };
  }).sort((x, y) => y.toBuy - x.toBuy || x.partNo.localeCompare(y.partNo) || (x.colorId ?? -1) - (y.colorId ?? -1) || x.type.localeCompare(y.type));

  const sum = (f: (l: NeedLine) => number) => out.reduce((t, l) => t + f(l), 0);
  return {
    lines: out,
    totals: { needLots: out.length, needPieces: sum((l) => l.need), inLots: sum((l) => l.inLots), toBuyLots: out.filter((l) => l.toBuy > 0).length, toBuyPieces: sum((l) => l.toBuy) },
    unmapped, builds: buildIds.length, copies: copyIds.length, buildsWithoutParts: buildIds.filter((id) => !withParts.has(id)).length, modules: perModule,
  };
}

/** The pieces each module still has to buy (modules that need nothing are left out). */
export async function moduleNeeds(db: DB, layoutId: number): Promise<Map<number, number>> {
  const n = await layoutNeeds(db, layoutId);
  return new Map(Object.entries(n?.modules ?? {}).map(([k, v]) => [Number(k), v]));
}

/** The layout's to-buy lines as a BrickLink Wanted List. Null when the layout isn't known. */
export async function layoutWantedListXml(db: DB, layoutId: number): Promise<{ xml: string; items: number; skipped: number; name: string } | null> {
  const l = await db.select({ name: layouts.name }).from(layouts).where(eq(layouts.id, layoutId)).get();
  const n = l && (await layoutNeeds(db, layoutId));
  if (!l || !n) return null;
  const items: WantedItem[] = n.lines.filter((x) => x.toBuy > 0).map((x) => ({ type: x.type, partNo: x.partNo, colorId: x.colorId, qty: x.toBuy }));
  return { xml: toWantedListXml(items, `Parts to buy for layout ${l.name}`), items: items.length, skipped: n.unmapped, name: l.name };
}


/** Reserves loose parts for every build on the layout (autoReserve for each), and adds up the results. */
export async function reserveForLayout(db: DB, layoutId: number): Promise<Result<{ builds: number; reserved: number; pieces: number; short: number }>> {
  const l = await db.select({ id: layouts.id }).from(layouts).where(eq(layouts.id, layoutId)).get();
  if (!l) return notFound(`Layout ${layoutId}`);
  const rows = await db.selectDistinct({ mocNo: builds.mocNo }).from(layoutModuleItems)
    .innerJoin(layoutModules, eq(layoutModules.id, layoutModuleItems.moduleId)).innerJoin(builds, eq(builds.id, layoutModuleItems.buildId))
    .where(eq(layoutModules.layoutId, layoutId)).all();
  const total = { builds: rows.length, reserved: 0, pieces: 0, short: 0 };
  for (const { mocNo } of rows) {
    const r = await autoReserve(db, mocNo);
    if (!r.ok) return r;
    total.reserved += r.reserved; total.pieces += r.pieces; total.short += r.short;
  }
  return { ok: true, ...total };
}
