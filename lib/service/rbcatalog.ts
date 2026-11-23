// Rebrickable's daily catalog downloads (rebrickable.com/downloads): themes, sets, parts, colours, LEGO element IDs and
// set inventories as gzipped CSVs, so catalog facts don't cost one API call per set. Each file is fetched at most once
// a day, and only when it changed (ETag / Last-Modified). Rows are streamed, never loaded whole, and only rows that
// changed are written, which keeps a daily run cheap on D1's write allowance. None of the files carry BrickLink IDs:
// elements are mapped to BrickLink part and colour through `identifiers` (lib/identifiers/resolve.ts).
//
// Modes (REBRICKABLE_CATALOG): `full` (Docker's default) imports all seven files; `owned` (the default, and the only
// mode, on Cloudflare D1) imports themes and colours, and sets only for the sets you own, want or have alternate
// builds of: parts, elements and inventories are too big for D1's daily writes and a Worker's CPU time; `off`.
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/types';
import { builds, catalogFiles, identifiers, rbInventories, rbInventoryParts, sets, wishlist } from '../db/schema';
import { CHUNK, resolveMany, toRow, type Mapping } from '../identifiers/resolve';
import { streamCsv } from '../rebrickable/csv';
import { setNo as fullSetNo } from '../sets';

export const CATALOG_FILES = ['themes', 'colors', 'sets', 'parts', 'inventories', 'inventory_parts', 'elements'] as const;
export type CatalogFile = (typeof CATALOG_FILES)[number];
export type CatalogMode = 'full' | 'owned' | 'off';
const OWNED_FILES: CatalogFile[] = ['themes', 'colors', 'sets'];

/** The columns each file must start with, in order (checked November 2026). A file whose header differs is refused. */
export const HEADERS: Record<CatalogFile, string[]> = {
  themes: ['id', 'name', 'parent_id'],
  sets: ['set_num', 'name', 'year', 'theme_id', 'num_parts', 'img_url'],
  parts: ['part_num', 'name', 'part_cat_id', 'part_material'],
  colors: ['id', 'name', 'rgb', 'is_trans', 'num_parts', 'num_sets', 'y1', 'y2'],
  elements: ['element_id', 'part_num', 'color_id', 'design_id'],
  inventories: ['id', 'version', 'set_num'],
  inventory_parts: ['inventory_id', 'part_num', 'color_id', 'quantity', 'is_spare', 'img_url'],
};

export const DEFAULT_BASE = 'https://cdn.rebrickable.com/media/downloads';
/** A file is downloaded at most once in this long (a little under a day, so a daily sync at the same hour still runs). */
const MIN_GAP_MS = 20 * 3_600_000;
/** Rows written per transaction (Node) or before the next await (D1). */
const BATCH_ROWS = 2000;

/** REBRICKABLE_CATALOG, defaulting to `full` on Node and `owned` on D1. `full` on D1 becomes `owned` (`clamped`). */
export function catalogMode(env: Record<string, string | undefined> = process.env): { mode: CatalogMode; clamped: boolean } {
  // D1 and Vercel get the small import: the full one is over a million rows written, and on Vercel nothing runs it
  // outside a request (the sync imports `owned`; `full` waits for the always-on scheduler, which Vercel doesn't have).
  const small = env.DB_DRIVER === 'd1' || !!env.VERCEL;
  const raw = env.REBRICKABLE_CATALOG?.trim().toLowerCase();
  const asked: CatalogMode = raw === 'full' || raw === 'owned' || raw === 'off' ? raw : small ? 'owned' : 'full';
  return small && asked === 'full' ? { mode: 'owned', clamped: true } : { mode: asked, clamped: false };
}

export const filesFor = (mode: CatalogMode): CatalogFile[] => (mode === 'full' ? [...CATALOG_FILES] : mode === 'owned' ? OWNED_FILES : []);

// ---------------------------------------------------------------------------------------------------------------------
// Writing: better-sqlite3 runs each batch in one synchronous transaction (fast, and no other query runs in between);
// D1 runs the statements one by one. Every statement stays under D1's 100 bound parameters.

