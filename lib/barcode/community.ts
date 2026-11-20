// The shared community list: barcodes and minifigure box codes that Brickfolio users have confirmed and a maintainer
// has reviewed, kept as a CC0 file in the public GitHub repository (github.com/scoobydrew83/brickfolio,
// lib/barcode/data/community.json). Each installation
// downloads it (daily, or from Settings) and keeps a copy with source 'community'; nothing is uploaded. To contribute,
// Settings → Barcode scanning → Share exports your own confirmed codes (barcode and set number only, nothing else
// about your collection) for a pull request or issue. See CONTRIBUTING.md → Community barcodes.
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { identifiers, minifigCodes, minifigs as ownedFigs, settings } from '../db/schema';
import { remember } from '../identifiers/resolve';
import { FIG_NO } from '../minifigs';
import { barcodeCounts, barcodeRows, pruneBarcodes, saveBarcode } from '../identifiers/barcodes';
import { parseBarcode } from './gtin';
import { parseFigCode } from './figcodes';
import shipped from './data/community.json';

/** The public Brickfolio repository: where the list is published and where contributions go (issues, pull requests). */
export const REPO = 'scoobydrew83/brickfolio';
export const DEFAULT_URL = `https://raw.githubusercontent.com/${REPO}/main/lib/barcode/data/community.json`;
const SET_NO = /^\d{3,7}-\d{1,2}$/;

export type CommunitySet = { barcode: string; setNo: string };
export type CommunityFig = { code: string; factory?: string; year?: string; name: string; series: string; rbFigNo?: string };
/** A Rebrickable minifigure (fig-012345) and its BrickLink number (sw0001), so parts lists need no BrickLink call (#85). */
export type CommunityFigNumber = { rbFigNo: string; figNo: string };
export type CommunityFile = { license: string; about?: string; sets: CommunitySet[]; minifigs: CommunityFig[]; minifigNumbers?: CommunityFigNumber[] };
type ParsedSet = { barcode: string; format: 'UPC_A' | 'EAN_13' | 'EAN_8' | 'UPC_E'; gtin: string; setNo: string };
type ParsedFig = { code: string; factory: string; year: string; name: string; series: string; rbFigNo: string | null };

/**
 * Checks a community file entry by entry. Bad entries are reported and skipped, never trusted. `conflicts` lists
 * barcodes or box codes given to more than one set or figure, which a reviewer must settle before merging.
 */
