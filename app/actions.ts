'use server';
// Server actions for the dashboard: check the user, validate, call the service layer, refresh the page.
import { refresh } from 'next/cache';
import { after } from 'next/server';
import { getDb } from '@/lib/db';
import { parseSetInput } from '@/lib/sets';
import * as svc from '@/lib/service/sets';
import * as tokens from '@/lib/service/tokens';
import { importCsv } from '@/lib/service/csv';
import { brickColors, brickStore, bricklink, brickset, currentUser, rebrickable } from '@/lib/session';
import * as parts from '@/lib/service/parts';
import * as wish from '@/lib/service/wishlist';
import * as models from '@/lib/service/models';
import * as ldraw from '@/lib/ldraw/download';
import { DEMO_ERROR, isDemo } from '@/lib/demo';
import { rebrickableStats, type RebrickableStats } from '@/lib/service/catalog';
import { retailStats, syncRetail, type RetailStats } from '@/lib/service/retail';
import { rebrickableRun, startRebrickableSync, type RebrickableRun } from '@/lib/rebrickable/run';

export type Result = svc.Result<{ token?: string }>;

/** Runs `fn` for a signed-in user, turns thrown errors into a Result, and refreshes the page on success. */
async function act(fn: () => Promise<svc.Result<object>>): Promise<Result> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  if (isDemo()) return { ok: false, error: DEMO_ERROR };
  try {
    const r = await fn();
    if (r.ok) refresh();
    return r.ok ? { ok: true, ...('token' in r ? { token: String(r.token) } : {}) } : r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
const input = async (form: Record<string, unknown>, partial: boolean) => parseSetInput(form, partial, await svc.listLocations(await getDb()));

/** `another` = the user confirmed adding one more copy of a set already in stock. */
export async function addSet(form: Record<string, unknown>, another = false): Promise<Result> {
  return act(async () => {
    const p = await input(form, false);
    return p.ok ? svc.addSet(await getDb(), p.value, { another, lookup: bricklink() }) : p;
  });
}

export async function editSet(form: Record<string, unknown>): Promise<Result> {
  return act(async () => {
    const p = await input(form, true);
    return p.ok ? svc.editSet(await getDb(), p.value, bricklink()) : p;
  });
}

/** Removes one copy: lowers qty when there are several, deletes the set on the last one. */
export async function removeSet(setNo: string): Promise<Result> {
  return act(async () => {
    const p = await input({ setNo }, true);
    return p.ok ? svc.removeOne(await getDb(), p.value.setNo) : p;
  });
}

export async function relookupSet(setNo: string): Promise<Result> {
  return act(async () => {
    const p = await input({ setNo }, true);
    return p.ok ? svc.relookup(await getDb(), p.value.setNo, bricklink()) : p;
  });
}

/** Starts a full sync in the background. The page polls sync status until it finishes. */
export async function runSync(): Promise<Result> {
  return act(async () => {
    const lookup = bricklink();
    if (!lookup) return { ok: false, error: 'Set the BRICKLINK_* keys to sync prices.' };
    const db = await getDb();
    const s = await svc.startSync(db);
    if (s.ok) after(() => svc.runSync(db, s.runId, lookup, brickStore() ?? undefined, rebrickable() ?? undefined, brickset() ?? undefined));
    return s;
  });
}

export async function reload(): Promise<void> {
  if (await currentUser()) refresh();
}

// ---- settings ----

export async function addLocation(name: string) { return act(async () => svc.addLocation(await getDb(), name)); }
export async function renameLocation(from: string, to: string) { return act(async () => svc.renameLocation(await getDb(), from, to)); }
export async function deleteLocation(name: string) { return act(async () => svc.deleteLocation(await getDb(), name)); }
export async function setCurrency(code: string) { return act(async () => svc.setCurrency(await getDb(), code)); }
export async function createToken(name: string) { return act(async () => tokens.createToken(await getDb(), name)); }
export async function revokeToken(id: number) {
  return act(async () => { await tokens.revokeToken(await getDb(), id); return { ok: true }; });
}

/** Avg sold price per day for one set, for the trend line in the edit dialog. */
export async function priceHistoryFor(setNo: string): Promise<{ date: string; avgSold: number | null }[]> {
  if (!(await currentUser())) return [];
  const db = await getDb();
  const s = await svc.getSet(db, setNo);
  return s ? (await svc.priceHistory(db, s.id)).map(({ date, avgSold }) => ({ date, avgSold })) : [];
}

/** Imports an uploaded Sets or History CSV (e.g. the old Google Sheet tabs). */
export async function importFile(form: FormData): Promise<Result & { message?: string }> {
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'Choose a CSV file.' };
  if (file.size > 5_000_000) return { ok: false, error: 'File is over 5 MB.' };
  let message = '';
  const r = await act(async () => {
    const res = await importCsv(await getDb(), await file.text());
    if (res.ok) {
      message = `Imported ${res.count} ${res.kind === 'sets' ? 'sets' : res.kind === 'parts' ? 'parts' : 'history rows'}.`;
      if (res.skipped) message += ` Skipped ${res.skipped} parts of sets that aren't in the collection; import the Sets tab first.`;
    }
    return res;
  });
  return r.ok ? { ...r, message } : r;
}

// ---- parts ----

/** A set's parts list with color names (loads the color list from BrickLink the first time). */
export async function partsFor(setNo: string): Promise<parts.PartRow[]> {
  if (!(await currentUser())) return [];
  const db = await getDb();
  const s = await svc.getSet(db, setNo);
  if (!s) return [];
  await parts.ensureColors(db, brickColors());
  return parts.listSetParts(db, s.id);
}

