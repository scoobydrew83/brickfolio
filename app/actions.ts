'use server';
// Server actions for the dashboard: check the user, validate, call the service layer, refresh the page.
import { refresh } from 'next/cache';
import { after } from 'next/server';
import { getDb } from '@/lib/db';
import { parseQuickList, parseSetInput } from '@/lib/sets';
import * as svc from '@/lib/service/sets';
import * as tokens from '@/lib/service/tokens';
import { importCsv } from '@/lib/service/csv';
import { barcodeProviders, brickColors, brickMinifig, brickPartPrice, brickStore, bricklink, brickset, currentUser, rebrickable } from '@/lib/session';
import * as barcodes from '@/lib/service/barcodes';
import { describeSet, resolveBarcode, type Resolution, type ScanCandidate } from '@/lib/barcode/resolve';
import { formatHint } from '@/lib/barcode/gtin';
import { lookupLimit } from '@/lib/barcode/limit';
import { scanSummary } from '@/lib/barcode/summary';
import * as community from '@/lib/barcode/community';
import { rememberFigCode, resolveFigCode, type FigResolution } from '@/lib/barcode/figcodes';
import * as parts from '@/lib/service/parts';
import * as wish from '@/lib/service/wishlist';
import * as models from '@/lib/service/models';
import * as missing from '@/lib/service/missing';
import * as figs from '@/lib/service/minifigs';
import * as partout from '@/lib/service/partout';
import * as designer from '@/lib/service/designer';
import type { MissingItem } from '@/lib/service/missing';
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
    if (s.ok) after(() => svc.runSync(db, s.runId, lookup, brickStore() ?? undefined, rebrickable() ?? undefined, brickset() ?? undefined, { minifig: brickMinifig() ?? undefined, partPrice: brickPartPrice() ?? undefined }));
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

/** Saves the parts marked missing from a set (Missing % and Partial follow). */
export async function saveMissingParts(setNo: string, items: MissingItem[]): Promise<Result> {
  return act(async () => {
    const p = await input({ setNo }, true);
    return p.ok ? missing.saveMissing(await getDb(), p.value.setNo, items, bricklink()) : p;
  });
}

// ---- minifigures ----

const figInput = async (form: Record<string, unknown>, partial: boolean) => figs.parseFigInput(form, await svc.listLocations(await getDb()), partial);

/** `merge` = the user confirmed adding more copies of a figure already in stock. */
export async function addMinifig(form: Record<string, unknown>, merge = false): Promise<Result> {
  return act(async () => {
    const p = await figInput(form, false);
    return p.ok ? figs.addMinifig(await getDb(), p.value, { lookup: brickMinifig(), merge }) : p;
  });
}

export async function editMinifig(key: string, form: Record<string, unknown>): Promise<Result> {
  return act(async () => {
    const p = await figInput(form, true);
    return p.ok ? figs.editMinifig(await getDb(), key, p.value, brickMinifig()) : p;
  });
}

export async function removeMinifig(key: string): Promise<Result> {
  return act(async () => figs.removeMinifig(await getDb(), key));
}