export function parseCommunity(json: unknown): { sets: ParsedSet[]; minifigs: ParsedFig[]; minifigNumbers: CommunityFigNumber[]; errors: string[]; conflicts: string[] } {
  const errors: string[] = [], conflicts: string[] = [];
  const f = (json && typeof json === 'object' ? json : {}) as Partial<CommunityFile>;
  if (f.license !== 'CC0-1.0') errors.push('license must be CC0-1.0');
  const sets: ParsedSet[] = [], minifigs: ParsedFig[] = [];
  const seen = new Map<string, string>();
  for (const [i, e] of (Array.isArray(f.sets) ? f.sets : []).slice(0, 50_000).entries()) {
    const b = parseBarcode(e?.barcode);
    const no = String(e?.setNo ?? '');
    if (!b.ok) { errors.push(`sets[${i}]: ${b.error}`); continue; }
    if (!SET_NO.test(no)) { errors.push(`sets[${i}]: set number must look like 75192-1`); continue; }
    const prev = seen.get(b.gtin);
    if (prev === no) { errors.push(`sets[${i}]: ${b.raw} is listed twice`); continue; }
    if (prev) conflicts.push(`${b.raw}: ${prev} and ${no}`);
    seen.set(b.gtin, no);
    sets.push({ barcode: b.raw, format: b.format, gtin: b.gtin, setNo: no });
  }
  const seenFig = new Map<string, string>();
  for (const [i, e] of (Array.isArray(f.minifigs) ? f.minifigs : []).slice(0, 50_000).entries()) {
    const code = parseFigCode(e?.code);
    const factory = String(e?.factory ?? ''), year = String(e?.year ?? '');
    const name = String(e?.name ?? '').trim(), series = String(e?.series ?? '').trim();
    const rb = e?.rbFigNo ? String(e.rbFigNo) : null;
    if (!code || code.code !== String(e?.code)) { errors.push(`minifigs[${i}]: code must be 7 digits`); continue; }
    if (!/^[A-Z]?$/.test(factory) || !/^\d?$/.test(year)) { errors.push(`minifigs[${i}]: factory is one capital letter, year one digit`); continue; }
    if (!name || !series || name.length > 80 || series.length > 80) { errors.push(`minifigs[${i}]: name and series are required`); continue; }
    if (rb && !/^fig-\d{6}$/.test(rb)) { errors.push(`minifigs[${i}]: rbFigNo must look like fig-013525`); continue; }
    const key = `${code.code}|${factory}|${year}`, fig = `${series} / ${name}`;
    const prev = seenFig.get(key);
    if (prev === fig) { errors.push(`minifigs[${i}]: ${key} is listed twice`); continue; }
    if (prev) conflicts.push(`${key}: ${prev} and ${fig}`);
    seenFig.set(key, fig);
    minifigs.push({ code: code.code, factory, year, name, series, rbFigNo: rb });
  }
  // Rebrickable → BrickLink minifigure numbers. One Rebrickable figure given two BrickLink numbers, or two Rebrickable
  // figures given one (Rebrickable sometimes splits what BrickLink lists once), is a conflict for a reviewer.
  const minifigNumbers: CommunityFigNumber[] = [];
  const byRb = new Map<string, string>(), byBl = new Map<string, string>();
  for (const [i, e] of (Array.isArray(f.minifigNumbers) ? f.minifigNumbers : []).slice(0, 50_000).entries()) {
    const rb = String(e?.rbFigNo ?? '').trim().toLowerCase(), bl = String(e?.figNo ?? '').trim().toLowerCase();
    if (!/^fig-\d{6}$/.test(rb)) { errors.push(`minifigNumbers[${i}]: rbFigNo must look like fig-013525`); continue; }
    if (!FIG_NO.test(bl)) { errors.push(`minifigNumbers[${i}]: figNo must be a BrickLink minifigure number like sw0001`); continue; }
    if (byRb.get(rb) === bl) { errors.push(`minifigNumbers[${i}]: ${rb} → ${bl} is listed twice`); continue; }
    if (byRb.has(rb)) conflicts.push(`${rb}: ${byRb.get(rb)} and ${bl}`);
    if (byBl.has(bl) && byBl.get(bl) !== rb) conflicts.push(`${bl}: ${byBl.get(bl)} and ${rb}`);
    byRb.set(rb, bl); byBl.set(bl, rb);
    minifigNumbers.push({ rbFigNo: rb, figNo: bl });
  }
  return { sets, minifigs, minifigNumbers, errors, conflicts };
}

const getSetting = async (db: DB, key: string) => (await db.select().from(settings).where(eq(settings.key, key)).get())?.value ?? null;
const putSetting = (db: DB, key: string, value: string) => db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });

export type CommunityStatus = { enabled: boolean; syncedAt: string | null; sets: number; minifigs: number; minifigNumbers: number; url: string };

export function communityConfig(env: Record<string, string | undefined> = process.env) {
  return { enabled: env.COMMUNITY_LIST !== 'off', url: env.COMMUNITY_LIST_URL || DEFAULT_URL };
}

export async function communityStatus(db: DB, env: Record<string, string | undefined> = process.env): Promise<CommunityStatus> {
  const c = communityConfig(env);
  const s = { n: (await barcodeCounts(db)).community ?? 0 };
  const [m] = await db.select({ n: sql<number>`count(*)` }).from(minifigCodes).where(eq(minifigCodes.source, 'community')).all();
  const [n] = await db.select({ n: sql<number>`count(*)` }).from(identifiers).where(figNumberRows('community')).all();
  return { ...c, syncedAt: await getSetting(db, 'community_synced_at'), sets: Number(s.n), minifigs: Number(m.n), minifigNumbers: Number(n.n) };
}

/** Rebrickable → BrickLink minifigure rows in the identifiers map, from one source. */
const figNumberRows = (source: 'community' | 'bricklink' | 'user') =>
  and(eq(identifiers.kind, 'minifig'), eq(identifiers.scheme, 'rebrickable'), eq(identifiers.source, source));

