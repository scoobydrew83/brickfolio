// Invitations to a collection (#90 phase 2), stored in Better Auth's `invitation` table (organization `col_<id>`).
//
// Who may invite follows setRole: admins into any collection, owners into theirs; viewers and editors can't, and
// nobody invites at a role they couldn't set. Accepting is setRole on the inviter's behalf, with the inviter's rights
// *at that moment*: someone who has since lost the collection can't bring anyone in, and the 90-member cap applies.
//
// Trust model: the link (`/invite/<id>`) only says which invitation; it proves nothing about who opened it (an admin
// may have copied it into a chat). Accepting needs a session whose address is verified (its email link, a reset
// link, an admin setting the password, or a provider that vouches for it) and is the invited address. A pending
// invitation also lets that one address sign up while sign-up is closed, but only with email set up, so the
// verification link can prove it. That's why the link can be shown again to whoever manages the collection.
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { authInvitation, authMember, authOrganization, authUser, collections, ROLES } from '../db/schema';
import { allowed } from '../auth';
import { emailConfigured, sendAuthEmail } from '../email';
import type { Result } from './sets';
import * as perm from './permissions';

/** How long an invitation works. */
export const INVITE_DAYS = 7;
export const INVITE_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;
export const INVITE_PATH = '/invite';

const EMAIL = /^[^\s@<>,;]{1,100}@[^\s@<>,;]{1,100}$/;

/** A pending invitation, for the people who manage its collection. */
export type InviteRow = { id: string; collectionId: number; collection: string; email: string; role: perm.Role; inviter: string; expiresAt: string; url: string };
/** What the invitation page shows. */
export type InviteInfo = { id: string; email: string; role: perm.Role; collection: string; inviter: string; state: 'pending' | 'expired' | 'accepted' | 'canceled' | 'rejected' };

/** The link someone opens to accept. `base`: the app's address (BETTER_AUTH_URL, else the request's origin). */
export const inviteUrl = (id: string, base = process.env.BETTER_AUTH_URL ?? '') => `${base.replace(/\/+$/, '')}${INVITE_PATH}/${encodeURIComponent(id)}`;

const asRole = (r: string | null): perm.Role | null => ((ROLES as readonly string[]).includes(r ?? '') ? (r as perm.Role) : null);
const live = (now = new Date()) => and(eq(authInvitation.status, 'pending'), gt(authInvitation.expiresAt, now));

/** The invitation with its collection, inviter and role. */
async function find(db: DB, id: string) {
  if (!id || id.length > 200) return undefined;
  return db.select({ id: authInvitation.id, email: authInvitation.email, role: authInvitation.role, status: authInvitation.status, expiresAt: authInvitation.expiresAt, organizationId: authInvitation.organizationId, collectionId: authOrganization.collectionId, collection: authOrganization.name, inviter: authUser.email, inviterName: authUser.name })
    .from(authInvitation).innerJoin(authOrganization, eq(authOrganization.id, authInvitation.organizationId)).innerJoin(authUser, eq(authUser.id, authInvitation.inviterId))
    .where(eq(authInvitation.id, id)).get();
}

/** Whether `email` has an invitation that's still pending (it may then sign up while sign-up is closed). */
export async function hasPendingInvite(db: DB, email: string): Promise<boolean> {
  return !!(await db.select({ id: authInvitation.id }).from(authInvitation).where(and(eq(authInvitation.email, perm.normLogin(email)), live())).get());
}

/**
 * Sign-up allowed by an invitation: a pending one for this address, and the address proven, either already
 * (`proven`: a provider verified it, or an emailed sign-in link) or by its verification link, which needs email set up.
 */
export const invitedSignup = async (db: DB, email: string, env: Record<string, string | undefined> = process.env, proven = false) =>
  (proven || emailConfigured(env)) && hasPendingInvite(db, email);

/** Mails the invitation (Better Auth's `sendInvitationEmail` calls this too). */
export async function sendInvitationEmail(i: { email: string; url: string; inviter: string; collection: string }) {
  await sendAuthEmail('invitation', { to: i.email, url: i.url, inviter: i.inviter, collection: i.collection });
}

/**
 * Invites `email` to a collection as `role`. With email set up the link is mailed (`sent`); either way it comes
 * back as `url`, for copying. Inviting someone already invited there replaces their invitation (a new link).
 */
