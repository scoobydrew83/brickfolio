// API tokens for the REST API (mobile app, scripts). The token is shown once; only its SHA-256 hash is stored.
import { desc, eq } from 'drizzle-orm';
import { apiTokens } from '../db/schema';
import type { DB } from '../db/types';
import type { Result } from './sets';

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createToken(db: DB, rawName: unknown): Promise<Result<{ token: string }>> {
  const name = String(rawName ?? '').trim();
  if (!name || name.length > 60) return { ok: false, status: 400, error: 'Name must be 1–60 characters' };
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = 'bf_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await db.insert(apiTokens).values({ name, hash: await sha256Hex(token), prefix: token.slice(0, 8) });
  return { ok: true, token };
}

export async function listTokens(db: DB) {
  return db.select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens).orderBy(desc(apiTokens.id)).all();
}

export async function revokeToken(db: DB, id: number): Promise<void> {
  await db.delete(apiTokens).where(eq(apiTokens.id, id));
}

/** Returns the token's name if it's valid, and records when it was last used. */
export async function checkToken(db: DB, token: string): Promise<string | null> {
  if (!token.startsWith('bf_')) return null;
  const row = await db.select().from(apiTokens).where(eq(apiTokens.hash, await sha256Hex(token))).get();
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiTokens.id, row.id));
  return row.name;
}
