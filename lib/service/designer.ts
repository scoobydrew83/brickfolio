// BrickLink Designer Program tracker: projects you follow through crowdfunding and their pre-order window.
// These sets are made once and retire as soon as the window closes, which is why the window gets alerts.
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { DB } from '../db/types';
import { designerProjects, wishlist } from '../db/schema';
import { displayNo, money, setNo as fullSetNo } from '../sets';
import { daysUntil } from '../radar';
import type { Send } from './alerts';
import { getCurrency, type Result } from './sets';
import { ownedSummary } from './copies';

import { STAGES, type Stage } from '../designer';

export { STAGES, STAGE_LABEL, type Stage } from '../designer';

export type ProjectInput = {
  name?: string; setNo?: string | null; series?: string | null; designer?: string | null; stage?: Stage;
  preorderStart?: string | null; preorderEnd?: string | null; price?: number | null; pieces?: number | null;
  url?: string | null; notes?: string | null; watching?: boolean;
};

/** Where the pre-order window stands today: not dated, coming, open now, or over. */
export type Window = { state: 'none' | 'upcoming' | 'open' | 'closed'; days: number | null };
export type ProjectRow = typeof designerProjects.$inferSelect & { window: Window; owned: number; wished: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates form or JSON input. `partial` = edit. */
export function parseProjectInput(raw: unknown, partial = false): { ok: true; value: ProjectInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const has = (k: string) => r[k] !== undefined;
  const str = (k: string, max: number): string | null | { error: string } => {
    const v = String(r[k] ?? '').trim();
    return v.length > max ? { error: `${k} is too long (${max} characters at most).` } : v || null;
  };
  const value: ProjectInput = {};
  for (const [k, max] of [['name', 120], ['series', 60], ['designer', 80], ['notes', 2000]] as const) {
    if (!has(k)) continue;
    const v = str(k, max);
    if (v && typeof v === 'object') return { ok: false, error: v.error };
    if (k === 'name') { if (v) value.name = v; } else value[k] = v;
  }
  if (!partial && !value.name) return { ok: false, error: 'Name is required.' };
  if (has('setNo')) {
    const v = String(r.setNo ?? '').trim();
    if (v && !/^\d{3,7}(-\d{1,2})?$/.test(v)) return { ok: false, error: 'Set number should look like 910038 or 910038-1.' };
    value.setNo = v ? fullSetNo(v) : null;
  }
  if (has('stage') && r.stage !== '') {
    if (!(STAGES as readonly string[]).includes(String(r.stage))) return { ok: false, error: `Stage must be one of: ${STAGES.join(', ')}.` };
    value.stage = r.stage as Stage;
  }
  for (const k of ['preorderStart', 'preorderEnd'] as const) {
    if (!has(k)) continue;
    const v = String(r[k] ?? '').trim();
    if (v && !DATE.test(v)) return { ok: false, error: 'Dates must look like 2026-12-01.' };
    value[k] = v || null;
  }
  if (value.preorderStart && value.preorderEnd && value.preorderEnd < value.preorderStart) return { ok: false, error: 'The pre-order can’t close before it opens.' };
  for (const k of ['price', 'pieces'] as const) {
    if (!has(k)) continue;
    const v = r[k] === '' || r[k] === null ? null : Number(r[k]);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1_000_000)) return { ok: false, error: `${k === 'price' ? 'Price' : 'Pieces'} must be a positive number.` };
    value[k] = v === null ? null : k === 'pieces' ? Math.round(v) : Math.round(v * 100) / 100;
  }
  if (has('url')) {
    const v = String(r.url ?? '').trim();
    if (v && !/^https:\/\/\S+$/.test(v)) return { ok: false, error: 'Link must start with https://' };
    value.url = v || null;
  }
  if (has('watching')) value.watching = r.watching === true || r.watching === 'on' || r.watching === 'true';
  return { ok: true, value };
}

export function windowOf(p: { preorderStart: string | null; preorderEnd: string | null }, today = new Date().toISOString().slice(0, 10)): Window {
  if (p.preorderEnd && p.preorderEnd < today) return { state: 'closed', days: null };
  if (p.preorderStart && p.preorderStart > today) return { state: 'upcoming', days: daysUntil(p.preorderStart, today) };
  if (p.preorderStart || p.preorderEnd) return { state: 'open', days: p.preorderEnd ? daysUntil(p.preorderEnd, today) : null };
  return { state: 'none', days: null };
}

/** Projects, open and upcoming windows first, with whether you own or want the set. */
export async function listProjects(db: DB, today = new Date().toISOString().slice(0, 10)): Promise<ProjectRow[]> {
  const rows = await db.select().from(designerProjects).orderBy(asc(designerProjects.createdAt), asc(designerProjects.id)).all();
  const nos = rows.flatMap((r) => (r.setNo ? [r.setNo] : []));
  const owned = new Map(nos.length ? [...(await ownedSummary(db))].map(([no, o]) => [fullSetNo(no), o.qty]) : []);
  const wished = new Set(nos.length ? (await db.select({ setNo: wishlist.setNo }).from(wishlist).all()).map((w) => fullSetNo(w.setNo)) : []);
  const rank = { open: 0, upcoming: 1, none: 2, closed: 3 } as const;
  return rows
    .map((r) => ({ ...r, window: windowOf(r, today), owned: (r.setNo && owned.get(r.setNo)) || 0, wished: !!r.setNo && wished.has(r.setNo) }))
    .sort((a, b) => rank[a.window.state] - rank[b.window.state] || (a.window.days ?? 9999) - (b.window.days ?? 9999) || a.name.localeCompare(b.name));
}

