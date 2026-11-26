// OAuth for MCP clients (AUTH_MODE=better-auth): Claude and other clients register themselves, send the person to
// /sign-in and /oauth/consent, and get a short-lived JWT bound to /api/mcp (lib/better-auth.ts → oauthProvider). This
// checks those tokens in-process (no HTTP round trip, so it works on Workers) and maps them to the person who
// approved, whose roles then apply exactly as in the app. API tokens keep working beside it.
import 'server-only';
import { eq } from 'drizzle-orm';
import { allowed, authMode, type Identity } from '../auth';
import { authUser } from '../db/schema';
import type { DB } from '../db/types';

export const MCP_READ = 'mcp:read';
export const MCP_WRITE_SCOPE = 'mcp:write';

/** OAuth for MCP is on with Better Auth sign-in and a BETTER_AUTH_URL (the issuer and the tokens' audience). */
export const mcpOAuthOn = (env: Record<string, string | undefined> = process.env) => authMode() === 'better-auth' && !!env.BETTER_AUTH_URL;

const base = (env: Record<string, string | undefined> = process.env) => (env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '');
/** Where MCP clients find out how to get a token (RFC 9728, path-inserted for /api/mcp). */
export const resourceMetadataUrl = (env: Record<string, string | undefined> = process.env) => `${base(env)}/.well-known/oauth-protected-resource/api/mcp`;

/** The 401 header for /api/mcp: with OAuth on, it points clients at the metadata so they can sign in. */
export const wwwAuthenticate = () => (mcpOAuthOn() ? `Bearer resource_metadata="${resourceMetadataUrl()}"` : 'Bearer');

/** RFC 9728 protected-resource metadata for /api/mcp. */
export async function protectedResourceMetadata(db: DB): Promise<Record<string, unknown>> {
  const [{ getAuth, mcpResource }, { oauthProviderResourceClient }] = await Promise.all([import('../better-auth'), import('@better-auth/oauth-provider/resource-client')]);
  const rc = oauthProviderResourceClient(getAuth(db)).getActions();
  return await rc.getProtectedResourceMetadata({ resource: mcpResource(), scopes_supported: [MCP_READ, MCP_WRITE_SCOPE], resource_name: 'Brickfolio MCP' } as never) as unknown as Record<string, unknown>;
}

export type McpGrant = { identity: Identity; scopes: string[] };

/**
 * The person and scopes behind an OAuth access token on this request, or a Response to send instead (401 with a
 * challenge for a bad or expired token, 403 for someone no longer allowed in). Null when there's no bearer token.
 */
export async function oauthGrant(db: DB, req: Request): Promise<McpGrant | Response | null> {
  if (!mcpOAuthOn() || !/^bearer\s+/i.test(req.headers.get('authorization') ?? '')) return null;
  const [{ getAuth, mcpResource }, { oauthProviderResourceClient }] = await Promise.all([import('../better-auth'), import('@better-auth/oauth-provider/resource-client')]);
  const rc = oauthProviderResourceClient(getAuth(db)).getActions();
  let payload: { sub?: string; scope?: string };
  try {
    payload = await rc.verifyAccessTokenRequest(req, { verifyOptions: { audience: mcpResource() }, requiredScopes: [MCP_READ] } as never) as { sub?: string; scope?: string };
  } catch (e) {
    const err = e as { statusCode?: number; status?: number; headers?: HeadersInit; message?: string; body?: { message?: string } };
    const status = err.statusCode ?? (typeof err.status === 'number' ? err.status : 401);
    const headers = new Headers(err.headers);
    if (!headers.has('WWW-Authenticate')) headers.set('WWW-Authenticate', `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl()}"`);
    headers.set('Cache-Control', 'no-store');
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: err.body?.message ?? err.message ?? 'Invalid access token.' } }, { status, headers });
  }
  const u = payload.sub ? await db.select({ email: authUser.email, verified: authUser.emailVerified, banned: authUser.banned }).from(authUser).where(eq(authUser.id, payload.sub)).get() : undefined;
  const email = u?.email.toLowerCase();
  if (!u || !email || !u.verified || u.banned || !allowed(email)) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'The person who approved this client can no longer sign in.' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  return { identity: { user: email, via: 'better-auth' }, scopes: (payload.scope ?? '').split(/\s+/).filter(Boolean) };
}
