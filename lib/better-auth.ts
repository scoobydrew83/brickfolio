// Better Auth (#90): sign-in with email and password, sessions, and the access control behind collection roles.
// Used with AUTH_MODE=better-auth. One instance per database handle (cached; on D1 the handle is cached per binding).
//
// - Collections are organizations (`organization.collection_id`), roles are `member.role` (viewer/editor/owner,
//   defined in lib/auth-ac.ts), admins are the admin plugin's `user.role = 'admin'`.
// - The first account becomes an admin (claimFirstAdmin: one statement, so two at once can't both be); after that
//   sign-up is closed unless ALLOWED_USERS lists the email or BETTER_AUTH_OPEN_SIGNUP=1. Admins add people in Settings.
// - Passwords: PBKDF2 on Workers, scrypt elsewhere; either verifies anywhere (lib/password.ts).
// - Better Auth's member endpoints (update role, remove, leave) run Brickfolio's setRole, so they follow its rules:
//   admins change any role, owners change others' roles in their collections, nobody but an admin changes their own.
//   Organizations can't be made, renamed or deleted through Better Auth: they follow the collections.
// - Passkeys (@better-auth/passkey) and two-factor (TOTP + backup codes). Password sign-in asks for the code when it's
//   on; a passkey sign-in doesn't (a passkey is already two factors). Adding passkeys and changing two-factor need a
//   session that is still allowed in; a passkey sign-in is refused, like identify, for unverified or unlisted people.
// - Its invitation endpoints (invite, accept, reject, cancel) answer with lib/service/invitations.ts: admins and
//   owners invite, accepting needs a verified session for the invited address, and a pending invitation lets that
//   address sign up while sign-up is closed (with email set up, so it's proven).
// - API tokens live in the apiKey plugin's `apikey` table (lib/service/tokens.ts; old `api_tokens` rows are copied in
//   on first use). Its endpoints manage only the signed-in person's own keys; Settings is where admins see everyone's.
//   No rate limit (the mobile app polls), and a key made through them must keep the `bf_` prefix.
// - Social sign-in (Google, GitHub, Apple; each when its keys are set) and emailed sign-in links (magicLink, when email
//   is set up) follow the same sign-up rules. A provider that verified the address, or following the link, proves it.
// - Settings → People (#102): bans, deletion, sessions and two-factor reset are lib/service/people-admin.ts, and the
//   admin plugin's /admin/* endpoints follow the same rules (the gate in hooks.before). Impersonation runs through a
//   server-only endpoint here (/brickfolio/impersonate) so Brickfolio's admins (ADMIN_USERS too, not only
//   user.role = 'admin') can use it; stopping is the plugin's own /admin/stop-impersonating.
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin, type StandardSchemaV1 } from 'better-auth';
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, sessionMiddleware } from 'better-auth/api';
import { deleteSessionCookie, setSessionCookie } from 'better-auth/cookies';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin, magicLink, organization, twoFactor } from 'better-auth/plugins';
import { revokeUnprovenAccountAccess } from 'better-auth/db';
import { apiKey } from '@better-auth/api-key';
import { passkey } from '@better-auth/passkey';
import { and, eq, sql } from 'drizzle-orm';
import { ac, roles } from './auth-ac';
import { allowed } from './auth';
import { emailConfigured, sendAuthEmail } from './email';
import { hashPassword, verifyPassword } from './password';
import { authAccount, authApiKey, authInvitation, authMember, authOrganization, authPasskey, authSession, authTwoFactor, authUser, authVerification } from './db/schema';
import type { DB } from './db/types';
import * as perm from './service/permissions';
import { magicLinkTwoFactor } from './magic-link-2fa';
import * as invites from './service/invitations';
import * as tokens from './service/tokens';
import * as people from './service/people-admin';
import type { Result } from './service/sets';

export const authSchema = {
  user: authUser, session: authSession, account: authAccount, verification: authVerification,
  organization: authOrganization, member: authMember, invitation: authInvitation, apikey: authApiKey,
  passkey: authPasskey, twoFactor: authTwoFactor,
};

/**
 * Whether a new account may sign up (the first one always may). Others must prove they own the address, so sign-up
 * needs email set up: otherwise anyone could claim an address listed in ALLOWED_USERS or ADMIN_USERS. Without
 * email, admins add people and set their password in Settings → People. `proven`: the sign-up already proves the
 * address (a provider that verified it, or an emailed sign-in link), so it needs no email set up.
 */
