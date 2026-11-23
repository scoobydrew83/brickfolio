// Two-factor for emailed sign-in links (#90). Better Auth's twoFactor plugin only asks for the code after password
// sign-ins (/sign-in/email, …). A sign-in link proves only that you can read the inbox, so when two-factor is on it
// asks for the code too: the session the link made is dropped and the browser goes to /sign-in/two-factor with the
// same pending-2FA cookie the plugin sets, so the code (or a backup code) finishes the sign-in. A device the person
// marked "don't ask again for 30 days" is trusted here as well, checked the way the plugin checks it.
import { createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';

/** Kept in step with the twoFactor plugin (better-auth/plugins/two-factor/constant). */
const TWO_FACTOR_COOKIE = 'two_factor';
const TRUST_DEVICE_COOKIE = 'trust_device';
const TRUST_DEVICE_MAX_AGE = 30 * 86_400;
const PENDING_MAX_AGE = 600; // the plugin's default twoFactorCookieMaxAge
export const TWO_FACTOR_PATH = '/sign-in/two-factor';

/** HMAC-SHA-256, base64url without padding: how the plugin signs its trusted-device cookie. */
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** Whether this browser holds a valid "don't ask again" cookie for the user. */
async function trusted(ctx: Ctx, userId: string): Promise<boolean> {
  const name = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE, { maxAge: TRUST_DEVICE_MAX_AGE }).name;
  const value = await ctx.getSignedCookie(name, ctx.context.secret);
  const [token, id] = (typeof value === 'string' ? value : '').split('!');
  if (!token || !id || token !== (await hmac(ctx.context.secret, `${userId}!${id}`))) return false;
  const v = await ctx.context.internalAdapter.findVerificationValue(id);
  return !!v && v.value === userId && v.expiresAt > new Date();
}

/** After-hook for /magic-link/verify: swap the new session for a two-factor step when two-factor is on. */
export const magicLinkTwoFactor = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/magic-link/verify') return;
  const data = ctx.context.newSession as { user: { id: string; twoFactorEnabled?: boolean | null }; session: { token: string } } | null;
  if (!data?.user.twoFactorEnabled || (await trusted(ctx, data.user.id))) return;
  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(data.session.token);
  ctx.context.setNewSession(null);
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE, { maxAge: PENDING_MAX_AGE });
  const identifier = `2fa-${generateRandomString(20)}`;
  const expiresAt = new Date(Date.now() + PENDING_MAX_AGE * 1000);
  await ctx.context.internalAdapter.createVerificationValue({ value: data.user.id, identifier, expiresAt });
  await ctx.context.internalAdapter.createVerificationValue({ value: '0', identifier: `2fa-attempts-${identifier}`, expiresAt });
  await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
  throw ctx.redirect(TWO_FACTOR_PATH);
});
