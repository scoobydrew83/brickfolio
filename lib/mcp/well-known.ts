// Discovery documents for MCP clients doing OAuth (served from app/.well-known/…). 404 unless OAuth is on.
import { connection } from 'next/server';
import { getDb } from '../db';
import { mcpOAuthOn, protectedResourceMetadata } from './oauth';

const notFound = () => new Response('Not found', { status: 404 });
const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };

/** RFC 8414 authorization server metadata (the issuer is <BETTER_AUTH_URL>/api/auth). */
export async function authServerMetadata(req: Request): Promise<Response> {
  await connection();
  if (!mcpOAuthOn()) return notFound();
  const [{ getAuth }, { oauthProviderAuthServerMetadata }] = await Promise.all([import('../better-auth'), import('@better-auth/oauth-provider')]);
  return oauthProviderAuthServerMetadata(getAuth(await getDb()), { headers: cors })(req);
}

/** RFC 9728 protected resource metadata for /api/mcp. */
export async function resourceMetadata(): Promise<Response> {
  await connection();
  if (!mcpOAuthOn()) return notFound();
  return Response.json(await protectedResourceMetadata(await getDb()), { headers: cors });
}
