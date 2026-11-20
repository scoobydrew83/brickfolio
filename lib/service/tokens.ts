// API tokens for the REST API (mobile app, scripts). The token is shown once; only its SHA-256 hash is stored.
import { and, desc, eq } from 'drizzle-orm';
import { apiTokens } from '../db/schema';
import type { DB } from '../db/types';
import type { Result } from './sets';

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A new token for `owner` (the login creating it): it acts with that login's permissions. */
export async function createToken(db: DB, rawName: unknown, owner: string | null = null): Promise<Result<{ token: string }>> {
  const name = String(rawName ?? '').trim();
  if (!name || name.length > 60) return { ok: false, status: 400, error: 'Name must be 1–60 characters' };
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = 'bf_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await db.insert(apiTokens).values({ name, hash: await sha256Hex(token), prefix: token.slice(0, 8), owner });
  return { ok: true, token };
}

/** Tokens, newest first: every token (`owner` undefined, for admins), or one login's. */
export async function listTokens(db: DB, owner?: string) {
  const q = db.select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, owner: apiTokens.owner }).from(apiTokens);
  return (owner === undefined ? q : q.where(eq(apiTokens.owner, owner))).orderBy(desc(apiTokens.id)).all();
}

/** Revokes a token: any (`owner` undefined, for admins) or only one of `owner`'s. */
export async function revokeToken(db: DB, id: number, owner?: string): Promise<void> {
  await db.delete(apiTokens).where(owner === undefined ? eq(apiTokens.id, id) : and(eq(apiTokens.id, id), eq(apiTokens.owner, owner)));
}

/** The token's name and owner if it's valid, recording when it was last used. */
export async function checkToken(db: DB, token: string): Promise<{ name: string; owner: string | null } | null> {
  if (!token.startsWith('bf_')) return null;
  const row = await db.select().from(apiTokens).where(eq(apiTokens.hash, await sha256Hex(token))).get();
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiTokens.id, row.id));
  return { name: row.name, owner: row.owner };
}