type Exec = (queries: SQL[]) => Promise<number>;
type SyncClient = { transaction: (fn: () => number) => () => number };

function executor(db: DB): Exec {
  const client = (db as unknown as { $client?: Partial<SyncClient> & { prepare?: unknown } }).$client;
  // better-sqlite3: changes; D1: meta.changes; libSQL: rowsAffected.
  const changes = (r: unknown) => {
    const x = r as { changes?: number; rowsAffected?: number; meta?: { changes?: number } } | undefined;
    return Number(x?.changes ?? x?.meta?.changes ?? x?.rowsAffected ?? 0);
  };
  if (client && typeof client.transaction === 'function' && typeof client.prepare === 'function') {
    const run = (db as unknown as { run: (q: SQL) => unknown }).run.bind(db);
    return async (queries) => (queries.length ? (client as SyncClient).transaction(() => queries.reduce((n, q) => n + changes(run(q)), 0))() : 0);
  }
  // libSQL (Turso): one batch per call = one atomic round trip, instead of one HTTP request per statement.
  if (client && typeof (client as { executeMultiple?: unknown }).executeMultiple === 'function') {
    const batch = (db as unknown as { batch: (qs: unknown[]) => Promise<unknown[]> }).batch.bind(db);
    return async (queries) => (queries.length ? (await batch(queries.map((q) => db.run(q)))).reduce<number>((n, r) => n + changes(r), 0) : 0);
  }
  return async (queries) => {
    let n = 0;
    for (const q of queries) n += changes(await db.run(q));
    return n;
  };
}

const ident = (s: string) => sql.raw(`"${s}"`);
const rowsPerStatement = (cols: number) => Math.max(1, Math.floor(100 / cols));

/** INSERT … ON CONFLICT DO UPDATE that only writes a row when a value changed. One statement per D1-sized chunk. */
function upserts(table: string, cols: string[], key: string[], rows: unknown[][]): SQL[] {
  const update = cols.filter((c) => !key.includes(c));
  const set = sql.join(update.map((c) => sql`${ident(c)} = excluded.${ident(c)}`), sql`, `);
  const changed = sql.join(update.map((c) => sql`${ident(table)}.${ident(c)} is not excluded.${ident(c)}`), sql` or `);
  const out: SQL[] = [];
  const size = rowsPerStatement(cols.length);
  for (let i = 0; i < rows.length; i += size) {
    const values = sql.join(rows.slice(i, i + size).map((r) => sql`(${sql.join(r.map((v) => sql`${v}`), sql`, `)})`), sql`, `);
    out.push(sql`insert into ${ident(table)} (${sql.join(cols.map(ident), sql`, `)}) values ${values}
      on conflict (${sql.join(key.map(ident), sql`, `)}) do update set ${set} where ${changed}`);
  }
  return out;
}

