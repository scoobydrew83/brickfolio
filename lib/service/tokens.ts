// API tokens for the REST API, MCP, the mobile app and scripts (#90): kept in Better Auth's apiKey plugin table
// (`apikey`), in the plugin's own format, so its endpoints and verifyApiKey work on them too. The token is shown once;
// only its SHA-256 hash is stored (unpadded base64url, as the plugin stores it).
//
// - Brickfolio reads and writes the table itself rather than through `auth.api`: it works in every AUTH_MODE (the
//   proxy modes have no BETTER_AUTH_SECRET, so no Better Auth instance), and checking a token is one indexed lookup
//   with `last_request` written at most once a minute per token, where the plugin's verifyApiKey writes the row twice
//   on every request.
// - A token belongs to a Better Auth user (`reference_id` = user id) and acts with that person's current roles. Tokens
//   without a person (from before #50, or made with AUTH_MODE=none) belong to SYSTEM_OWNER, which is no user: they
//   act as admin, as before, and only admins see and revoke them (Settings → API tokens, "no owner").
// - The old `api_tokens` table is copied in on first use (migrateLegacyTokens) and kept for rollback: nothing new is
//   written to it, but revoking a copied token deletes its old row too, so going back can't bring it back.
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { apiTokens, authApiKey, authUser, settings } from '../db/schema';
import type { DB } from '../db/types';
import { ensureUser, normLogin } from './permissions';
import type { Result } from './sets';

export const PREFIX = 'bf_';
/** `reference_id` of tokens that belong to nobody and act as admin. Never a user id (those are random UUIDs). */
export const SYSTEM_OWNER = 'system';
/** Copies of `api_tokens` rows are `legacy_<id>`. */
export const LEGACY = 'legacy_';
/** How many characters of the token are kept to tell tokens apart (`bf_` and 5 more). */
const START = 8;
/** `last_request` is written at most this often per token. */
const TOUCH_EVERY_MS = 60_000;
/** The choices for a new token's expiry, in days. */
export const EXPIRY_DAYS = [30, 90, 365] as const;
/** `settings` key: the highest `api_tokens.id` already copied, so a token revoked later is never copied again. */
const MOVED_THROUGH = 'api_tokens_moved_through';

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export async function sha256Hex(s: string): Promise<string> {
  return [...(await sha256(s))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the apiKey plugin stores for a key (its defaultKeyHasher): SHA-256, unpadded base64url. */
export const hashKey = async (key: string) => b64url(await sha256(key));

/** The plugin's stored hash of an `api_tokens` hash (the same SHA-256, hex instead of base64url). */
export const hexToKeyHash = (hex: string) => b64url(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))));

/** An `api_tokens` row as an `apikey` row of `referenceId` (a user id, or SYSTEM_OWNER). */
export function asApiKeyRow(t: { id?: number; name: string; hash: string; prefix: string; createdAt: string; lastUsedAt?: string | null }, referenceId: string) {
  const at = new Date(t.createdAt);
  return {
    id: t.id === undefined ? crypto.randomUUID() : `${LEGACY}${t.id}`, configId: 'default', name: t.name, start: t.prefix, prefix: PREFIX,
    key: hexToKeyHash(t.hash), referenceId, enabled: true, rateLimitEnabled: false, requestCount: 0,
    lastRequest: t.lastUsedAt ? new Date(t.lastUsedAt) : null, createdAt: at, updatedAt: at,
  };
}

/** Whether a login has no person behind it: no login, or AUTH_MODE=none's `local`. Such tokens act as admin. */
const ownerless = (owner: string | null | undefined) => !owner || owner === 'local';

const done = new WeakMap<object, Promise<void>>();

/**
 * Copies `api_tokens` rows into `apikey` (#90), once per process and database. Idempotent and safe to run at the same
 * time in several places: each copy has a fixed id (`legacy_<id>`), is one statement that inserts only while the old
 * row still exists, and is skipped when the id is there. Rows up to the highest copied id are never copied again, so
 * a revoked (or expired) copy stays gone. Copies whose old row was deleted (revoked after rolling back to a version
 * that used `api_tokens`) are removed. One statement per row: D1 has no transactions and 100 parameters per query.
 */