/** One Collectible Minifigures series with what you own (asks Rebrickable the first time). */
export async function cmfChecklistFor(themeId: number): Promise<svc.Result<{ figs: figs.CmfFig[]; owned: number; total: number }>> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  if (!Number.isInteger(themeId)) return { ok: false, error: 'Pick a series.' };
  try {
    return await figs.cmfChecklist(await getDb(), themeId, rebrickable());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ticks a checklist figure off: adds it (Rebrickable number only, unpriced) or one more copy. */
export async function tickCmfFig(fig: { rbFigNo: string; name: string; imageUrl: string | null }): Promise<Result> {
  return act(async () => {
    const p = await figInput({ rbFigNo: fig.rbFigNo, name: fig.name, imageUrl: fig.imageUrl }, false);
    return p.ok ? figs.addMinifig(await getDb(), p.value, { lookup: null, merge: true }) : p;
  });
}

// ---- quick add ----

/** Adds a pasted list of set and minifig numbers. Returns a one-line summary. */
export async function quickAddList(text: string, location: string, condition: string): Promise<Result & { message?: string }> {
  let message = '';
  const r = await act(async () => {
    const list = parseQuickList(String(text ?? '').slice(0, 50_000));
    if (!list.sets.length && !list.minifigs.length) return { ok: false, error: list.invalid.length ? `Nothing recognised. Check: ${list.invalid.slice(0, 5).join(', ')}` : 'Paste at least one set number.' };
    const cond = condition === 'New' || condition === 'Used' || condition === 'Partial' ? condition : undefined;
    const res = await svc.quickAdd(await getDb(), list, { location: location || null, condition: cond, lookup: bricklink(), minifig: brickMinifig() });
    if (res.ok) message = quickSummary(res);
    return res;
  });
  return r.ok ? { ...r, message } : r;
}

function quickSummary(r: svc.QuickAddResult): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    r.added && `Added ${n(r.added, 'set')}`,
    r.merged && `${n(r.merged, 'set')} you had got more copies`,
    r.figsAdded && `added ${n(r.figsAdded, 'minifig')}`,
    r.figsMerged && `${n(r.figsMerged, 'minifig')} got more copies`,
  ].filter(Boolean).join(', ');
  const wait = r.waiting ? ` ${n(r.waiting, 'item')} will be looked up on BrickLink at the next sync.` : '';
  const bad = r.invalid.length ? ` Skipped ${r.invalid.slice(0, 5).join(', ')}${r.invalid.length > 5 ? ` and ${r.invalid.length - 5} more` : ''}.` : '';
  return `${parts.charAt(0).toUpperCase()}${parts.slice(1)}.${wait}${bad}`;
}

// ---- part-out value ----

/** Most part prices "Price parts now" fetches for one set (about 250 ms each). */
const PRICE_NOW_MAX = 600;

/** Prices one set's parts in the background. The page shows the part-out value once they're in. */
export async function priceSetParts(setNo: string): Promise<Result & { message?: string }> {
  const lookup = brickPartPrice();
  let message = '';
  const r = await act(async () => {
    if (!lookup) return { ok: false, error: 'Set the BRICKLINK_* keys to price parts.' };
    const p = await input({ setNo }, true);
    if (!p.ok) return p;
    const db = await getDb();
    const s = await svc.getSet(db, p.value.setNo);
    if (!s) return { ok: false, status: 404, error: 'Set not found.' };
    const currency = await svc.getCurrency(db);
    const todo = Math.min(await partout.unpricedLots(db, s.id, s.condition, currency), PRICE_NOW_MAX);
    if (!todo) { message = 'Every part already has a recent price.'; return { ok: true }; }
    after(async () => {
      await partout.refreshPartPrices(db, lookup, currency, { setIds: [s.id], maxCalls: todo });
      await missing.reapplyMissing(db);
    });
    const secs = Math.ceil(todo * 0.3);
    message = `Pricing ${todo} part${todo === 1 ? '' : 's'} on BrickLink in the background, about ${secs < 90 ? `${secs} seconds` : `${Math.ceil(secs / 60)} minutes`}. Reload the page to see the part-out value.`;
    return { ok: true };
  });
  return r.ok ? { ...r, message } : r;
}

// ---- BrickLink Designer Program ----

export async function addDesignerProject(form: Record<string, unknown>): Promise<Result> {
  return act(async () => {
    const p = designer.parseProjectInput({ ...form, watching: form.watching ?? 'false' });
    return p.ok ? designer.addProject(await getDb(), p.value) : p;
  });
}

export async function editDesignerProject(id: number, form: Record<string, unknown>): Promise<Result> {
  return act(async () => {
    const p = designer.parseProjectInput({ ...form, watching: form.watching ?? 'false' }, true);
    return p.ok ? designer.editProject(await getDb(), id, p.value) : p;
  });
}

export async function removeDesignerProject(id: number): Promise<Result> {
  return act(async () => designer.removeProject(await getDb(), id));
}

// ---- barcode scanner ----

/**
 * Finds the set for a scanned or typed barcode. A read, so it also works in the demo (saved barcodes only, nothing
 * stored, no outside calls). `refresh` asks the providers again for a barcode that recently wasn't found.
 */
