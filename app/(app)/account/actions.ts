'use server';
// Server actions for /account (#90 phase 2): each acts only on the signed-in person's own account (lib/account.ts).
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { authMode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { DEMO_ERROR, isDemo } from '@/lib/demo';
import type { Result } from '@/lib/service/sets';

async function run(fn: (account: typeof import('@/lib/account'), db: Awaited<ReturnType<typeof getDb>>, h: Headers) => Promise<Result>): Promise<Result> {
  if (authMode() !== 'better-auth') return { ok: false, error: 'Accounts are managed by your sign-in proxy.' };
  if (isDemo()) return { ok: false, error: DEMO_ERROR };
  try {
    const r = await fn(await import('@/lib/account'), await getDb(), await headers());
    if (r.ok) refresh();
    return r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function changeName(name: string) { return run((a, db, h) => a.changeName(db, h, name)); }
export async function changePassword(current: string, next: string) { return run((a, db, h) => a.changePassword(db, h, current, next)); }
export async function addPassword(next: string) { return run((a, db, h) => a.addPassword(db, h, next)); }
export async function revokeSession(id: string) { return run((a, db, h) => a.revokeSession(db, h, id)); }
export async function revokeOtherSessions() { return run((a, db, h) => a.revokeOtherSessions(db, h)); }
export async function unlinkAccount(id: string) { return run((a, db, h) => a.unlinkAccount(db, h, id)); }
