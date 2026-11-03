// Collectible Minifigures box codes. Since Series 25 each box has a square Data Matrix code that reads like
// "6472866 444S3": a 7-digit code for the figure, then a production code whose 4th character is the factory
// (S = Czech Republic, R = Mexico) and 5th the year. The same figure has different codes per factory and year,
// and the code-to-figure tables are collected by fans, so every match says where it came from.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { cmfFigs, minifigCodes, minifigs, themes } from '../db/schema';
import bundled from './data/cmf-codes.json';

export type FigCode = { raw: string; code: string; factory: string; year: string };
export type FigSourceName = 'user' | 'community' | 'lscan';
export type FigCandidate = {
  name: string; series: string; rbFigNo: string | null; imageUrl: string | null; themeId: number | null;
  source: FigSourceName; verified: boolean; exact: boolean; owned: number;
};
export type FigResolution =
  | { status: 'matched' | 'ambiguous' | 'not_found'; code: FigCode; candidates: FigCandidate[] }
  | { status: 'invalid'; error: string };

/** Reads a decoded Data Matrix. Null when it isn't a minifigure box code. */
export function parseFigCode(text: unknown): FigCode | null {
  const raw = String(text ?? '').trim().slice(0, 64);
  const [first = '', prod = ''] = raw.split(/\s+/);
  if (!/^\d{7,}$/.test(first)) return null;
  return { raw, code: first.slice(0, 7), factory: /^[A-Z]$/.test(prod[3] ?? '') ? prod[3] : '', year: /^\d$/.test(prod[4] ?? '') ? prod[4] : '' };
}

type Row = { name: string; series: string; factory: string; year: string; rbFigNo: string | null; source: FigSourceName; verified: boolean };

/** The bundled L-Scan table, indexed by 7-digit code. */
let index: Map<string, Row[]> | null = null;
function lscan(code: string): Row[] {
  if (!index) {
    index = new Map();
    for (const s of bundled.series) for (const f of s.figures) for (const [c, factory, year] of f.codes) {
      const list = index.get(c) ?? [];
      list.push({ name: f.name, series: s.name, factory, year, rbFigNo: null, source: 'lscan', verified: false });
      index.set(c, list);
    }
  }
  return index.get(code) ?? [];
}

/** Names compared loosely: "Spider-Man: Across the Spider-Verse" ≈ "Spider-Man Across the Spider-Verses". */
const STOP = new Set(['collectible', 'minifigures', 'minifigure', 'series', 'the', 'and', 'lego']);
export const loose = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)).join('');

/** Rebrickable's subtheme of Collectible Minifigures for a series name, if the theme sync has it. */
async function seriesTheme(db: DB, series: string): Promise<number | null> {
  const parents = await db.select({ id: themes.id }).from(themes).where(sql`lower(${themes.name}) = 'collectible minifigures'`).all();
  if (!parents.length) return null;
  const subs = await db.select({ id: themes.id, name: themes.name }).from(themes).where(inArray(themes.parentId, parents.map((p) => p.id))).all();
  const want = loose(series);
  const hit = subs.find((t) => loose(t.name) === want) ?? subs.find((t) => want.length > 3 && (loose(t.name).includes(want) || want.includes(loose(t.name))));
  return hit?.id ?? null;
}

/**
 * Finds the figure for a box code: your confirmed codes first, then the shared community list, then the bundled
 * L-Scan table; a code with the matching factory and year beats a bare code. Links each figure to your Rebrickable
 * checklist (number, photo, how many you own) when that series is loaded. `loadSeries` fetches a missing checklist.
 */
export async function resolveFigCode(db: DB, text: unknown, opts: { loadSeries?: (themeId: number) => Promise<unknown> } = {}): Promise<FigResolution> {
  const code = parseFigCode(text);
  if (!code) return { status: 'invalid', error: 'That isn’t a Collectible Minifigures box code. Scan the square code on the bottom of the box.' };
  const saved = (await db.select().from(minifigCodes).where(eq(minifigCodes.code, code.code)).all()) as Row[];
  const rows = [...saved, ...lscan(code.code)];
  const exact = (r: Row) => (!r.factory || r.factory === code.factory) && (!r.year || r.year === code.year) && !!(code.factory && r.factory);
  const fits = (r: Row) => (!r.factory || !code.factory || r.factory === code.factory) && (!r.year || !code.year || r.year === code.year);
  const tier = (r: Row) => (r.source === 'user' ? 0 : r.source === 'community' ? 1 : 2) * 2 + (exact(r) ? 0 : 1);
  const usable = rows.filter(fits);
  const pool = usable.length ? usable : rows; // a code known only for another factory is still a good hint
  if (!pool.length) return { status: 'not_found', code, candidates: [] };
  const best = Math.min(...pool.map(tier));
  const top = new Map<string, Row>();
  for (const r of pool.filter((x) => tier(x) === best)) top.set(`${loose(r.series)}|${loose(r.name)}`, r);

  const candidates: FigCandidate[] = [];
  for (const r of top.values()) {
    const themeId = await seriesTheme(db, r.series);
    let figs = themeId ? await db.select().from(cmfFigs).where(eq(cmfFigs.themeId, themeId)).all() : [];
    if (themeId && !figs.length && opts.loadSeries) {
      await opts.loadSeries(themeId).catch(() => null);
      figs = await db.select().from(cmfFigs).where(eq(cmfFigs.themeId, themeId)).all();
    }
    const fig = (r.rbFigNo && figs.find((f) => f.rbFigNo === r.rbFigNo)) || figs.find((f) => loose(f.name) === loose(r.name));
    const rbFigNo = fig?.rbFigNo ?? r.rbFigNo;
    const own = rbFigNo ? await db.select({ qty: minifigs.qty }).from(minifigs).where(and(eq(minifigs.rbFigNo, rbFigNo))).get() : undefined;
    candidates.push({ name: r.name, series: r.series, rbFigNo, imageUrl: fig?.imageUrl ?? null, themeId, source: r.source, verified: r.verified, exact: exact(r), owned: own?.qty ?? 0 });
  }
  return { status: candidates.length === 1 ? 'matched' : 'ambiguous', code, candidates };
}

/** "This box code is that figure": saved as your own, confirmed code for this factory and year. */
export async function rememberFigCode(db: DB, text: unknown, fig: { name: unknown; series: unknown; rbFigNo?: unknown }) {
  const code = parseFigCode(text);
  if (!code) return { ok: false as const, status: 400 as const, error: 'That isn’t a Collectible Minifigures box code.' };
  const name = String(fig.name ?? '').trim().slice(0, 80), series = String(fig.series ?? '').trim().slice(0, 80);
  const rb = fig.rbFigNo ? String(fig.rbFigNo).trim().toLowerCase() : null;
  if (!name || !series) return { ok: false as const, status: 400 as const, error: 'Pick the figure and its series.' };
  if (rb && !/^fig-\d{6}$/.test(rb)) return { ok: false as const, status: 400 as const, error: 'Rebrickable numbers look like fig-013525.' };
  const t = new Date().toISOString();
  const row = { name, series, rbFigNo: rb, verified: true, updatedAt: t };
  await db.insert(minifigCodes).values({ code: code.code, factory: code.factory, year: code.year, source: 'user', ...row })
    .onConflictDoUpdate({ target: [minifigCodes.code, minifigCodes.factory, minifigCodes.year, minifigCodes.source], set: row });
  return { ok: true as const, code: code.code };
}

/** The series in the bundled table, for picking a figure by hand. */
export const bundledSeries = () => bundled.series.map((s) => ({ name: s.name, year: s.year, figures: s.figures.map((f) => f.name) }));