export async function getProject(db: DB, id: number) {
  return db.select().from(designerProjects).where(eq(designerProjects.id, id)).get();
}

export async function addProject(db: DB, input: ProjectInput): Promise<Result<{ project: typeof designerProjects.$inferSelect }>> {
  if (!input.name) return { ok: false, status: 400, error: 'Name is required.' };
  const stage = input.stage ?? (input.preorderStart || input.preorderEnd ? 'preorder' : 'crowdfunding');
  const [project] = await db.insert(designerProjects).values({ ...input, name: input.name, stage }).returning().all();
  return { ok: true, project };
}

/** Changes the given fields. Moving a window's dates re-arms its alerts. */
export async function editProject(db: DB, id: number, input: ProjectInput): Promise<Result<{ project: typeof designerProjects.$inferSelect }>> {
  const before = await getProject(db, id);
  if (!before) return { ok: false, status: 404, error: 'That project isn’t on your list.' };
  const rearm = {
    ...(input.preorderStart !== undefined && input.preorderStart !== before.preorderStart ? { openAlertedAt: null } : {}),
    ...(input.preorderEnd !== undefined && input.preorderEnd !== before.preorderEnd ? { closeAlertedAt: null } : {}),
  };
  const [project] = await db.update(designerProjects).set({ ...input, ...rearm, updatedAt: new Date().toISOString() }).where(eq(designerProjects.id, id)).returning().all();
  return { ok: true, project };
}

export async function removeProject(db: DB, id: number): Promise<Result> {
  const r = await db.delete(designerProjects).where(eq(designerProjects.id, id)).returning({ id: designerProjects.id }).all();
  return r.length ? { ok: true } : { ok: false, status: 404, error: 'That project isn’t on your list.' };
}

/** DESIGNER_ALERT_DAYS (default 7; 0 = off): warn this many days before a watched pre-order opens, and 3 days before it closes. */
export const designerAlertDays = () => {
  const n = Number(process.env.DESIGNER_ALERT_DAYS ?? 7);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 0;
};
const CLOSE_DAYS = 3;

/**
 * One alert listing watched projects whose pre-order opens within `days` or closes within 3 days, each sent once
 * per window. Returns an error message instead of throwing.
 */
export async function notifyDesigner(db: DB, send: Send, days = designerAlertDays(), today = new Date().toISOString().slice(0, 10)): Promise<string | null> {
  if (!days) return null;
  const rows = await db.select().from(designerProjects).where(and(eq(designerProjects.watching, true), isNotNull(designerProjects.preorderStart))).all();
  const ending = await db.select().from(designerProjects).where(and(eq(designerProjects.watching, true), isNotNull(designerProjects.preorderEnd), isNull(designerProjects.closeAlertedAt))).all();
  const opening = rows.filter((p) => !p.openAlertedAt && windowOf(p, today).state === 'upcoming' && daysUntil(p.preorderStart!, today) <= days);
  const closing = ending.filter((p) => { const w = windowOf(p, today); return w.state === 'open' && w.days !== null && w.days <= CLOSE_DAYS; });
  if (!opening.length && !closing.length) return null;
  const currency = await getCurrency(db);
  const price = (p: typeof rows[number]) => (p.price != null ? `, ${money(p.price, currency)}` : '');
  const lines = [
    ...opening.map((p) => `${p.name}: pre-order opens ${p.preorderStart} (in ${daysUntil(p.preorderStart!, today)} days)${price(p)}`),
    ...closing.map((p) => { const d = daysUntil(p.preorderEnd!, today); return `${p.name}: pre-order closes ${p.preorderEnd} (${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`})${price(p)}`; }),
  ];
  const all = [...opening, ...closing];
  const base = process.env.APP_URL?.replace(/\/$/, '');
  try {
    await send({
      title: all.length === 1 ? (closing.length ? `${all[0].name}: last days to pre-order` : `${all[0].name}: pre-order opens soon`) : `${all.length} Designer Program pre-orders need a look`,
      message: lines.join('\n'),
      url: base ? `${base}/radar#designer` : null,
      items: all.map((p) => ({ setNo: p.setNo ? displayNo(p.setNo) : '', name: p.name, avgSold: 0, target: p.price ?? 0 })),
    });
  } catch (e) {
    return `Designer Program alert not sent: ${e instanceof Error ? e.message : String(e)}`;
  }
  const at = new Date().toISOString();
  for (const p of opening) await db.update(designerProjects).set({ openAlertedAt: at }).where(eq(designerProjects.id, p.id));
  for (const p of closing) await db.update(designerProjects).set({ closeAlertedAt: at }).where(eq(designerProjects.id, p.id));
  return null;
}
