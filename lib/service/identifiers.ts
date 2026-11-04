// Fills the identifiers map with Rebrickable's part and colour IDs (its `external_ids`: BrickLink and LDraw numbers).
// Colours are one call; the parts catalog is about 60 pages, walked a few at a time in the daily sync so Rebrickable's
// rate limit (and a Worker's time limit) is respected. The client keeps Rebrickable's one-call-a-second spacing.
import { eq } from 'drizzle-orm';
import type { DB } from '../db/types';
import { settings } from '../db/schema';
import type { IdCatalog, RbExternal } from '../rebrickable/client';
import { remember, type Kind, type Mapping } from '../identifiers/resolve';

/** Colours and a full pass over the parts catalog are redone this often. */
export const REFRESH_DAYS = 30;
export const DEFAULT_PAGES = 20;
const CURSOR = 'rb_parts_cursor', PARTS_AT = 'rb_parts_synced_at', COLORS_AT = 'rb_colors_synced_at';

/** Part pages per sync from REBRICKABLE_ID_PAGES_PER_SYNC (default 20; 0 turns the ID sync off). */
export function idPagesPerSync(env: Record<string, string | undefined> = process.env): number {
  const raw = env.REBRICKABLE_ID_PAGES_PER_SYNC?.trim();
  const n = raw ? Number(raw) : DEFAULT_PAGES;
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_PAGES;
}

/**
 * Mappings for one Rebrickable part or colour: its Rebrickable number and each LDraw number, to every BrickLink
 * number Rebrickable lists. Nothing when Rebrickable lists no BrickLink number (there's no canonical ID to map to).
 */
export function rbMappings(kind: Extract<Kind, 'part' | 'color'>, rbId: string | number, ext: RbExternal): Mapping[] {
  const out: Mapping[] = [];
  for (const bl of ext.bricklink) {
    out.push({ kind, scheme: 'rebrickable', value: rbId, canonical: bl, source: 'rebrickable' });
    for (const ld of ext.ldraw) out.push({ kind, scheme: 'ldraw', value: ld, canonical: bl, source: 'rebrickable' });
  }
  return out;
}

const getSetting = async (db: DB, key: string) => (await db.select().from(settings).where(eq(settings.key, key)).get())?.value ?? null;
const putSetting = (db: DB, key: string, value: string) => db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
const stale = (at: string | null) => !at || Date.parse(at) < Date.now() - REFRESH_DAYS * 86_400_000;

/**
 * Refreshes colour mappings (every 30 days) and walks the parts catalog `maxCalls` pages at a time, saving where it got
 * to so the next sync carries on; a finished pass is started again after 30 days. Returns readable errors; never throws.
 */
export async function syncIdentifiers(db: DB, rb: IdCatalog, opts: { maxCalls?: number } = {}): Promise<string[]> {
  const max = opts.maxCalls ?? idPagesPerSync();
  if (max <= 0) return [];
  const errors: string[] = [];
  if (stale(await getSetting(db, COLORS_AT))) {
    try {
      const colors = await rb.colors();
      await remember(db, colors.flatMap((c) => rbMappings('color', c.id, c)));
      await putSetting(db, COLORS_AT, new Date().toISOString());
    } catch (e) {
      errors.push(`Rebrickable colours: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let cursor = await getSetting(db, CURSOR);
  if (!cursor && !stale(await getSetting(db, PARTS_AT))) return errors; // the last full pass is recent
  try {
    for (let calls = 0; calls < max; calls++) {
      const page = await rb.partsPage(cursor || null);
      await remember(db, page.parts.flatMap((p) => rbMappings('part', p.partNo, p)));
      cursor = page.next;
      if (!cursor) {
        await db.delete(settings).where(eq(settings.key, CURSOR));
        await putSetting(db, PARTS_AT, new Date().toISOString());
        break;
      }
      await putSetting(db, CURSOR, cursor);
    }
  } catch (e) {
    errors.push(`Rebrickable part IDs: ${e instanceof Error ? e.message : String(e)}`);
  }
  return errors;
}