/** Replaces the local copy of the community list with `file`. Entries dropped from the list are dropped here too. */
export async function applyCommunity(db: DB, file: unknown): Promise<{ sets: number; minifigs: number; minifigNumbers: number; skipped: number }> {
  const p = parseCommunity(file);
  // A barcode or code in dispute isn't trusted until a reviewer settles it.
  const disputed = new Set(p.conflicts.map((c) => c.split(':')[0]));
  const sets = p.sets.filter((s) => !disputed.has(s.barcode));
  const figs = p.minifigs.filter((m) => !disputed.has(`${m.code}|${m.factory}|${m.year}`));
  const t = new Date().toISOString();
  for (const s of sets) {
    await saveBarcode(db, { barcode: s.barcode, format: s.format, gtin: s.gtin, setNo: s.setNo, source: 'community', verified: false }, 'seen');
  }
  await pruneBarcodes(db, 'community', sets.map((s) => `${s.gtin}|${s.setNo}`));
  for (const m of figs) {
    const row = { name: m.name, series: m.series, rbFigNo: m.rbFigNo, updatedAt: t };
    await db.insert(minifigCodes).values({ code: m.code, factory: m.factory, year: m.year, source: 'community', ...row })
      .onConflictDoUpdate({ target: [minifigCodes.code, minifigCodes.factory, minifigCodes.year, minifigCodes.source], set: row });
  }
  const keepFigs = figs.map((m) => `${m.code}|${m.factory}|${m.year}`);
  await db.delete(minifigCodes).where(and(eq(minifigCodes.source, 'community'), keepFigs.length ? notInArray(sql`${minifigCodes.code} || '|' || ${minifigCodes.factory} || '|' || ${minifigCodes.year}`, keepFigs) : sql`1 = 1`));
  // Minifigure numbers in dispute are skipped, both sides, until a reviewer settles them.
  const disputedNo = new Set(p.conflicts.map((c) => c.split(':')[0]));
  const nums = p.minifigNumbers.filter((n) => !disputedNo.has(n.rbFigNo) && !disputedNo.has(n.figNo));
  await remember(db, nums.map((n) => ({ kind: 'minifig' as const, scheme: 'rebrickable' as const, value: n.rbFigNo, canonical: n.figNo, source: 'community' as const })));
  const keepNums = new Set(nums.map((n) => `${n.rbFigNo}|${n.figNo}`));
  const gone = (await db.select({ id: identifiers.id, value: identifiers.value, canonical: identifiers.canonical }).from(identifiers).where(figNumberRows('community')).all())
    .filter((r) => !keepNums.has(`${r.value}|${r.canonical}`)).map((r) => r.id);
  for (let i = 0; i < gone.length; i += 90) await db.delete(identifiers).where(inArray(identifiers.id, gone.slice(i, i + 90)));
  await putSetting(db, 'community_synced_at', t);
  return {
    sets: sets.length, minifigs: figs.length, minifigNumbers: nums.length,
    skipped: p.errors.length + (p.sets.length - sets.length) + (p.minifigs.length - figs.length) + (p.minifigNumbers.length - nums.length),
  };
}

/**
 * Downloads the community list (unchanged lists cost one small request, via ETag) and applies it. When the download
 * fails, the copy that shipped with this version is used the first time, so a new install starts with it.
 * Returns a readable error, or null.
 */