export async function createInvite(db: DB, actor: perm.Access, collectionId: number, rawEmail: unknown, role: unknown, opts: { base?: string; env?: Record<string, string | undefined> } = {}): Promise<Result<{ id: string; url: string; sent: boolean; mailError?: string }>> {
  const env = opts.env ?? process.env;
  const email = perm.normLogin(rawEmail);
  if (!EMAIL.test(email)) return { ok: false, status: 400, error: 'Enter their email address.' };
  const r = asRole(typeof role === 'string' ? role : null);
  if (!r) return { ok: false, status: 400, error: `Role must be one of: ${ROLES.join(', ')}.` };
  const col = await db.select({ id: collections.id, name: collections.name }).from(collections).where(eq(collections.id, collectionId)).get();
  if (!col) return { ok: false, status: 404, error: `Collection ${collectionId} doesn't exist.` };
  const c = perm.check(actor, { action: 'manage', collectionId });
  if (!c.ok) return c;
  if (email === actor.login) return { ok: false, status: 409, error: "You can't invite yourself." };
  if (!allowed(email)) return { ok: false, status: 409, error: `${email} isn't in ALLOWED_USERS, so they couldn't sign in. Add them there first.` };
  const inviter = await db.select({ id: authUser.id, name: authUser.name }).from(authUser).where(eq(authUser.email, actor.login)).get();
  if (!inviter) return { ok: false, status: 409, error: 'Sign in with your own account to invite people.' };
  await perm.syncOrg(db, collectionId, col.name);
  const org = perm.orgId(collectionId);
  const member = await db.select({ id: authMember.id }).from(authMember).innerJoin(authUser, eq(authUser.id, authMember.userId)).where(and(eq(authMember.organizationId, org), eq(authUser.email, email))).get();
  if (member) return { ok: false, status: 409, error: `${email} already has a role in ${col.name}. Change it in the list instead.` };
  const now = new Date();
  // Members plus other pending invitations: everyone could accept, and a collection holds at most MEMBERSHIP_LIMIT.
  const [{ n: members }] = await db.select({ n: sql<number>`count(*)` }).from(authMember).where(eq(authMember.organizationId, org)).all();
  const [{ n: pending }] = await db.select({ n: sql<number>`count(*)` }).from(authInvitation).where(and(eq(authInvitation.organizationId, org), live(now), sql`${authInvitation.email} <> ${email}`)).all();
  if (Number(members) + Number(pending) >= perm.MEMBERSHIP_LIMIT) return { ok: false, status: 409, error: `${col.name} already has ${perm.MEMBERSHIP_LIMIT} members and invitations, the most a collection can have.` };
  await db.update(authInvitation).set({ status: 'canceled' }).where(and(eq(authInvitation.organizationId, org), eq(authInvitation.email, email), eq(authInvitation.status, 'pending')));
  const id = crypto.randomUUID();
  await db.insert(authInvitation).values({ id, organizationId: org, email, role: r, status: 'pending', expiresAt: new Date(now.getTime() + INVITE_MS), createdAt: now, inviterId: inviter.id });
  const url = inviteUrl(id, env.BETTER_AUTH_URL || opts.base || '');
  if (!emailConfigured(env)) return { ok: true, id, url, sent: false };
  try {
    await sendInvitationEmail({ email, url, inviter: inviter.name && inviter.name !== actor.login ? `${inviter.name} (${actor.login})` : actor.login, collection: col.name });
    return { ok: true, id, url, sent: true };
  } catch (e) {
    // The invitation stands: the link can be copied instead.
    return { ok: true, id, url, sent: false, mailError: e instanceof Error ? e.message : String(e) };
  }
}

/** Pending invitations in the collections `actor` manages (every collection for admins). */
export async function listInvites(db: DB, actor: perm.Access, base = process.env.BETTER_AUTH_URL ?? ''): Promise<InviteRow[]> {
  const ids = actor.admin ? null : [...actor.roles.keys()].filter((c) => perm.can(actor, { action: 'manage', collectionId: c }));
  if (ids && !ids.length) return [];
  const q = () => db.select({ id: authInvitation.id, email: authInvitation.email, role: authInvitation.role, expiresAt: authInvitation.expiresAt, collectionId: authOrganization.collectionId, collection: authOrganization.name, inviter: authUser.email })
    .from(authInvitation).innerJoin(authOrganization, eq(authOrganization.id, authInvitation.organizationId)).innerJoin(authUser, eq(authUser.id, authInvitation.inviterId));
  const rows = ids ? (await Promise.all(perm.chunks(ids).map((c) => q().where(and(live(), inArray(authOrganization.collectionId, c))).all()))).flat() : await q().where(live()).all();
  return rows.flatMap((x) => {
    const role = asRole(x.role);
    return role ? [{ id: x.id, collectionId: x.collectionId, collection: x.collection, email: x.email, role, inviter: x.inviter, expiresAt: x.expiresAt.toISOString(), url: inviteUrl(x.id, base) }] : [];
  }).sort((a, b) => a.collection.localeCompare(b.collection) || a.email.localeCompare(b.email));
}

/** Pending invitations for an address (shown on its /account page). */
export async function invitesFor(db: DB, email: string): Promise<InviteInfo[]> {
  const rows = await db.select({ id: authInvitation.id }).from(authInvitation).where(and(eq(authInvitation.email, perm.normLogin(email)), live())).all();
  return (await Promise.all(rows.map((r) => getInvite(db, r.id)))).filter((i): i is InviteInfo => !!i);
}

