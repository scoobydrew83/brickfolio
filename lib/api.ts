// Helpers for the REST API route handlers (app/api/v1). JSON in, JSON out, errors as { error }.
import 'server-only';
import { apiToken, crossSite, type Identity } from './auth';
import { getDb, type DB } from './db';
import { getSet, type Result } from './service/sets';
import { apiUser } from './session';
import { DEMO_ERROR, demoBlocks } from './demo';
import { can, clampScope, denied, readable, resolveAccess, type Access, type Need } from './service/permissions';
import type { ReadScope } from './service/collections';

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export const fromResult = (r: Result<object>, okStatus = 200) => {
  if (r.ok) { const { ok: _, ...rest } = r; return json(rest, okStatus); }
  return json({ error: r.error, ...(r.existing ? { existing: r.existing } : {}) }, r.status ?? 400);
};

/**
 * fromResult for a change that answers with the set (#50): the set is read again with only the copies `access` can
 * see, so a change by someone with one collection doesn't show the copies, values and notes in the others.
 */
export async function setResult(db: DB, access: Access, r: Result<object>, okStatus = 200) {
  const set = r.ok && 'set' in r ? (r.set as { setNo?: string } | null) : null;
  if (!r.ok || access.admin || !set?.setNo) return fromResult(r, okStatus);
  return fromResult({ ...r, set: (await getSet(db, set.setNo, { collectionId: readable(access) })) ?? null } as Result<object>, okStatus);
}

/** Thrown by request helpers to answer with a specific status. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** What a route needs before its handler runs (#50). `signed-in`: anyone allowed in, even with no collections. */
export type RouteNeed = 'signed-in' | 'member' | 'shared' | 'admin';

export type Ctx<C> = {
  db: DB; user: Identity; access: Access; params: C;
  /** Throws 403 unless the user may do `need` (a collection-level check inside the handler). */
  need(need: Need): void;
  /** `?collection=` cut down to what the user may read: an id, their collections, or everything (admins). */
  scope(req: Request): Promise<ReadScope>;
  /** Where something new goes: `?collection=` or the given id when the user can add to it, else their default. 403 when none. */
  target(req: Request, given?: unknown): Promise<number>;
};

/**
 * Wraps a handler with auth, permissions (#50), CSRF protection, a database and error handling. Every route says
 * what it needs (`member` to read, `shared` to change shared lists, `admin` for settings); collection checks happen
 * inside with `ctx.need`. Writes that rely on the browser's ambient identity (no bearer token) must come from this
 * site; API tokens aren't sent automatically, so they're exempt.
 */
export function api<C>(routeNeed: RouteNeed, fn: (req: Request, ctx: Ctx<C>) => Promise<Response>) {
  return async (req: Request, route: { params: Promise<C> }) => {
    if (demoBlocks(req.method)) return json({ error: DEMO_ERROR }, 403);
    if (req.method !== 'GET' && req.method !== 'HEAD' && !apiToken(req.headers) && crossSite(req.headers)) {
      return json({ error: 'Cross-site request blocked. Use an API token for requests from other sites.' }, 403);
    }
    const user = await apiUser(req);
    if (!user) return json({ error: 'Unauthorized. Send Authorization: Bearer <api token>.' }, 401);
    try {
      const db = await getDb();
      const access = await resolveAccess(db, user);
      if (routeNeed !== 'signed-in' && !can(access, routeNeed)) return json({ error: denied(routeNeed) }, 403);
      const ctx: Ctx<C> = {
        db, user, access, params: await route.params,
        need(n) { if (!can(access, n)) throw new HttpError(403, denied(n)); },
        scope: (r) => scopeOf(r, db, access),
        async target(r, given) {
          const raw = given ?? new URL(r.url).searchParams.get('collection');
          const { parseScope, collectionExists, listCollections } = await import('./service/collections');
          const s = given === undefined || given === null || given === '' ? parseScope(raw) : parseScope(String(given));
          if (s === null) throw new HttpError(400, 'collection must be a collection id.');
          if (s !== 'all') {
            if (!(await collectionExists(db, s))) throw new HttpError(400, `Collection ${s} doesn't exist.`);
            if (!can(access, { action: 'write', collectionId: s })) throw new HttpError(403, denied({ action: 'write', collectionId: s }));
            return s;
          }
          const first = (await listCollections(db)).find((c) => can(access, { action: 'write', collectionId: c.id }));
          if (!first) throw new HttpError(403, denied({ action: 'write', collectionId: 0 }));
          return first.id;
        },
      };
      return await fn(req, ctx);
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

/** BrickLink XML request body. Rejects other Content-Types with 415. */
export const xmlBody = async (req: Request): Promise<string> => {
  const t = mediaType(req);
  if (t !== 'application/xml' && t !== 'text/xml') throw new HttpError(415, 'Send the file with Content-Type: application/xml.');
  return req.text();
};

/**
 * A parts file: BrickLink XML (application/xml, text/xml) or a Rebrickable CSV (text/csv), told apart by Content-Type.
 * Other types get 415, and bodies over 5 MB get 413.
 */
export async function partsFileBody(req: Request): Promise<{ kind: 'bricklink_xml' | 'rebrickable_csv'; text: string }> {
  const t = mediaType(req);
  const kind = t === 'text/csv' ? 'rebrickable_csv' as const : t === 'application/xml' || t === 'text/xml' ? 'bricklink_xml' as const : null;
  if (!kind) throw new HttpError(415, 'Send BrickLink XML as application/xml, or a Rebrickable CSV as text/csv.');
  if (Number(req.headers.get('content-length') ?? 0) > 5_000_000) throw new HttpError(413, 'The file is over 5 MB.');
  const text = kind === 'bricklink_xml' ? await xmlBody(req) : await csvBody(req);
  if (text.length > 5_000_000) throw new HttpError(413, 'The file is over 5 MB.');
  return { kind, text };
}

/**
 * The `?collection=` query parameter (#49): a collection id or `all` (the default), cut down to what `access` may read
 * (#50). A malformed or unknown id throws a 400, one the user can't read a 403, so routes can use it inline.
 */
export async function scopeOf(req: Request, db: DB, access: Access): Promise<ReadScope> {
  const { checkScope } = await import('./service/collections');
  const r = await checkScope(db, new URL(req.url).searchParams.get('collection'));
  if (!r.ok) throw new HttpError(400, r.error);
  const s = clampScope(access, r.scope);
  if (s === null) throw new HttpError(403, denied({ action: 'read', collectionId: r.scope as number }));
  return s;
}
