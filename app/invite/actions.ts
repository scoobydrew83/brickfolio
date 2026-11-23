'use server';
// Server actions for invitations (#90 phase 2): sending and cancelling them (Settings → People and Members),
// accepting and declining them (/invite/<id> and /account). The rules are in lib/service/invitations.ts.
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { authMode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { DEMO_ERROR, isDemo } from '@/lib/demo';
import { currentAccess, currentUser } from '@/lib/session';
import * as inv from '@/lib/service/invitations';
import type { Result } from '@/lib/service/sets';

type Out = Result & { url?: string; sent?: boolean; mailError?: string };

async function guard(): Promise<Result | null> {
  if (authMode() !== 'better-auth') return { ok: false, error: 'Invitations need AUTH_MODE=better-auth.' };
  if (isDemo()) return { ok: false, error: DEMO_ERROR };
  return null;
}
const caught = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

/** The app's address for links when BETTER_AUTH_URL isn't set: this request's. */
async function origin() {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim();
  const proto = (h.get('x-forwarded-proto') ?? 'https').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

export async function inviteMember(collectionId: number, email: string, role: string): Promise<Out> {
  const g = await guard();
  if (g) return g;
  const access = await currentAccess();
  if (!access) return { ok: false, error: 'Not signed in.' };
  try {
    const r = await inv.createInvite(await getDb(), access, Number(collectionId), email, role, { base: await origin() });
    if (!r.ok) return r;
    refresh();
    return { ok: true, url: r.url, sent: r.sent, ...(r.mailError ? { mailError: r.mailError } : {}) };
  } catch (e) { return caught(e); }
}

export async function cancelInvitation(id: string): Promise<Result> {
  const g = await guard();
  if (g) return g;
  const access = await currentAccess();
  if (!access) return { ok: false, error: 'Not signed in.' };
  try { const r = await inv.cancelInvite(await getDb(), access, String(id)); if (r.ok) refresh(); return r; } catch (e) { return caught(e); }
}

/** For the invited person: identify() only answers for a verified, allowed address. */
async function asInvitee(fn: (db: Awaited<ReturnType<typeof getDb>>, user: { email: string; emailVerified: boolean }) => Promise<Result>): Promise<Result> {
  const g = await guard();
  if (g) return g;
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in (with a confirmed email address) first.' };
  try { const r = await fn(await getDb(), { email: user.user, emailVerified: true }); if (r.ok) refresh(); return r; } catch (e) { return caught(e); }
}

export async function acceptInvitation(id: string): Promise<Result> { return asInvitee((db, u) => inv.acceptInvite(db, u, String(id))); }
export async function declineInvitation(id: string): Promise<Result> { return asInvitee((db, u) => inv.rejectInvite(db, u, String(id))); }