/** What the invitation page shows, or null when there's no such invitation. */
export async function getInvite(db: DB, id: string, now = new Date()): Promise<InviteInfo | null> {
  const i = await find(db, id);
  const role = i && asRole(i.role);
  if (!i || !role) return null;
  const state = i.status === 'pending' ? (i.expiresAt > now ? 'pending' : 'expired') : (['accepted', 'canceled', 'rejected'] as const).find((s) => s === i.status) ?? 'canceled';
  return { id: i.id, email: i.email, role, collection: i.collection, inviter: i.inviterName && i.inviterName !== i.inviter ? `${i.inviterName} (${i.inviter})` : i.inviter, state };
}

const gone: Record<string, string> = {
  accepted: 'This invitation has already been accepted.', canceled: 'This invitation was cancelled.', rejected: 'This invitation was declined.',
  expired: 'This invitation has expired. Ask for a new one.',
};

/** The invitation, when it's still pending and for `email`; else why not. */
async function mine(db: DB, id: string, email: string): Promise<{ ok: true; i: NonNullable<Awaited<ReturnType<typeof find>>> } | { ok: false; status: 403 | 404 | 409; error: string }> {
  const i = await find(db, id);
  if (!i) return { ok: false, status: 404, error: "This invitation doesn't exist." };
  if (i.status !== 'pending') return { ok: false, status: 409, error: gone[i.status] ?? gone.canceled };
  if (i.expiresAt <= new Date()) return { ok: false, status: 409, error: gone.expired };
  if (i.email !== perm.normLogin(email)) return { ok: false, status: 403, error: `This invitation is for ${i.email}. Sign in as them to accept it.` };
  return { ok: true, i };
}

/**
 * Accepts an invitation for the signed-in `user`, whose address must be verified: they get its role, set by the
 * inviter's rights as they are now. Returns the collection.
 */
export async function acceptInvite(db: DB, user: { email: string; emailVerified: boolean }, id: string, env: Record<string, string | undefined> = process.env): Promise<Result<{ collectionId: number; role: perm.Role }>> {
  if (!user.emailVerified) return { ok: false, status: 403, error: 'Confirm your email address first (follow the link in the email we sent), then accept.' };
  const m = await mine(db, id, user.email);
  if (!m.ok) return m;
  const { i } = m;
  const role = asRole(i.role);
  if (!role) return { ok: false, status: 409, error: gone.canceled };
  if (!allowed(i.email)) return { ok: false, status: 403, error: "You don't have access." };
  // Claim it first (one statement), so the same invitation can't be accepted twice at once.
  const claimed = await db.update(authInvitation).set({ status: 'accepted' }).where(and(eq(authInvitation.id, i.id), eq(authInvitation.status, 'pending'))).returning({ id: authInvitation.id }).all();
  if (!claimed.length) return { ok: false, status: 409, error: gone.accepted };
  const inviter = await perm.accessOf(db, i.inviter, env);
  const r = perm.can(inviter, { action: 'manage', collectionId: i.collectionId })
    ? await perm.setRole(db, inviter, i.collectionId, i.email, role)
    : { ok: false as const, status: 409 as const, error: `${i.inviter} can no longer add people to ${i.collection}. Ask them or an admin for a new invitation.` };
  if (!r.ok) {
    await db.update(authInvitation).set({ status: 'pending' }).where(and(eq(authInvitation.id, i.id), eq(authInvitation.status, 'accepted')));
    return r;
  }
  return { ok: true, collectionId: i.collectionId, role };
}

/** Declines an invitation (only the invited address can). */
export async function rejectInvite(db: DB, user: { email: string; emailVerified: boolean }, id: string): Promise<Result> {
  if (!user.emailVerified) return { ok: false, status: 403, error: 'Confirm your email address first.' };
  const m = await mine(db, id, user.email);
  if (!m.ok) return m;
  await db.update(authInvitation).set({ status: 'rejected' }).where(and(eq(authInvitation.id, m.i.id), eq(authInvitation.status, 'pending')));
  return { ok: true };
}

/** Cancels a pending invitation: admins, and owners of its collection. */
export async function cancelInvite(db: DB, actor: perm.Access, id: string): Promise<Result> {
  const i = await find(db, id);
  if (!i) return { ok: false, status: 404, error: "That invitation doesn't exist." };
  const c = perm.check(actor, { action: 'manage', collectionId: i.collectionId });
  if (!c.ok) return c;
  if (i.status !== 'pending') return { ok: false, status: 409, error: gone[i.status] ?? gone.canceled };
  await db.update(authInvitation).set({ status: 'canceled' }).where(eq(authInvitation.id, i.id));
  return { ok: true };
}

/** The collection behind a Better Auth organization id, if it is one. */
export async function collectionOfOrg(db: DB, organizationId: string): Promise<number | undefined> {
  return (await db.select({ c: authOrganization.collectionId }).from(authOrganization).where(eq(authOrganization.id, organizationId)).get())?.c;
}

/** The invitation row as Better Auth's endpoints return it. */
export async function invitationRow(db: DB, id: string) {
  return db.select().from(authInvitation).where(eq(authInvitation.id, id)).get();
}
