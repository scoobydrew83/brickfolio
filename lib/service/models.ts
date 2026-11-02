// LDraw models for sets, shown in the 3D view on a set's page: uploaded, or fetched from LDraw's OMR.
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import type { DB } from '../db/types';
import { setModels, sets } from '../db/schema';
import { fetchOmrModel } from '../ldraw/omr';
import { displayNo } from '../sets';
import { getSet, type Result } from './sets';
import { checkModel } from './model-check';

export { MAX_MODEL_BYTES, checkModel } from './model-check';

export async function getModel(db: DB, setId: number) {
  return db.select().from(setModels).where(eq(setModels.setId, setId)).get();
}

export async function saveModel(db: DB, setNo: string, fileName: string, content: string): Promise<Result> {
  const s = await getSet(db, setNo);
  if (!s) return { ok: false, status: 404, error: `#${setNo} isn't in the collection.` };
  const name = fileName.split(/[\\/]/).pop()!.slice(0, 120);
  const error = checkModel(name, content);
  if (error) return { ok: false, status: 400, error };
  const row = { fileName: name, content, uploadedAt: new Date().toISOString() };
  await db.insert(setModels).values({ setId: s.id, ...row }).onConflictDoUpdate({ target: setModels.setId, set: row });
  return { ok: true };
}

export async function removeModel(db: DB, setNo: string): Promise<Result> {
  const s = await getSet(db, setNo);
  if (!s) return { ok: false, status: 404, error: `#${setNo} isn't in the collection.` };
  await db.delete(setModels).where(eq(setModels.setId, s.id));
  return { ok: true };
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Fetches a set's model from LDraw's Official Model Repository and saves it. Fails when the OMR doesn't have it. */
export async function importOmrModel(db: DB, setNo: string, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const s = await getSet(db, setNo);
  if (!s) return { ok: false, status: 404, error: `#${setNo} isn't in the collection.` };
  let model;
  try {
    model = await fetchOmrModel(s.setNo, fetchImpl);
  } catch (e) {
    return { ok: false, error: `Couldn't fetch from LDraw: ${e instanceof Error ? e.message : String(e)}` };
  }
  await db.update(sets).set({ omrCheckedAt: new Date().toISOString() }).where(eq(sets.id, s.id));
  if (!model) return { ok: false, status: 404, error: `LDraw has no model for #${displayNo(s.setNo)} yet. Upload one if you have it.` };
  return saveModel(db, s.setNo, model.fileName, model.content);
}

/**
 * Daily sync: asks the OMR for sets that have no model, a few per run, about one request a second. Sets it
 * doesn't have are asked again after 30 days. Returns readable errors; one failure doesn't stop the rest.
 */
export async function syncOmrModels(db: DB, fetchImpl: typeof fetch = fetch, opts: { max?: number; gapMs?: number } = {}): Promise<string[]> {
  const max = opts.max ?? 10;
  const gapMs = opts.gapMs ?? 1100;
  const stale = new Date(Date.now() - MONTH_MS).toISOString();
  const due = await db
    .select({ id: sets.id, setNo: sets.setNo })
    .from(sets)
    .leftJoin(setModels, eq(setModels.setId, sets.id))
    .where(and(isNull(setModels.setId), or(isNull(sets.omrCheckedAt), lt(sets.omrCheckedAt, stale))))
    .orderBy(asc(sets.omrCheckedAt), asc(sets.setNo))
    .limit(max)
    .all();
  const errors: string[] = [];
  for (const [i, s] of due.entries()) {
    if (i > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    try {
      const model = await fetchOmrModel(s.setNo, fetchImpl);
      if (model) {
        const r = await saveModel(db, s.setNo, model.fileName, model.content);
        if (!r.ok) errors.push(`LDraw model for #${displayNo(s.setNo)}: ${r.error}`);
      }
      await db.update(sets).set({ omrCheckedAt: new Date().toISOString() }).where(eq(sets.id, s.id));
    } catch (e) {
      errors.push(`LDraw model for #${displayNo(s.setNo)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors;
}
