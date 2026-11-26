// MCP endpoint (Streamable HTTP, stateless, JSON responses). Same sign-in as the REST API: an API token from
// Settings → API tokens as `Authorization: Bearer <token>`, or the browser's own access (Tailscale, Cloudflare Access).
// With AUTH_MODE=better-auth, MCP clients can also sign in with OAuth (lib/mcp/oauth.ts); their tokens carry the
// approving person's roles, and only tokens with the mcp:write scope see the write tools.
// Read-only unless MCP_WRITE=on (lib/mcp/write-tools.ts); the write tools refuse in demo mode.
import { apiToken, crossSite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { handleRpc } from '@/lib/mcp/server';
import { apiUser } from '@/lib/session';
import { oauthGrant, wwwAuthenticate, MCP_WRITE_SCOPE } from '@/lib/mcp/oauth';
import { can, denied, resolveAccess } from '@/lib/service/permissions';

const headers = { 'Cache-Control': 'no-store' };

export async function POST(req: Request) {
  // Browsers on other sites must not reach this with the user's ambient identity (DNS rebinding, CSRF).
  if (!apiToken(req.headers) && crossSite(req.headers)) return Response.json({ error: 'Cross-site request blocked. Use an API token.' }, { status: 403, headers });
  const db = await getDb();
  // An API token (or the browser's own access) first; else an OAuth access token from an MCP client.
  let user = await apiUser(req);
  let write = true;
  if (!user) {
    const grant = await oauthGrant(db, req);
    if (grant instanceof Response) return grant;
    if (grant) { user = grant.identity; write = grant.scopes.includes(MCP_WRITE_SCOPE); }
  }
  if (!user) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized. Send Authorization: Bearer <api token> (Settings → API tokens), or sign in with OAuth.' } }, { status: 401, headers: { ...headers, 'WWW-Authenticate': wwwAuthenticate() } });
  }
  // Tools answer only from the collections this person can see (#50); someone with none gets nothing.
  const access = await resolveAccess(db, user);
  if (!can(access, 'member')) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: denied('member') } }, { status: 403, headers });
  const msg = await req.json().catch(() => undefined);
  if (msg === undefined) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers });
  if (Array.isArray(msg)) { // JSON-RPC batch (protocol 2025-03-26 and earlier)
    const out = (await Promise.all(msg.map((m) => handleRpc(db, m, access, { write })))).filter(Boolean);
    return out.length ? Response.json(out, { headers }) : new Response(null, { status: 202, headers });
  }
  const out = await handleRpc(db, msg, access, { write });
  return out ? Response.json(out, { headers }) : new Response(null, { status: 202, headers });
}

/** No server-sent event stream: this server never sends requests or notifications of its own. */
export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { ...headers, Allow: 'POST' } });
}
export const DELETE = GET;