/** Fetches a set's parts list from BrickLink again. */
export async function refreshPartsFor(setNo: string): Promise<Result> {
  return act(async () => {
    const p = await input({ setNo }, true);
    return p.ok ? svc.refreshParts(await getDb(), p.value.setNo, bricklink()) : p;
  });
}

/** Search across every set's parts, for the Parts page. */
export async function searchAllParts(f: parts.PartSearch): Promise<{ parts: parts.PartSearchRow[]; total: number }> {
  if (!(await currentUser())) return { parts: [], total: 0 };
  const db = await getDb();
  await parts.ensureColors(db, brickColors());
  return parts.searchParts(db, { q: String(f.q ?? '').slice(0, 100), type: f.type ? String(f.type) : undefined, limit: 200, offset: Number(f.offset) || 0 });
}

// ---- wishlist ----

export async function addWish(form: Record<string, unknown>): Promise<Result> {
  return act(async () => {
    const p = wish.parseWishInput(form);
    return p.ok ? wish.addWish(await getDb(), p.value, bricklink()) : p;
  });
}

export async function editWish(form: Record<string, unknown>): Promise<Result> {
  return act(async () => {
    const p = wish.parseWishInput(form, true);
    return p.ok ? wish.editWish(await getDb(), p.value, bricklink()) : p;
  });
}

export async function removeWish(setNo: string): Promise<Result> {
  return act(async () => wish.removeWish(await getDb(), setNo));
}

/** You got it: moves the set from the wishlist into the collection. */
export async function acquireWish(setNo: string): Promise<Result> {
  return act(async () => wish.acquireWish(await getDb(), setNo, bricklink()));
}

// ---- 3D models ----

export async function uploadModel(setNo: string, form: FormData): Promise<Result> {
  return act(async () => {
    const file = form.get('file');
    if (!(file instanceof File)) return { ok: false, error: 'Choose an LDraw file to upload.' };
    if (file.size > models.MAX_MODEL_BYTES) return { ok: false, error: 'That model is over 2 MB.' };
    const p = await input({ setNo }, true);
    return p.ok ? models.saveModel(await getDb(), p.value.setNo, file.name, await file.text()) : p;
  });
}

/** Looks the set up in LDraw's Official Model Repository and saves its model. */
export async function findOmrModel(setNo: string): Promise<Result> {
  return act(async () => {
    const p = await input({ setNo }, true);
    return p.ok ? models.importOmrModel(await getDb(), p.value.setNo) : p;
  });
}

export async function removeModel(setNo: string): Promise<Result> {
  return act(async () => {
    const p = await input({ setNo }, true);
    return p.ok ? models.removeModel(await getDb(), p.value.setNo) : p;
  });
}

/** Settings → download (or update) the LDraw parts library in the background. */
export async function downloadLdrawLibrary(): Promise<Result> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  if (isDemo()) return { ok: false, error: DEMO_ERROR };
  const error = await ldraw.startLibraryDownload();
  return error ? { ok: false, error } : { ok: true };
}

/** Progress of the library download, for the Settings page to poll. */
export async function ldrawLibraryStatus(): Promise<ldraw.LibraryStatus | null> {
  return (await currentUser()) ? ldraw.libraryStatus() : null;
}

export type RebrickableStatus = { key: boolean; stats: RebrickableStats; run: RebrickableRun };

/** Settings → Rebrickable: whether the key is set, how many sets are matched, and any running sync. */
export async function rebrickableStatus(): Promise<RebrickableStatus | null> {
  if (!(await currentUser())) return null;
  return { key: !!rebrickable(), stats: await rebrickableStats(await getDb()), run: rebrickableRun() };
}

/** Makes one call to Rebrickable with the key and reports what it said. */
export async function testRebrickableKey(): Promise<Result> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  if (isDemo()) return { ok: false, error: DEMO_ERROR };
  const rb = rebrickable();
  if (!rb) return { ok: false, error: 'REBRICKABLE_API_KEY isn\'t set on the server.' };
  try {
    await rb.check?.();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs the Rebrickable part of the sync now, without BrickLink, and asks again about sets it didn't know. */
export async function syncRebrickableNow(): Promise<Result> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  if (isDemo()) return { ok: false, error: DEMO_ERROR };
  const rb = rebrickable();
  if (!rb) return { ok: false, error: 'REBRICKABLE_API_KEY isn\'t set on the server.' };
  const run = startRebrickableSync(await getDb(), rb, { recheck: true });
  if (run) after(() => run);
  return { ok: true };
}

export type BricksetStatus = { key: boolean; stats: RetailStats };

/** Settings → Brickset: whether the key is set and how many sets have retail prices and dates. */
export async function bricksetStatus(): Promise<BricksetStatus | null> {
  if (!(await currentUser())) return null;
  return { key: !!brickset(), stats: await retailStats(await getDb()) };
}

/** Makes one call to Brickset with the key and reports what it said. */
export async function testBricksetKey(): Promise<Result> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  if (isDemo()) return { ok: false, error: DEMO_ERROR };
  const bs = brickset();
  if (!bs) return { ok: false, error: 'BRICKSET_API_KEY isn\'t set on the server.' };
  try {
    await bs.check();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetches retail prices and dates now, without waiting for the daily sync (at most 10 Brickset calls). */
export async function syncBricksetNow(): Promise<Result> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  if (isDemo()) return { ok: false, error: DEMO_ERROR };
  const bs = brickset();
  if (!bs) return { ok: false, error: 'BRICKSET_API_KEY isn\'t set on the server.' };
  const errors = await syncRetail(await getDb(), bs);
  if (errors.length) return { ok: false, error: errors.join('; ') };
  refresh();
  return { ok: true };
}