export async function syncCommunity(db: DB, opts: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {}): Promise<string | null> {
  const c = communityConfig(opts.env ?? process.env);
  if (!c.enabled) return null;
  const etag = await getSetting(db, 'community_etag');
  try {
    const res = await (opts.fetchImpl ?? fetch)(c.url, { headers: { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 304) { await putSetting(db, 'community_synced_at', new Date().toISOString()); return null; }
    // Not published at that address (yet): keep what's here, and start from the shipped copy. Not an error.
    if (res.status === 404) { if (!(await getSetting(db, 'community_synced_at'))) await applyCommunity(db, shipped); return null; }
    if (!res.ok) throw new Error(`the list answered ${res.status}`);
    const file = await res.json();
    await applyCommunity(db, file);
    const tag = res.headers.get('etag');
    if (tag) await putSetting(db, 'community_etag', tag);
    return null;
  } catch (e) {
    if (!(await getSetting(db, 'community_synced_at'))) await applyCommunity(db, shipped);
    return `Community list: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Loads the shipped list once, for a new install that hasn't synced yet. */
export async function ensureCommunity(db: DB, env: Record<string, string | undefined> = process.env) {
  if (communityConfig(env).enabled && !(await getSetting(db, 'community_synced_at'))) await applyCommunity(db, shipped);
}

/**
 * Rebrickable → BrickLink minifigure numbers this install knows and the community list doesn't have yet: the ones it
 * learned from BrickLink's own parts lists (#83), ones you confirmed, and minifigures you own with both numbers.
 */
export async function shareableFigNumbers(db: DB): Promise<CommunityFigNumber[]> {
  const pairs = new Map<string, string>();
  for (const src of ['bricklink', 'user'] as const) {
    for (const r of await db.select({ rb: identifiers.value, bl: identifiers.canonical }).from(identifiers).where(figNumberRows(src)).all()) pairs.set(r.rb, r.bl);
  }
  for (const o of await db.select({ rb: ownedFigs.rbFigNo, bl: ownedFigs.figNo }).from(ownedFigs).all()) {
    if (o.rb && o.bl) pairs.set(o.rb.toLowerCase(), o.bl.toLowerCase());
  }
  const listed = new Set((await db.select({ rb: identifiers.value, bl: identifiers.canonical }).from(identifiers).where(figNumberRows('community')).all()).map((r) => `${r.rb}|${r.bl}`));
  return [...pairs].filter(([rb, bl]) => /^fig-\d{6}$/.test(rb) && FIG_NO.test(bl) && !listed.has(`${rb}|${bl}`))
    .map(([rbFigNo, figNo]) => ({ rbFigNo, figNo })).sort((a, b) => (a.rbFigNo < b.rbFigNo ? -1 : 1));
}

/**
 * Your own confirmed codes in the community file's format, ready to share: barcode and set number, box code and
 * figure. Nothing else from the collection. With `minifigNumbers`, also the Rebrickable → BrickLink minifigure
 * numbers this install knows (catalogue facts, but they hint at which sets you own, so it's your choice).
 */
export async function shareable(db: DB, opts: { minifigNumbers?: boolean } = {}): Promise<CommunityFile> {
  const sets = (await barcodeRows(db, { source: 'user', verified: true })).map((r) => ({ barcode: r.barcode, setNo: r.setNo }))
    .sort((a, b) => (a.setNo < b.setNo ? -1 : a.setNo > b.setNo ? 1 : 0));
  const figs = await db.select().from(minifigCodes).where(and(eq(minifigCodes.source, 'user'), eq(minifigCodes.verified, true))).orderBy(minifigCodes.series, minifigCodes.name).all();
  return {
    license: 'CC0-1.0',
    sets,
    minifigs: figs.map((m) => ({ code: m.code, ...(m.factory ? { factory: m.factory } : {}), ...(m.year ? { year: m.year } : {}), name: m.name, series: m.series, ...(m.rbFigNo ? { rbFigNo: m.rbFigNo } : {}) })),
    ...(opts.minifigNumbers ? { minifigNumbers: await shareableFigNumbers(db) } : {}),
  };
}

/** A prefilled GitHub issue for sharing, or null when the list is too long for a link (attach the file instead). */
export function shareIssueUrl(file: CommunityFile): string | null {
  const nums = file.minifigNumbers ?? [];
  const n = file.sets.length + file.minifigs.length + nums.length;
  const why = nums.length ? ' The minifigure numbers are pairs my Brickfolio matched from BrickLink\'s and Rebrickable\'s lists of sets I own.' : '';
  const body = `These codes are from boxes I scanned and checked myself.${why} I release them under CC0.\n\n\`\`\`json\n${JSON.stringify({ sets: file.sets, minifigs: file.minifigs, ...(nums.length ? { minifigNumbers: nums } : {}) }, null, 1)}\n\`\`\`\n`;
  const url = `https://github.com/${REPO}/issues/new?${new URLSearchParams({ title: `Community barcodes: ${n} code${n === 1 ? '' : 's'}`, labels: 'community-barcodes', body })}`;
  return url.length <= 7500 ? url : null;
}