function inserts(table: string, cols: string[], rows: unknown[][], tail: SQL = sql``): SQL[] {
  const out: SQL[] = [];
  const size = rowsPerStatement(cols.length);
  for (let i = 0; i < rows.length; i += size) {
    const values = sql.join(rows.slice(i, i + size).map((r) => sql`(${sql.join(r.map((v) => sql`${v}`), sql`, `)})`), sql`, `);
    out.push(sql`insert into ${ident(table)} (${sql.join(cols.map(ident), sql`, `)}) values ${values} ${tail}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Values

const int = (s: string) => (s.trim() === '' || !/^-?\d+$/.test(s.trim()) ? null : Number(s));
const bool = (s: string) => /^(true|t|1)$/i.test(s.trim());
const text = (s: string) => (s === '' ? null : s);

/** Two 32-bit FNV-1a hashes with different seeds: enough to tell whether one inventory's parts changed. */
function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------------------------------
// One importer per file. Each reads data rows (header already checked) and returns what it wrote.

type Rows = AsyncIterable<string[]>;
type Outcome = { rows: number; written: number; skipped: number };
type Ctx = { db: DB; exec: Exec; mode: CatalogMode; wanted: Set<string> | null };

/**
 * A plain table keyed by `key`: upsert changed rows in batches, then (after the whole file read cleanly, and when
 * `prune` is set) delete rows the file no longer has.
 */
async function importTable(ctx: Ctx, rows: Rows, spec: {
  table: string; cols: string[]; key: string; width: number;
  parse: (r: string[]) => unknown[] | null; prune: boolean; keep?: (values: unknown[]) => boolean;
  onPrune?: (keys: unknown[]) => Promise<number>;
}): Promise<Outcome> {
  const out: Outcome = { rows: 0, written: 0, skipped: 0 };
  const seen = new Set<string>();
  const ki = spec.cols.indexOf(spec.key);
  let batch: unknown[][] = [];
  const flush = async () => { out.written += await ctx.exec(upserts(spec.table, spec.cols, [spec.key], batch)); batch = []; };
  for await (const r of rows) {
    out.rows++;
    const v = r.length === spec.width ? spec.parse(r) : null;
    if (!v) { out.skipped++; continue; }
    if (spec.keep && !spec.keep(v)) continue;
    seen.add(String(v[ki]));
    batch.push(v);
    if (batch.length >= BATCH_ROWS) await flush();
  }
  await flush();
  if (spec.prune) {
    const existing = (await ctx.db.all<{ k: unknown }>(sql`select ${ident(spec.key)} as k from ${ident(spec.table)}`)).map((r) => r.k);
    const gone = existing.filter((k) => !seen.has(String(k)));
    if (gone.length && spec.onPrune) out.written += await spec.onPrune(gone);
    for (let i = 0; i < gone.length; i += CHUNK) {
      const chunk = gone.slice(i, i + CHUNK);
      out.written += await ctx.exec([sql`delete from ${ident(spec.table)} where ${ident(spec.key)} in (${sql.join(chunk.map((k) => sql`${k}`), sql`, `)})`]);
    }
  }
  return out;
}

const importers: Record<CatalogFile, (ctx: Ctx, rows: Rows) => Promise<Outcome>> = {
  themes: (ctx, rows) => importTable(ctx, rows, {
    table: 'themes', cols: ['id', 'parent_id', 'name'], key: 'id', width: 3, prune: false, // sets may still point at an old theme
    parse: ([id, name, parent]) => (int(id) === null || !name ? null : [int(id), int(parent), name]),
  }),
  colors: (ctx, rows) => importTable(ctx, rows, {
    table: 'rb_colors', cols: ['id', 'name', 'rgb', 'is_trans'], key: 'id', width: 8, prune: true,
    parse: ([id, name, rgb, trans]) => (int(id) === null || !name ? null : [int(id), name, text(rgb), bool(trans) ? 1 : 0]),
  }),
  sets: (ctx, rows) => importTable(ctx, rows, {
    table: 'rb_sets', cols: ['set_num', 'name', 'year', 'theme_id', 'num_parts', 'img_url'], key: 'set_num', width: 6,
    prune: ctx.mode === 'full',
    parse: ([no, name, year, theme, parts, img]) => (!no || !name ? null : [no, name, int(year), int(theme), int(parts), text(img)]),
    keep: ctx.wanted ? (v) => ctx.wanted!.has(String(v[0]).toLowerCase()) : undefined,
  }),
  parts: (ctx, rows) => importTable(ctx, rows, {
    table: 'rb_parts', cols: ['part_num', 'name', 'part_cat_id', 'part_material'], key: 'part_num', width: 4, prune: true,
    parse: ([no, name, cat, material]) => (!no || !name ? null : [no, name, int(cat), text(material)]),
  }),
  inventories: (ctx, rows) => importTable(ctx, rows, {
    table: 'rb_inventories', cols: ['id', 'version', 'set_num'], key: 'id', width: 3, prune: true,
    parse: ([id, version, no]) => (int(id) === null || int(version) === null || !no ? null : [int(id), int(version), no]),
    // An inventory Rebrickable dropped takes its parts with it.
    onPrune: async (ids) => {
      let n = 0;
      for (let i = 0; i < ids.length; i += CHUNK) n += await ctx.exec([sql`delete from rb_inventory_parts where inventory_id in (${sql.join(ids.slice(i, i + CHUNK).map((k) => sql`${k}`), sql`, `)})`]);
      return n;
    },
  }),
  inventory_parts: importInventoryParts,
  elements: importElements,
};

/**
 * inventory_parts.csv is over a million rows, sorted by inventory. Each inventory's rows are hashed; only inventories
 * whose parts changed since the last import are rewritten (delete, insert, save the hash). Fails if the file isn't
 * grouped by inventory, since rewriting a group twice would lose rows.
 */
async function importInventoryParts(ctx: Ctx, rows: Rows): Promise<Outcome> {
  const out: Outcome = { rows: 0, written: 0, skipped: 0 };
  const stored = new Map((await ctx.db.select({ id: rbInventories.id, h: rbInventories.partsHash }).from(rbInventories).all()).map((r) => [r.id, r.h]));
  const withParts = new Set((await ctx.db.selectDistinct({ id: rbInventoryParts.inventoryId }).from(rbInventoryParts).all()).map((r) => r.id));
  const done = new Set<number>();
  let current: number | null = null;
  let group: unknown[][] = [];
  let key = '';
  let pending: SQL[] = [], pendingRows = 0;
  const flush = async () => { out.written += await ctx.exec(pending); pending = []; pendingRows = 0; };
  const close = async () => {
    if (current === null) return;
    done.add(current);
    const h = hash(key);
    if (stored.get(current) !== h || !withParts.has(current)) {
      pending.push(sql`delete from rb_inventory_parts where inventory_id = ${current}`);
      pending.push(...inserts('rb_inventory_parts', ['inventory_id', 'part_num', 'color_id', 'quantity', 'is_spare'], group));
      pending.push(sql`update rb_inventories set parts_hash = ${h} where id = ${current}`);
      pendingRows += group.length;
      if (pendingRows >= BATCH_ROWS) await flush();
    }
    group = []; key = '';
  };
  for await (const r of rows) {
    out.rows++;
    const id = r.length === 6 ? int(r[0]) : null;
    const color = r.length === 6 ? int(r[2]) : null;
    const qty = r.length === 6 ? int(r[3]) : null;
    if (id === null || color === null || qty === null || !r[1]) { out.skipped++; continue; }
    if (id !== current) {
      await close();
      if (done.has(id)) throw new Error(`inventory_parts.csv isn't grouped by inventory_id (inventory ${id} appears twice)`);
      current = id;
    }
    const spare = bool(r[4]) ? 1 : 0;
    group.push([id, r[1], color, qty, spare]);
    key += `${r[1]},${color},${qty},${spare}\n`;
  }
  await close();
  await flush();
  // Inventories no longer in the file: remove their parts.
  const gone = [...withParts].filter((id) => !done.has(id));
  for (let i = 0; i < gone.length; i += CHUNK) {
    const chunk = gone.slice(i, i + CHUNK);
    out.written += await ctx.exec([
      sql`delete from rb_inventory_parts where inventory_id in (${sql.join(chunk.map((k) => sql`${k}`), sql`, `)})`,
      sql`update rb_inventories set parts_hash = null where id in (${sql.join(chunk.map((k) => sql`${k}`), sql`, `)})`,
    ]);
  }
  return out;
}