export function migrateLegacyTokens(db: DB): Promise<void> {
  let p = done.get(db);
  if (!p) {
    p = moveLegacyTokens(db).catch((e) => { done.delete(db); throw e; });
    done.set(db, p);
  }
  return p;
}

/** One pass of migrateLegacyTokens, without the once-per-process memo (tests, and anything that must re-check). */
export async function moveLegacyTokens(db: DB) {
  const through = Number((await db.select({ v: settings.value }).from(settings).where(eq(settings.key, MOVED_THROUGH)).get())?.v ?? 0) || 0;
  const rows = await db.select().from(apiTokens).where(gt(apiTokens.id, through)).orderBy(apiTokens.id).all();
  for (const t of rows) {
    const ref = ownerless(t.owner) ? SYSTEM_OWNER : await ensureUser(db, normLogin(t.owner));
    const r = asApiKeyRow(t, ref);
    await db.run(sql`INSERT INTO apikey (id, config_id, name, start, prefix, key, reference_id, enabled, rate_limit_enabled, request_count, last_request, created_at, updated_at)
      SELECT ${r.id}, ${r.configId}, ${r.name}, ${r.start}, ${r.prefix}, ${r.key}, ${r.referenceId}, 1, 0, 0, ${r.lastRequest?.getTime() ?? null}, ${r.createdAt.getTime()}, ${r.updatedAt.getTime()}
      WHERE EXISTS (SELECT 1 FROM api_tokens WHERE id = ${t.id}) ON CONFLICT (id) DO NOTHING`);
  }
  if (rows.length) {
    const max = String(rows[rows.length - 1].id);
    await db.insert(settings).values({ key: MOVED_THROUGH, value: max })
      .onConflictDoUpdate({ target: settings.key, set: { value: sql`max(CAST(${settings.value} AS INTEGER), CAST(excluded.value AS INTEGER))` } });
  }
  const gone = await db.select({ id: authApiKey.id }).from(authApiKey)
    .where(and(sql`${authApiKey.id} GLOB 'legacy_*'`, sql`NOT EXISTS (SELECT 1 FROM api_tokens t WHERE 'legacy_' || t.id = ${authApiKey.id})`)).all();
  for (const g of gone) await db.delete(authApiKey).where(eq(authApiKey.id, g.id));
}

export type TokenRow = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; owner: string | null };

/**
 * A new token for `owner` (the login creating it): it acts with that login's permissions. `expiresInDays`: null (the
 * default) never expires, else one of EXPIRY_DAYS.
 */
