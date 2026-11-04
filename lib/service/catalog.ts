// Optional Rebrickable sync: fills in each set's theme and minifigure count. It never touches prices,
// which always come from BrickLink.
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Catalog } from '../rebrickable/client';
import { builds, sets, themes } from '../db/schema';
import type { DB } from '../db/types';
import { setNo as fullSetNo } from '../sets';

const nowIso = () => new Date().toISOString();

/** Theme id → { name, parentId }, for labelling sets. */
export type ThemeMap = Map<number, { name: string; parentId: number | null }>;

export async function themeMap(db: DB): Promise<ThemeMap> {
  return new Map((await db.select().from(themes).all()).map((t) => [t.id, { name: t.name, parentId: t.parentId }]));
}

/** Top-level theme and subtheme names for a theme id, e.g. Icons / Botanical Collection. */
export function themeNames(map: ThemeMap, id: number | null): { theme: string | null; subtheme: string | null } {
  let t = id === null ? undefined : map.get(id);
  if (!t) return { theme: null, subtheme: null };
  const leaf = t.name;
  for (let i = 0; t.parentId !== null && i < 10; i++) {
    const parent = map.get(t.parentId);
    if (!parent) break;
    t = parent;
  }
  return t.name === leaf ? { theme: leaf, subtheme: null } : { theme: t.name, subtheme: leaf };
}

/**
 * Refreshes the theme list, then fills in theme and minifigure count for sets that haven't been matched yet.
 * Each new set costs two calls (about two seconds); matched sets are skipped on later runs. Sets Rebrickable
 * didn't know are asked again after 30 days, or right away with `recheck`.
 * Returns readable errors; a failure on one set doesn't stop the rest.
 */
export async function syncCatalog(db: DB, catalog: Catalog, opts: { recheck?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<string[]> {
  const errors: string[] = [];
  try {
    const list = await catalog.themes();
    for (const t of list) {
      await db.insert(themes).values(t).onConflictDoUpdate({ target: themes.id, set: { name: t.name, parentId: t.parentId } });
    }
  } catch (e) {
    return [`Rebrickable themes: ${e instanceof Error ? e.message : String(e)}`];
  }
  const retryBefore = opts.recheck ? new Date(Date.now() + 1000).toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString();
  const todo = await db.select({ id: sets.id, setNo: sets.setNo }).from(sets)
    .where(or(isNull(sets.rbSyncedAt), and(isNull(sets.themeId), lt(sets.rbSyncedAt, retryBefore)))).all();
  for (const [i, s] of todo.entries()) {
    opts.onProgress?.(i, todo.length);
    try {
      const no = fullSetNo(s.setNo); // Rebrickable always wants the suffix: 10280-1
      const rb = await catalog.set(no);
      // Unknown on Rebrickable (some promos and BrickLink-only numbers): marked checked, asked again in 30 days.
      const minifigs = rb ? await catalog.minifigCount(no) : null;
      await db.update(sets).set({ themeId: rb?.themeId ?? null, minifigs, rbSyncedAt: nowIso() }).where(eq(sets.id, s.id));
    } catch (e) {
      errors.push(`Rebrickable #${fullSetNo(s.setNo)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors;
}

export type RebrickableStats = { sets: number; matched: number; notFound: number; waiting: number; builds: number; buildsWithParts: number; buildsUnavailable: number };

/** How far the Rebrickable sync has got, for Settings. */
export async function rebrickableStats(db: DB): Promise<RebrickableStats> {
  const [s] = await db.select({
    sets: sql<number>`count(*)`,
    matched: sql<number>`sum(case when ${sets.themeId} is not null then 1 else 0 end)`,
    notFound: sql<number>`sum(case when ${sets.themeId} is null and ${sets.rbSyncedAt} is not null then 1 else 0 end)`,
  }).from(sets).all();
  const [b] = await db.select({
    builds: sql<number>`count(*)`,
    withParts: sql<number>`sum(case when ${builds.partsFetchedAt} is not null then 1 else 0 end)`,
    unavailable: sql<number>`sum(case when ${builds.partsFetchedAt} is null and ${builds.partsError} is not null then 1 else 0 end)`,
  }).from(builds).all();
  const n = (v: unknown) => Number(v ?? 0);
  return { sets: n(s.sets), matched: n(s.matched), notFound: n(s.notFound), waiting: n(s.sets) - n(s.matched) - n(s.notFound), builds: n(b.builds), buildsWithParts: n(b.withParts), buildsUnavailable: n(b.unavailable) };
}
