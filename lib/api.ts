// Helpers for the REST API route handlers (app/api/v1). JSON in, JSON out, errors as { error }.
import 'server-only';
import { bearer, crossSite, type Identity } from './auth';
import { getDb, type DB } from './db';
import type { Result } from './service/sets';
import { apiUser } from './session';
import { DEMO_ERROR, demoBlocks } from './demo';

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export const fromResult = (r: Result<object>, okStatus = 200) => {
  if (r.ok) { const { ok: _, ...rest } = r; return json(rest, okStatus); }
  return json({ error: r.error, ...(r.existing ? { existing: r.existing } : {}) }, r.status ?? 400);
};

/** Thrown by request helpers to answer with a specific status. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Wraps a handler with auth, CSRF protection, a database and error handling. Writes that rely on the browser's
 * ambient identity (no bearer token) must come from this site; API tokens aren't sent automatically, so they're exempt.
 */
export function api<C>(fn: (req: Request, ctx: { db: DB; user: Identity; params: C }) => Promise<Response>) {
  return async (req: Request, route: { params: Promise<C> }) => {
    if (demoBlocks(req.method)) return json({ error: DEMO_ERROR }, 403);
    if (req.method !== 'GET' && req.method !== 'HEAD' && !bearer(req.headers) && crossSite(req.headers)) {
      return json({ error: 'Cross-site request blocked. Use an API token for requests from other sites.' }, 403);
    }
    const user = await apiUser(req);
    if (!user) return json({ error: 'Unauthorized. Send Authorization: Bearer <api token>.' }, 401);
    try {
      return await fn(req, { db: await getDb(), user, params: await route.params });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  };
}

/** Content-Type without parameters, lowercased. */
const mediaType = (req: Request) => (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

/** Request body as an object, or null if it isn't valid JSON. Rejects other Content-Types with 415. */
export const body = async (req: Request): Promise<Record<string, unknown> | null> => {
  if (mediaType(req) !== 'application/json') throw new HttpError(415, 'Send the body as JSON with Content-Type: application/json.');
  const b = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
};

/** CSV request body. Rejects other Content-Types with 415 (text/csv also can't be sent cross-site without a preflight). */
export const csvBody = async (req: Request): Promise<string> => {
  if (mediaType(req) !== 'text/csv') throw new HttpError(415, 'Send the file with Content-Type: text/csv.');
  return req.text();
};