export async function createToken(db: DB, rawName: unknown, owner: string | null = null, expiresInDays: unknown = null): Promise<Result<{ token: string }>> {
  const name = String(rawName ?? '').trim();
  if (!name || name.length > 60) return { ok: false, status: 400, error: 'Name must be 1–60 characters' };
  const days = expiresInDays === null || expiresInDays === undefined || expiresInDays === '' ? null : Number(expiresInDays);
  if (days !== null && !(EXPIRY_DAYS as readonly number[]).includes(days)) return { ok: false, status: 400, error: `Expiry must be never or ${EXPIRY_DAYS.join(', ')} days` };
  await migrateLegacyTokens(db);
  const token = PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(authApiKey).values({
    id, configId: 'default', name, start: token.slice(0, START), prefix: PREFIX, key: await hashKey(token),
    referenceId: ownerless(owner) ? SYSTEM_OWNER : await ensureUser(db, normLogin(owner)),
    enabled: true, rateLimitEnabled: false, requestCount: 0, createdAt: now, updatedAt: now,
    expiresAt: days === null ? null : new Date(now.getTime() + days * 86_400_000),
  });
  return { ok: true, token };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Tokens, newest first: every token (`owner` undefined, for admins), or one login's. `owner` null = no owner. */
export async function listTokens(db: DB, owner?: string): Promise<TokenRow[]> {
  await migrateLegacyTokens(db);
  const q = db.select({ id: authApiKey.id, name: authApiKey.name, start: authApiKey.start, createdAt: authApiKey.createdAt, lastRequest: authApiKey.lastRequest, expiresAt: authApiKey.expiresAt, ref: authApiKey.referenceId, email: authUser.email })
    .from(authApiKey).leftJoin(authUser, eq(authUser.id, authApiKey.referenceId));
  const rows = await (owner === undefined ? q : q.where(eq(authUser.email, normLogin(owner)))).orderBy(desc(authApiKey.createdAt), desc(sql`"apikey"."rowid"`)).all(); // ties: newest row first
  return rows.map((r) => ({
    id: r.id, name: r.name ?? '', prefix: r.start ?? '', createdAt: iso(r.createdAt)!, lastUsedAt: iso(r.lastRequest), expiresAt: iso(r.expiresAt),
    owner: r.ref === SYSTEM_OWNER ? null : r.email ?? '(deleted user)',
  }));
}

/** Revokes a token: any (`owner` undefined, for admins) or only one of `owner`'s. Takes effect on the next request. */
export async function revokeToken(db: DB, id: string, owner?: string): Promise<void> {
  await migrateLegacyTokens(db);
  const row = await db.select({ ref: authApiKey.referenceId, email: authUser.email }).from(authApiKey).leftJoin(authUser, eq(authUser.id, authApiKey.referenceId)).where(eq(authApiKey.id, String(id))).get();
  if (!row || (owner !== undefined && (row.ref === SYSTEM_OWNER || row.email !== normLogin(owner)))) return;
  await dropLegacyRow(db, String(id));
  await db.delete(authApiKey).where(eq(authApiKey.id, String(id)));
}

/** For a copied token being revoked: deletes its old `api_tokens` row first, so a rollback can't bring it back. */
export async function dropLegacyRow(db: DB, id: string) {
  if (!id.startsWith(LEGACY)) return;
  const n = Number(id.slice(LEGACY.length));
  if (Number.isInteger(n)) await db.delete(apiTokens).where(eq(apiTokens.id, n));
}

/**
 * The token's name and owner (null: acts as admin) if it's valid: enabled, not expired, and its owner still a user.
 * One lookup on the indexed hash; `last_request` is written at most once a minute per token.
 */
export async function checkToken(db: DB, token: string): Promise<{ id: string; name: string; owner: string | null } | null> {
  if (!token.startsWith(PREFIX)) return null;
  await migrateLegacyTokens(db);
  const row = await db.select({ id: authApiKey.id, name: authApiKey.name, ref: authApiKey.referenceId, enabled: authApiKey.enabled, expiresAt: authApiKey.expiresAt, remaining: authApiKey.remaining, lastRequest: authApiKey.lastRequest, email: authUser.email })
    .from(authApiKey).leftJoin(authUser, eq(authUser.id, authApiKey.referenceId)).where(eq(authApiKey.key, await hashKey(token))).get();
  const now = Date.now();
  if (!row || row.enabled === false || (row.expiresAt && row.expiresAt.getTime() <= now) || (row.remaining !== null && row.remaining <= 0)) return null;
  if (row.ref !== SYSTEM_OWNER && !row.email) return null; // its person was deleted
  const owner = row.ref === SYSTEM_OWNER ? null : row.email;
  if (!row.lastRequest || row.lastRequest.getTime() <= now - TOUCH_EVERY_MS) {
    const stale = new Date(now - TOUCH_EVERY_MS);
    await db.update(authApiKey).set({ lastRequest: new Date(now) }).where(and(eq(authApiKey.id, row.id), or(isNull(authApiKey.lastRequest), lt(authApiKey.lastRequest, stale))));
  }
  return { id: row.id, name: row.name ?? '', owner };
}
