// Who is making this request? Set AUTH_MODE to match how the app is exposed:
//   none              – no login (local use only)
//   tailscale         – behind `tailscale serve`, which adds the Tailscale-User-Login header
//   cloudflare-access – behind Cloudflare Access, which adds a signed Cf-Access-Jwt-Assertion header
// In every mode, the REST API also accepts `Authorization: Bearer <api token>` (Settings → API tokens).
// ALLOWED_USERS (comma-separated logins/emails) narrows tailscale and cloudflare-access to those users.
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type AuthMode = 'none' | 'tailscale' | 'cloudflare-access';
export type Identity = { user: string; via: AuthMode | 'token' | 'cron' };

export const authMode = (): AuthMode => {
  const m = process.env.AUTH_MODE || 'none';
  if (m !== 'none' && m !== 'tailscale' && m !== 'cloudflare-access') throw new Error(`Unknown AUTH_MODE: ${m}`);
  return m;
};

const allowed = (user: string) => {
  const list = (process.env.ALLOWED_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(user.toLowerCase());
};

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
async function verifyAccess(jwt: string): Promise<string | null> {
  const team = process.env.CF_ACCESS_TEAM_DOMAIN; // e.g. myteam.cloudflareaccess.com
  const aud = process.env.CF_ACCESS_AUD;
  if (!team || !aud) throw new Error('CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set for AUTH_MODE=cloudflare-access');
  jwks ??= createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
  try {
    const { payload } = await jwtVerify(jwt, jwks, { issuer: `https://${team}`, audience: aud });
    return typeof payload.email === 'string' ? payload.email : typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Identity from the proxy headers (browser requests). Does not check API tokens; see identifyApi. */
export async function identify(h: Headers): Promise<Identity | null> {
  const mode = authMode();
  if (mode === 'none') return { user: 'local', via: 'none' };
  if (mode === 'tailscale') {
    const user = h.get('tailscale-user-login');
    return user && allowed(user) ? { user, via: 'tailscale' } : null;
  }
  const jwt = h.get('cf-access-jwt-assertion');
  const user = jwt ? await verifyAccess(jwt) : null;
  return user && allowed(user) ? { user, via: 'cloudflare-access' } : null;
}

/**
 * Requests that skip login: GET and HEAD of a read-only share page (/share/<token>/…). The page checks its own token.
 * Anything else under /share (a POST, including a server action's) is refused by the proxy with 405.
 */
export function isPublicShareRequest(pathname: string, method: string): boolean {
  return isSharePath(pathname) && (method === 'GET' || method === 'HEAD');
}
export const isSharePath = (pathname: string) => pathname === '/share' || pathname.startsWith('/share/');

/** Bearer token from the Authorization header, if any. */
export const bearer = (h: Headers) => h.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

/**
 * True when a browser says the request came from another site. Used to block CSRF on API writes that rely on
 * ambient identity (Tailscale header, Access cookie, or no auth), which a malicious page could otherwise ride.
 * Requests with no Origin and no Sec-Fetch-Site (curl, scripts) count as same-site.
 */
export function crossSite(h: Headers): boolean {
  const site = h.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return true;
  const origin = h.get('origin');
  if (!origin) return false;
  let host: string;
  try { host = new URL(origin).host; } catch { return true; } // includes Origin: null
  const expected = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim().toLowerCase();
  return host.toLowerCase() !== expected;
}