export async function lookupBarcode(code: string, format?: string | null, refresh = false): Promise<Resolution | { status: 'error'; error: string }> {
  if (!(await currentUser())) return { status: 'error', error: 'Not signed in.' };
  if (!lookupLimit().take()) return { status: 'error', error: 'Too many lookups. Wait a minute and scan again.' };
  try {
    const db = await getDb();
    if (!isDemo()) await community.ensureCommunity(db);
    return await resolveBarcode(db, String(code ?? '').slice(0, 40), { providers: barcodeProviders(), hint: formatHint(format), readOnly: isDemo(), refresh });
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/** A set typed in by hand on the scanner: what the collection, wishlist and saved barcodes know about it. */
export async function describeScanSet(no: string): Promise<{ ok: true; set: ScanCandidate } | { ok: false; error: string }> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  const n = String(no ?? '').trim();
  if (!/^\d{3,7}(-\d{1,2})?$/.test(n)) return { ok: false, error: 'Set number must look like 10280 or 10280-1' };
  return { ok: true, set: await describeSet(await getDb(), n.includes('-') ? n : `${n}-1`) };
}

/** "This barcode is that set": saved so the next scan finds it. */
export async function rememberScan(code: string, setNo: string, format?: string | null): Promise<Result> {
  return act(async () => barcodes.rememberBarcode(await getDb(), code, setNo, formatHint(format)));
}

/** "Wrong set": forgets the link between this barcode and that set. */
export async function forgetScan(code: string, setNo: string): Promise<Result> {
  return act(async () => barcodes.forgetBarcode(await getDb(), code, setNo));
}

/** Adds scanned sets (one, or a reviewed batch). `key` makes a retried submit safe. Returns a one-line summary. */
export async function addScannedSets(items: unknown, key: string, figList?: unknown): Promise<Result & { message?: string; result?: barcodes.ScanAddResult }> {
  let result: barcodes.ScanAddResult | undefined;
  const r = await act(async () => {
    const db = await getDb();
    const p = barcodes.parseScanItems(items ?? [], await svc.listLocations(db));
    if (!p.ok) return p;
    const f = barcodes.parseScanFigs(figList);
    if (!f.ok) return f;
    if (!p.items.length && !f.figs.length) return { ok: false, error: 'Nothing to add.' };
    const res = await barcodes.addScanned(db, p.items, { key, lookup: bricklink(), minifig: brickMinifig(), figs: f.figs });
    if (res.ok) { const { ok: _, ...rest } = res; result = rest; }
    return res;
  });
  return r.ok && result ? { ...r, result, message: scanSummary(result) } : r;
}

// ---- minifigure box codes and the community list ----

/** Finds the figure for a Collectible Minifigures box code (the square code). Loads the series checklist if needed. */
export async function lookupFigCode(text: string): Promise<FigResolution | { status: 'error'; error: string }> {
  if (!(await currentUser())) return { status: 'error', error: 'Not signed in.' };
  try {
    const db = await getDb();
    if (!isDemo()) await community.ensureCommunity(db);
    const src = rebrickable();
    return await resolveFigCode(db, String(text ?? '').slice(0, 64), { loadSeries: src && !isDemo() ? (id) => figs.cmfChecklist(db, id, src) : undefined });
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/** "This box is that figure": remembered for next time. */
export async function rememberFig(text: string, fig: { name: string; series: string; rbFigNo?: string | null }): Promise<Result> {
  return act(async () => rememberFigCode(await getDb(), text, fig));
}

/** Downloads the community list now (Settings). */
export async function syncCommunityNow(): Promise<Result & { message?: string }> {
  let message = '';
  const r = await act(async () => {
    const db = await getDb();
    const err = await community.syncCommunity(db);
    if (err) return { ok: false, error: err };
    const s = await community.communityStatus(db);
    message = `Community list updated: ${s.sets} barcodes and ${s.minifigs} minifigure codes.`;
    return { ok: true };
  });
  return r.ok ? { ...r, message } : r;
}

/** Your confirmed codes in the community format, and a prefilled GitHub issue link when they fit in one. */
export async function shareCodes(): Promise<{ ok: true; file: community.CommunityFile; issueUrl: string | null } | { ok: false; error: string }> {
  if (!(await currentUser())) return { ok: false, error: 'Not signed in.' };
  const file = await community.shareable(await getDb());
  return { ok: true, file, issueUrl: community.shareIssueUrl(file) };
}
