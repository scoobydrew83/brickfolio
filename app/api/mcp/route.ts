// MCP endpoint (Streamable HTTP, stateless, JSON responses). Same sign-in as the REST API: an API token from
// Settings → API tokens as `Authorization: Bearer <token>`, or the browser's own access (Tailscale, Cloudflare Access).
// Read-only, so it also works in demo mode.
import { apiToken, crossSite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { handleRpc } from '@/lib/mcp/server';
import { apiUser } from '@/lib/session';
import { can, denied, resolveAccess } from '@/lib/service/permissions';

const headers = { 'Cache-Control': 'no-store' };

export async function POST(req: Request) {
  // Browsers on other sites must not reach this with the user's ambient identity (DNS rebinding, CSRF).
  if (!apiToken(req.headers) && crossSite(req.headers)) return Response.json({ error: 'Cross-site request blocked. Use an API token.' }, { status: 403, headers });
  const user = await apiUser(req);
  if (!user) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized. Send Authorization: Bearer <api token> (Settings → API tokens).' } }, { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' } });
  }
  const db = await getDb();
  // Tools answer only from the collections this person can see (#50); someone with none gets nothing.
  const access = await resolveAccess(db, user);
  if (!can(access, 'member')) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: denied('member') } }, { status: 403, headers });
  const msg = await req.json().catch(() => undefined);
  if (msg === undefined) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers });
  if (Array.isArray(msg)) { // JSON-RPC batch (protocol 2025-03-26 and earlier)
    const out = (await Promise.all(msg.map((m) => handleRpc(db, m, access)))).filter(Boolean);
    return out.length ? Response.json(out, { headers }) : new Response(null, { status: 202, headers });
  }
  const out = await handleRpc(db, msg, access);
  return out ? Response.json(out, { headers }) : new Response(null, { status: 202, headers });
}

/** No server-sent event stream: this server never sends requests or notifications of its own. */
export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { ...headers, Allow: 'POST' } });
}
export const DELETE = GET;