export const signupOpen = (email: string, env: Record<string, string | undefined> = process.env, proven = false) =>
  (proven || emailConfigured(env)) && (env.BETTER_AUTH_OPEN_SIGNUP === '1' || (!!(env.ALLOWED_USERS || '').trim() && allowed(email)));

type Env = Record<string, string | undefined>;
const both = (env: Env, id: string, secret: string) => {
  const a = env[id]?.trim(), b = env[secret]?.trim();
  return a && b ? { clientId: a, clientSecret: b } : null;
};

/**
 * Google, GitHub and Apple sign-in, each on when its keys are set. Redirect URI: <BETTER_AUTH_URL>/api/auth/callback/<id>.
 * APPLE_CLIENT_SECRET is the signed JWT Apple asks for (it expires after at most 6 months).
 */
export function socialProviders(env: Env = process.env) {
  const google = both(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  const github = both(env, 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET');
  const apple = both(env, 'APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET');
  const bundle = env.APPLE_APP_BUNDLE_IDENTIFIER?.trim();
  return {
    ...(google && { google: { ...google, prompt: 'select_account' as const } }),
    ...(github && { github }),
    ...(apple && { apple: { ...apple, ...(bundle && { appBundleIdentifier: bundle }) } }),
  };
}
export const PROVIDER_NAMES = { google: 'Google', github: 'GitHub', apple: 'Apple' } as const;
export type SocialProvider = keyof typeof PROVIDER_NAMES;
/** The providers with keys set, in button order. */
export const configuredProviders = (env: Env = process.env) => Object.keys(socialProviders(env)) as SocialProvider[];

// Where Better Auth creates users and links accounts for a provider sign-in (redirect callback, or an ID token).
const OAUTH = ['/callback/', '/oauth2/callback/', '/sign-in/social'];
const viaProvider = (ctx: { path?: string } | null | undefined) => !!ctx?.path && OAUTH.some((p) => ctx.path!.startsWith(p));
/** Whether this sign-up proves the address: a provider that says it verified it, or an emailed sign-in link. */
const proves = (ctx: { path?: string } | null | undefined, user: Record<string, unknown>) =>
  user.emailVerified === true && (viaProvider(ctx) || ctx?.path === '/magic-link/verify');

const BANNED = "You've been banned from this Brickfolio. Ask an admin.";
const CLOSED = { code: 'SIGNUP_CLOSED', message: 'Sign-up is closed. Ask an admin to add you.' };

/** Better Auth endpoints that act with someone's rights: they must still be allowed in (ALLOWED_USERS). */
const GUARDED = ['/organization/', '/admin/', '/api-key/'];
// Passkey and two-factor management (not the sign-in steps, which have no session yet: identify gates their result).
const GUARDED_PATHS = new Set([
  '/passkey/generate-register-options', '/passkey/verify-registration', '/passkey/list-user-passkeys', '/passkey/update-passkey', '/passkey/delete-passkey',
  '/two-factor/enable', '/two-factor/disable', '/two-factor/get-totp-uri', '/two-factor/generate-backup-codes',
]);

/**
 * Passkeys: rpID and origin come from BETTER_AUTH_URL (unset: the request's host, as Better Auth does). A passkey's
 * sign-in skips two-factor (it is already something you have plus a PIN or biometric); password sign-in doesn't.
 */
function passkeyOptions(db: DB) {
  const base = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL) : undefined;
  return {
    rpName: 'Brickfolio', rpID: base?.hostname, origin: base?.origin ?? null,
    authentication: {
      // Refuse before a session is made for someone who couldn't use it (identify checks again on every request).
      async afterVerification({ clientData }: { clientData: { id: string } }) {
        const u = await db.select({ email: authUser.email, emailVerified: authUser.emailVerified }).from(authPasskey)
          .innerJoin(authUser, eq(authUser.id, authPasskey.userId)).where(eq(authPasskey.credentialID, clientData.id)).get();
        if (!u?.emailVerified || !allowed(u.email)) throw new APIError('FORBIDDEN', { message: "You don't have access." });
      },
    },
  };
}

export const MIN_PASSWORD = 10;
export const RESET_PATH = '/reset-password';

// Reset links an admin asked for while email isn't set up: sendResetPassword hands the link back instead of mailing
// it (see resetLink). Never logged.
const wantLink = new Set<string>();
const gotLink = new Map<string, string>();

// Sign-ups that found no accounts yet: one of them (the first to finish) becomes the admin.
const firstTry = new Set<string>();

const MEMBER_PATHS = new Set(['/organization/update-member-role', '/organization/remove-member', '/organization/leave']);
const STATUS = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' } as const;
/** Throws a refused Result as Better Auth's error. */
const refuse = (r: { error: string; status?: number }): never => {
  throw new APIError(r.status && r.status in STATUS ? STATUS[r.status as keyof typeof STATUS] : 'BAD_REQUEST', { message: r.error });
};

// Better Auth's invitation endpoints answer with Brickfolio's (lib/service/invitations.ts), so who may invite, at
// which role, and what accepting needs are the same through either.
const INVITE_PATHS = new Set(['/organization/invite-member', '/organization/cancel-invitation', '/organization/accept-invitation', '/organization/reject-invitation']);

// The admin plugin's endpoints that act on someone else, with the rule they follow (lib/service/people-admin.ts).
const ADMIN_TARGETS: Record<string, people.AdminAct> = { '/admin/ban-user': 'ban', '/admin/remove-user': 'delete', '/admin/impersonate-user': 'impersonate' };
/** How long acting as someone lasts (as the admin plugin's default). */
export const IMPERSONATE_SECONDS = 60 * 60;

/**
 * The /admin/* part of the gate (#102). Only Brickfolio's admins, never while acting as someone else, and nobody
 * bans, deletes or impersonates themselves or an ADMIN_USERS admin. The plugin then also checks `user.role`.
 */
async function adminGate(db: DB, path: string, body: Record<string, unknown>, s: { user: { id: string; email: string }; session: Record<string, unknown> }) {
  const actor = { ...(await perm.accessOf(db, s.user.email)), ...(s.session.impersonatedBy ? { admin: false, impersonated: true } : {}) };
  const what = ADMIN_TARGETS[path] ?? (path === '/admin/update-user' && (body.data as Record<string, unknown> | undefined)?.banned ? 'ban' : undefined);
  const target = what && typeof body.userId === 'string' ? (await db.select({ email: authUser.email }).from(authUser).where(eq(authUser.id, body.userId)).get())?.email : undefined;
  if (what && target) {
    const r = await people.refusal(db, actor, target, what);
    if (r) refuse(r);
  }
  const r = people.adminRefusal(actor);
  if (r) refuse(r);
}

/**
 * Acting as someone (#102), for the server action only (SERVER_ONLY: no route reaches it). The admin plugin's
 * impersonate-user, without its `user.role` check (Brickfolio's admins include ADMIN_USERS) and with Brickfolio's
 * rules: the admin's own session is kept in the plugin's admin_session cookie, so its stop-impersonating brings it back.
 */
const userIdBody: StandardSchemaV1<{ userId: string }> = {
  '~standard': {
    version: 1, vendor: 'brickfolio',
    validate: (v) => (v && typeof (v as { userId?: unknown }).userId === 'string' ? { value: { userId: (v as { userId: string }).userId } } : { issues: [{ message: 'userId is required.' }] }),
  },
};

function brickfolioAdmin(db: DB) {
  return {
    id: 'brickfolio-admin',
    endpoints: {
      brickfolioImpersonate: createAuthEndpoint('/brickfolio/impersonate', { method: 'POST', body: userIdBody, requireHeaders: true, use: [sessionMiddleware], metadata: { SERVER_ONLY: true } }, async (ctx) => {
        const admin = ctx.context.session;
        const target = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
        if (!target) throw new APIError('NOT_FOUND', { message: 'Not found.' });
        const actor = { ...(await perm.accessOf(db, admin.user.email)), ...((admin.session as { impersonatedBy?: string | null }).impersonatedBy ? { admin: false, impersonated: true } : {}) };
        const r = await people.refusal(db, actor, target.email, 'impersonate');
        if (r) refuse(r);
        const session = await ctx.context.internalAdapter.createSession(target.id, true, { impersonatedBy: admin.user.id, expiresAt: new Date(Date.now() + IMPERSONATE_SECONDS * 1000) }, true);
        if (!session) throw new APIError('INTERNAL_SERVER_ERROR', { message: "Couldn't start acting as them." });
        const cookies = ctx.context.authCookies;
        deleteSessionCookie(ctx);
        const dontRemember = await ctx.getSignedCookie(cookies.dontRememberToken.name, ctx.context.secret);
        await ctx.setSignedCookie(ctx.context.createAuthCookie('admin_session').name, `${admin.session.token}:${dontRemember || ''}`, ctx.context.secret, cookies.sessionToken.attributes);
        await setSessionCookie(ctx, { session, user: target }, true);
        return ctx.json({ ok: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}

async function invitationEndpoint(db: DB, path: string, body: Record<string, unknown>, s: { user: { email: string; emailVerified: boolean }; session: Record<string, unknown> }, base?: string) {
  const access = () => perm.resolveAccess(db, { user: s.user.email, via: 'better-auth' });
  if (path === '/organization/invite-member') {
    const org = typeof body.organizationId === 'string' ? body.organizationId : (s.session.activeOrganizationId as string | null | undefined);
    const collectionId = org ? await invites.collectionOfOrg(db, org) : undefined;
    if (collectionId === undefined) throw new APIError('BAD_REQUEST', { message: 'Organization not found.' });
    const role = Array.isArray(body.role) ? (body.role.length === 1 ? body.role[0] : '') : body.role;
    const r = await invites.createInvite(db, await access(), collectionId, body.email, role, { base });
    return r.ok ? (await invites.invitationRow(db, r.id)) ?? null : refuse(r);
  }
  const id = String(body.invitationId ?? '');
  const r = path === '/organization/cancel-invitation' ? await invites.cancelInvite(db, await access(), id)
    : path === '/organization/accept-invitation' ? await invites.acceptInvite(db, s.user, id)
    : await invites.rejectInvite(db, s.user, id);
  if (!r.ok) refuse(r);
  const invitation = await invites.invitationRow(db, id);
  if (path === '/organization/cancel-invitation') return invitation ?? null;
  const member = path === '/organization/accept-invitation' && invitation
    ? (await db.select().from(authMember).innerJoin(authUser, eq(authUser.id, authMember.userId)).where(and(eq(authMember.organizationId, invitation.organizationId), eq(authUser.email, invitation.email))).get())?.member ?? null
    : null;
  return { invitation: invitation ?? null, member };
}

/** The member a member endpoint is about, with its collection and email. */
async function targetMember(db: DB, path: string, body: Record<string, unknown>, userId: string, activeOrg?: string | null) {
  const org = typeof body.organizationId === 'string' ? body.organizationId : activeOrg ?? undefined;
  const q = () => db.select({ id: authMember.id, organizationId: authMember.organizationId, userId: authMember.userId, role: authMember.role, createdAt: authMember.createdAt, email: authUser.email, collectionId: authOrganization.collectionId })
    .from(authMember).innerJoin(authUser, eq(authUser.id, authMember.userId)).innerJoin(authOrganization, eq(authOrganization.id, authMember.organizationId));
  let m;
  if (path === '/organization/leave') m = org ? await q().where(and(eq(authMember.userId, userId), eq(authMember.organizationId, org))).get() : undefined;
  else {
    const key = String((path === '/organization/remove-member' ? body.memberIdOrEmail : body.memberId) ?? '');
    m = key.includes('@')
      ? (org ? await q().where(and(eq(authUser.email, key.toLowerCase()), eq(authMember.organizationId, org))).get() : undefined)
      : await q().where(eq(authMember.id, key)).get();
  }
  return m && (!org || m.organizationId === org) ? m : undefined;
}

export function authOptions(db: DB) {
  return {
    appName: 'Brickfolio',
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(db as never, { provider: 'sqlite', schema: authSchema }),
    emailAndPassword: {
      enabled: true, minPasswordLength: MIN_PASSWORD, revokeSessionsOnPasswordReset: true,
      // No sign-in until the address is verified: by its email link, a reset link, or an admin setting the password.
      requireEmailVerification: true,
      async onPasswordReset({ user }) {
        await db.update(authUser).set({ emailVerified: true }).where(eq(authUser.id, user.id));
      },
      password: { hash: hashPassword, verify: verifyPassword },
      async sendResetPassword({ user, url }) {
        const email = user.email.toLowerCase();
        if (emailConfigured()) return sendAuthEmail('reset-password', { to: user.email, url, name: user.name });
        if (wantLink.has(email)) gotLink.set(email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: true, autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        if (emailConfigured()) await sendAuthEmail('verify-email', { to: user.email, url, name: user.name });
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user: { email: string } & Record<string, unknown>, ctx) {
            // A provider that hasn't verified the address proves nothing: no account from it, not even the first.
            if (viaProvider(ctx) && user.emailVerified !== true) throw new APIError('FORBIDDEN', { code: 'PROVIDER_EMAIL_NOT_VERIFIED', message: "That account's email address isn't verified." });
            const proven = proves(ctx, user);
            const n = Number((await db.select({ n: sql<number>`count(*)` }).from(authUser).all())[0].n);
            // Admin goes to the first account in `after`, atomically: two sign-ups can both get here with n = 0.
            if (n === 0) firstTry.add(user.email.toLowerCase());
            // A pending invitation lets that one address sign up too, once it's proven (provider, link or email check).
            else if (!signupOpen(user.email, process.env, proven) && !(await invites.invitedSignup(db, user.email, process.env, proven))) throw new APIError('BAD_REQUEST', CLOSED);
            // Verified on sign-up: the first account (whoever installs it), and sign-ups that proved the address.
            return { data: { ...user, role: 'user', emailVerified: n === 0 || proven } };
          },
          async after(user: { id: string; email: string; emailVerified?: unknown }, ctx) {
            if (!firstTry.delete(user.email.toLowerCase()) || (await perm.claimFirstAdmin(db, user.id)) || signupOpen(user.email, process.env, proves(ctx, user))) return;
            // Lost the race for the first account while sign-up is closed: as if it had been closed already.
            await db.delete(authUser).where(eq(authUser.id, user.id));
            throw new APIError('BAD_REQUEST', CLOSED);
          },
        },
        delete: {
          // Their roles, invitations, API keys, passkeys and two-factor go too (#102), however they're deleted.
          async before(user: { id: string; email: string }) {
            await people.cleanupPerson(db, user.id, user.email.toLowerCase());
          },
        },
      },
      account: {
        create: {
          // Linking a provider to someone an admin added (or moved over from #50): their address was never proven, so
          // drop whatever else the account had (a password someone else may have set, sessions) before the provider,
          // which verified the address, takes it over. As Better Auth's own magic link does.
          async before(account: { userId: string; providerId: string }, ctx) {
            if (!ctx || account.providerId === 'credential' || !viaProvider(ctx)) return;
            const u = await ctx.context.internalAdapter.findUserById(account.userId);
            if (u && !u.emailVerified) await revokeUnprovenAccountAccess(ctx, u.id);
          },
        },
      },
      session: {
        create: {
          // Someone taken out of ALLOWED_USERS isn't signed in by any method (the app refuses them anyway, lib/auth.ts).
          // Nor is someone banned (#102): the admin plugin checks too, and clears a ban that has ended.
          async before(session: { userId: string }) {
            const u = await db.select({ email: authUser.email, banned: authUser.banned, banExpires: authUser.banExpires }).from(authUser).where(eq(authUser.id, session.userId)).get();
            if (u && !allowed(u.email)) throw new APIError('FORBIDDEN', { code: 'NOT_ALLOWED', message: "You don't have access." });
            if (perm.banActive(u)) throw new APIError('FORBIDDEN', { code: 'BANNED_USER', message: BANNED });
          },
        },
      },
    },
    socialProviders: socialProviders(),
    // Apple returns to the callback with a cross-site form POST.
    ...('apple' in socialProviders() && { trustedOrigins: ['https://appleid.apple.com'] }),
    account: {
      accountLinking: {
        enabled: true,
        // No trustedProviders on purpose. Better Auth links a trusted provider's sign-in to an existing account even
        // when the provider says the address is NOT verified. Without it, a provider sign-in joins an existing account
        // only when that provider reports the address verified (Google's email_verified, GitHub's verified emails,
        // Apple's), and never from one that doesn't, which is the proof we want.
        trustedProviders: [],
        // People an admin added, or moved over from #50, have no verified address; the provider's verification proves
        // it (the account.create hook drops anything unproven first). Different addresses never link.
        requireLocalEmailVerified: false,
        allowDifferentEmails: false,
      },
    },
    hooks: {
      // An emailed sign-in link asks for the two-factor code too, when it's on (lib/magic-link-2fa.ts).
      after: magicLinkTwoFactor,
      before: createAuthMiddleware(async (ctx) => {
        if (!GUARDED.some((p) => ctx.path.startsWith(p)) && !GUARDED_PATHS.has(ctx.path)) return;
        const s = await getSessionFromCtx(ctx);
        if (!s) throw new APIError('UNAUTHORIZED');
        // Stopping brings the admin's own session back: whoever they were acting as may have no rights at all (#102).
        if (ctx.path === '/admin/stop-impersonating') return;
        // The app refuses people taken out of ALLOWED_USERS (lib/auth.ts); so do Better Auth's own endpoints.
        if (!s.user.emailVerified || !allowed(s.user.email)) throw new APIError('FORBIDDEN', { message: "You don't have access." });
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (ctx.path.startsWith('/admin/')) return adminGate(db, ctx.path, body, s);
        if (ctx.path === '/api-key/create' && body.prefix !== undefined && body.prefix !== tokens.PREFIX) throw new APIError('BAD_REQUEST', { message: `API keys start with ${tokens.PREFIX}.` });
        // A copied token's old row goes first, so a rollback can't bring it back (the plugin then deletes the key, if theirs).
        if (ctx.path === '/api-key/delete' && typeof body.keyId === 'string') {
          const k = await db.select({ ref: authApiKey.referenceId }).from(authApiKey).where(eq(authApiKey.id, body.keyId)).get();
          if (k?.ref === s.user.id) await tokens.dropLegacyRow(db, body.keyId);
        }
        if (INVITE_PATHS.has(ctx.path)) return ctx.json(await invitationEndpoint(db, ctx.path, body, s, ctx.request ? new URL(ctx.request.url).origin : undefined));
        if (!MEMBER_PATHS.has(ctx.path)) return;
        const m = await targetMember(db, ctx.path, body, s.user.id, (s.session as { activeOrganizationId?: string | null }).activeOrganizationId);
        if (!m) throw new APIError('BAD_REQUEST', { message: 'Member not found.' });
        const update = ctx.path === '/organization/update-member-role';
        const want = Array.isArray(body.role) ? (body.role.length === 1 ? body.role[0] : '') : body.role;
        const access = await perm.resolveAccess(db, { user: s.user.email, via: 'better-auth' });
        const r = await perm.setRole(db, access, m.collectionId, m.email, update ? (String(want ?? '') as perm.Role) : null);
        if (!r.ok) refuse(r);
        const member = { id: m.id, organizationId: m.organizationId, userId: m.userId, role: update ? String(want) : m.role, createdAt: m.createdAt };
        return ctx.json(ctx.path === '/organization/remove-member' ? { member } : member);
      }),
    },
    plugins: [
      admin({ defaultRole: 'user', adminRoles: ['admin'], bannedUserMessage: BANNED, impersonationSessionDuration: IMPERSONATE_SECONDS }),
      brickfolioAdmin(db),
      organization({
        ac, roles, creatorRole: 'owner',
        // Collections are made, renamed and deleted in Brickfolio (which keeps their organization in step).
        allowUserToCreateOrganization: false, disableOrganizationDeletion: true,
        membershipLimit: perm.MEMBERSHIP_LIMIT, // D1: 100 bound parameters per query
        // Invitations: the endpoints that change them are answered in hooks.before; these keep Better Auth's own
        // reads (get-invitation, list-user-invitations) in step.
        invitationExpiresIn: invites.INVITE_MS / 1000, requireEmailVerificationOnInvitation: true,
        async sendInvitationEmail({ id, email, organization, inviter }) {
          await invites.sendInvitationEmail({ email, url: invites.inviteUrl(id), inviter: inviter.user.email, collection: organization.name });
        },
        schema: { organization: { additionalFields: { collectionId: { type: 'number', required: true, input: true, unique: true } } } },
      }),
      // Brickfolio keys look like `bf_…`; the plugin's default rate limit (10 a day) would break the mobile app.
      // Names up to 60 characters and 8 starting characters kept, as Settings makes them; expiry at most a year.
      apiKey({ defaultPrefix: tokens.PREFIX, rateLimit: { enabled: false }, apiKeyHeaders: ['x-api-key'], maximumNameLength: 60, startingCharactersConfig: { shouldStore: true, charactersLength: 8 }, keyExpiration: { maxExpiresIn: 365 } }),
      // Emailed sign-in links. Following one proves the address. New accounts follow the sign-up rules in the user
      // create hook (so sign-up is "disabled" exactly when signupOpen says so); no link is sent where it couldn't work.
      magicLink({
        expiresIn: 10 * 60, storeToken: 'hashed', // a copied database holds no usable links
        rateLimit: { window: 5 * 60, max: 5 }, // per IP, sending and following together
        async sendMagicLink({ email, url }) {
          if (!emailConfigured()) throw new APIError('BAD_REQUEST', { code: 'EMAIL_NOT_SET_UP', message: "Email isn't set up on this server." });
          const to = email.trim().toLowerCase();
          // Same answer either way, so this says nothing about who has an account.
          if (!allowed(to)) return;
          const known = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, to)).get();
          if (!known && !signupOpen(to, process.env, true) && !(await invites.invitedSignup(db, to, process.env, true)) && (await db.select({ id: authUser.id }).from(authUser).limit(1).get())) return;
          await sendAuthEmail('magic-link', { to, url });
        },
      }),
      passkey(passkeyOptions(db)),
      // TOTP (authenticator apps) and backup codes, kept as one encrypted value per person. No SMS or email codes.
      twoFactor({ issuer: 'Brickfolio' }),
      nextCookies(), // must be last: lets server actions set the session cookie
    ],
  } satisfies BetterAuthOptions;
}

const instances = new WeakMap<object, ReturnType<typeof make>>();
const make = (db: DB) => betterAuth(authOptions(db));

/** The Better Auth instance for this database handle. */
export function getAuth(db: DB) {
  let a = instances.get(db);
  if (!a) instances.set(db, (a = make(db)));
  return a;
}
export type Auth = ReturnType<typeof getAuth>;

const userIdOf = async (db: DB, login: string) => (await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, perm.normLogin(login))).get())?.id;

/**
 * An admin sets someone's password (people added by an admin or moved over from #50 have none). Signs them out. The
 * admin vouches for the address, so it counts as verified. `keepAdmin`: the admin is setting their own password while
 * an admin (by ADMIN_USERS, or because it's unset in a proxy mode): they stay one after switching to better-auth.
 */
export async function setPassword(db: DB, login: string, password: string, opts: { keepAdmin?: boolean } = {}): Promise<Result> {
  const userId = await userIdOf(db, login);
  if (!userId) return { ok: false, status: 404, error: `${login} isn't in People.` };
  if (password.length < MIN_PASSWORD || password.length > 128) return { ok: false, status: 400, error: `A password must be ${MIN_PASSWORD}–128 characters.` };
  const ctx = await getAuth(db).$context;
  const hash = await ctx.password.hash(password);
  if (await ctx.internalAdapter.findCredentialAccount(userId)) await ctx.internalAdapter.updatePassword(userId, hash);
  else await ctx.internalAdapter.createAccount({ userId, providerId: 'credential', accountId: userId, password: hash });
  await db.update(authUser).set({ emailVerified: true, ...(opts.keepAdmin ? { role: 'admin' } : {}) }).where(eq(authUser.id, userId));
  await ctx.internalAdapter.deleteUserSessions(userId);
  return { ok: true };
}

/**
 * A password-reset link for someone, through Better Auth's reset request. With email set up it's mailed and `url` is
 * absent; without, the link comes back to show the admin once (it's a secret: never log it).
 */
export async function resetLink(db: DB, login: string): Promise<Result<{ url?: string }>> {
  const email = perm.normLogin(login);
  if (!(await userIdOf(db, email))) return { ok: false, status: 404, error: `${login} isn't in People.` };
  if (!email.includes('@')) return { ok: false, status: 400, error: `${login} isn't an email address.` };
  const mail = emailConfigured();
  if (!mail) wantLink.add(email);
  try {
    await getAuth(db).api.requestPasswordReset({ body: { email, redirectTo: RESET_PATH } });
    if (mail) return { ok: true };
    const url = gotLink.get(email);
    return url ? { ok: true, url } : { ok: false, status: 409, error: "Couldn't make a reset link." };
  } finally {
    wantLink.delete(email);
    gotLink.delete(email);
  }
}