/**
 * elements.csv: each LEGO element ID becomes an `identifiers` row (element, lego_element → `<blPart>:<blColour>`),
 * when Rebrickable's part and colour both map to exactly one BrickLink number. Others are skipped and counted; the
 * file is downloaded again next time so they're retried as the part map fills in. Only new or changed rows are written.
 */
async function importElements(ctx: Ctx, rows: Rows): Promise<Outcome> {
  const out: Outcome = { rows: 0, written: 0, skipped: 0 };
  let batch: string[][] = [];
  const flush = async () => {
    if (!batch.length) return;
    const parts = await resolveMany(ctx.db, 'part', 'rebrickable', batch.map((r) => r[1]));
    const colors = await resolveMany(ctx.db, 'color', 'rebrickable', batch.map((r) => r[2]));
    const mappings: Mapping[] = [];
    for (const [element, part, color] of batch) {
      const p = parts.get(part)?.canonical, c = colors.get(color)?.canonical;
      if (!p || !c) { out.skipped++; continue; }
      mappings.push({ kind: 'element', scheme: 'lego_element', value: element, canonical: `${p}:${c}`, source: 'rebrickable', sourceRef: `${part}/${color}` });
    }
    const wanted = mappings.map(toRow).filter((r): r is NonNullable<ReturnType<typeof toRow>> => !!r);
    const existing = new Map<string, { id: number; canonical: string }[]>();
    const values = [...new Set(wanted.map((r) => r.value))];
    for (let i = 0; i < values.length; i += CHUNK) {
      const found = await ctx.db.select({ id: identifiers.id, value: identifiers.value, canonical: identifiers.canonical }).from(identifiers)
        .where(and(eq(identifiers.kind, 'element'), eq(identifiers.scheme, 'lego_element'), eq(identifiers.source, 'rebrickable'), inArray(identifiers.value, values.slice(i, i + CHUNK)))).all();
      for (const f of found) existing.set(f.value, [...(existing.get(f.value) ?? []), f]);
    }
    const fresh = wanted.filter((r) => !existing.get(r.value)?.some((e) => e.canonical === r.canonical));
    // An element Rebrickable now maps elsewhere: drop its old Rebrickable row, so it doesn't look ambiguous.
    const stale = wanted.flatMap((r) => (existing.get(r.value) ?? []).filter((e) => e.canonical !== r.canonical).map((e) => e.id));
    const queries: SQL[] = [];
    for (let i = 0; i < stale.length; i += CHUNK) queries.push(sql`delete from identifiers where id in (${sql.join(stale.slice(i, i + CHUNK).map((k) => sql`${k}`), sql`, `)})`);
    queries.push(...inserts('identifiers', ['kind', 'scheme', 'value', 'canonical', 'source', 'verified', 'source_ref'],
      fresh.map((r) => [r.kind, r.scheme, r.value, r.canonical, r.source, 0, r.sourceRef]), sql`on conflict do nothing`));
    out.written += await ctx.exec(queries);
    batch = [];
  };
  for await (const r of rows) {
    out.rows++;
    if (r.length !== 4 || !/^\d+$/.test(r[0]) || !r[1] || int(r[2]) === null) { out.skipped++; continue; }
    batch.push(r);
    if (batch.length >= 500) await flush();
  }
  await flush();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The run

/** Set numbers (with suffix, lowercase) of the sets you own, want or have alternate builds of: the `owned` mode's sets. */
async function wantedSets(db: DB): Promise<Set<string>> {
  const nos = [
    ...(await db.select({ no: sets.setNo }).from(sets).all()).map((r) => r.no),
    ...(await db.select({ no: wishlist.setNo }).from(wishlist).all()).map((r) => r.no),
    ...(await db.selectDistinct({ no: builds.sourceSetNo }).from(builds).all()).map((r) => r.no).filter(Boolean),
  ];
  return new Set(nos.map((n) => fullSetNo(n).toLowerCase()));
}

type FileRow = typeof catalogFiles.$inferSelect;
const saveFile = (db: DB, name: CatalogFile, v: Partial<FileRow>) =>
  db.insert(catalogFiles).values({ name, ...v }).onConflictDoUpdate({ target: catalogFiles.name, set: v });

export type RbCatalogOptions = {
  mode?: CatalogMode;
  fetchImpl?: typeof fetch;
  base?: string;
  now?: Date;
  /** Download even if the file was checked less than a day ago (tests). */
  force?: boolean;
  onProgress?: (step: string) => void;
};

let running: Promise<string[]> | null = null;

/**
 * Downloads and imports the catalog files for the mode, one by one, and returns readable errors (never throws).
 * A file that fails (network, a changed header, a malformed file) keeps its rows and its last ETag, and is tried
 * again next time. Only one run at a time; a second call waits for the first.
 */
export function syncRbCatalog(db: DB, opts: RbCatalogOptions = {}): Promise<string[]> {
  running ??= runCatalog(db, opts).finally(() => { running = null; });
  return running;
}

async function runCatalog(db: DB, opts: RbCatalogOptions): Promise<string[]> {
  const mode = opts.mode ?? catalogMode().mode;
  const files = filesFor(mode);
  if (!files.length) return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = (opts.base ?? process.env.REBRICKABLE_CATALOG_URL ?? DEFAULT_BASE).replace(/\/$/, '');
  const now = opts.now ?? new Date();
  const ctx: Ctx = { db, exec: executor(db), mode, wanted: mode === 'owned' ? await wantedSets(db) : null };
  const known = new Map((await db.select().from(catalogFiles).all()).map((f) => [f.name, f]));
  const errors: string[] = [];
  for (const name of files) {
    const prev = known.get(name);
    if (!opts.force && prev?.checkedAt && !prev.error && now.getTime() - Date.parse(prev.checkedAt) < MIN_GAP_MS) continue;
    opts.onProgress?.(`Downloading the Rebrickable catalog: ${name}…`);
    const checkedAt = now.toISOString();
    try {
      const headers: Record<string, string> = {};
      // Elements with unmapped parts are fetched again, so they're retried as the part map fills in. In `owned`
      // mode, sets are too, so a set added since the last import is picked up.
      const retry = (name === 'elements' && (prev?.skipped ?? 0) > 0) || (name === 'sets' && mode === 'owned');
      if (!retry && prev?.importedAt) {
        if (prev.etag) headers['If-None-Match'] = prev.etag;
        if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
      }
      const res = await fetchImpl(`${base}/${name}.csv.gz`, { headers, signal: AbortSignal.timeout(10 * 60_000) });
      if (res.status === 304) {
        await res.body?.cancel().catch(() => {});
        await saveFile(db, name, { checkedAt, error: null });
        continue;
      }
      if (!res.ok) throw new Error(`download answered ${res.status} ${res.statusText}`.trim());
      const stream = streamCsv(res);
      const first = await stream.next();
      const header = first.done ? [] : first.value.map((h) => h.trim().replace(/^﻿/, ''));
      const want = HEADERS[name];
      if (header.join(',') !== want.join(',')) {
        await stream.return(undefined);
        throw new Error(`expected the columns ${want.join(',')}, got ${header.join(',') || 'an empty file'}; nothing was changed`);
      }
      const r = await importers[name](ctx, stream);
      await saveFile(db, name, {
        etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'),
        rows: r.rows, written: r.written, skipped: r.skipped, importedAt: checkedAt, checkedAt, error: null,
      });
      console.log(`Rebrickable catalog: ${name}.csv, ${r.rows.toLocaleString('en-US')} rows, ${r.written.toLocaleString('en-US')} written${r.skipped ? `, ${r.skipped.toLocaleString('en-US')} skipped` : ''}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Rebrickable catalog ${name}.csv: ${msg}`);
      await saveFile(db, name, { checkedAt, error: msg }).catch(() => {});
    }
  }
  return errors;
}

export type CatalogFileStatus = { name: CatalogFile; rows: number | null; written: number | null; skipped: number | null; importedAt: string | null; checkedAt: string | null; error: string | null };
export type CatalogStatus = { mode: CatalogMode; clamped: boolean; files: CatalogFileStatus[] };

/** Settings → Rebrickable: the mode and each of its files' last import. */
export async function catalogStatus(db: DB, env: Record<string, string | undefined> = process.env): Promise<CatalogStatus> {
  const { mode, clamped } = catalogMode(env);
  const rows = new Map((await db.select().from(catalogFiles).all()).map((f) => [f.name, f]));
  return {
    mode, clamped,
    files: filesFor(mode).map((name) => {
      const f = rows.get(name);
      return { name, rows: f?.rows ?? null, written: f?.written ?? null, skipped: f?.skipped ?? null, importedAt: f?.importedAt ?? null, checkedAt: f?.checkedAt ?? null, error: f?.error ?? null };
    }),
  };
}

/** Whether themes.csv has been imported, so the theme list needn't be asked of the API. */
export async function themesImported(db: DB): Promise<boolean> {
  const f = await db.select({ at: catalogFiles.importedAt }).from(catalogFiles).where(eq(catalogFiles.name, 'themes')).get();
  return !!f?.at;
}
