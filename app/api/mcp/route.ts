// MCP endpoint (Streamable HTTP, stateless, JSON responses). Same sign-in as the REST API: an API token from
// Settings → API tokens as `Authorization: Bearer <token>`, or the browser's own access (Tailscale, Cloudflare Access).
// Read-only, so it also works in demo mode.
import { crossSite, bearer } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { handleRpc } from '@/lib/mcp/server';
import { apiUser } from '@/lib/session';

const headers = { 'Cache-Control': 'no-store' };

export async function POST(req: Request) {
  // Browsers on other sites must not reach this with the user's ambient identity (DNS rebinding, CSRF).
  if (!bearer(req.headers) && crossSite(req.headers)) return Response.json({ error: 'Cross-site request blocked. Use an API token.' }, { status: 403, headers });
  if (!(await apiUser(req))) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized. Send Authorization: Bearer <api token> (Settings → API tokens).' } }, { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' } });
  }
  const msg = await req.json().catch(() => undefined);
  if (msg === undefined) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers });
  const db = await getDb();
  if (Array.isArray(msg)) { // JSON-RPC batch (protocol 2025-03-26 and earlier)
    const out = (await Promise.all(msg.map((m) => handleRpc(db, m)))).filter(Boolean);
    return out.length ? Response.json(out, { headers }) : new Response(null, { status: 202, headers });
  }
  const out = await handleRpc(db, msg);
  return out ? Response.json(out, { headers }) : new Response(null, { status: 202, headers });
}

/** No server-sent event stream: this server never sends requests or notifications of its own. */
export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { ...headers, Allow: 'POST' } });
}
export const DELETE = GET;
