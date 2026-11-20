import { api, body, fromResult, HttpError, json } from '@/lib/api';
import { editMinifig, figRows, parseFigInput, removeMinifig, type MinifigRow } from '@/lib/service/minifigs';
import { listLocations } from '@/lib/service/sets';
import { parseScope } from '@/lib/service/collections';
import { can, type Access } from '@/lib/service/permissions';
import { brickMinifig } from '@/lib/session';

type P = { figNo: string };

/**
 * The figure's entry the request means, among the collections `access` can read: `?collection=<id>`, or its only
 * entry there. A figure you can't see is "not found"; one in several of your collections needs `collection` (409).
 */
async function row(req: Request, db: Parameters<typeof figRows>[0], access: Access, figNo: string, pick: 'first' | 'only'): Promise<{ row: MinifigRow; all: MinifigRow[] }> {
  const all = (await figRows(db, figNo)).filter((r) => can(access, { action: 'read', collectionId: r.collectionId }));
  const raw = new URL(req.url).searchParams.get('collection');
  const s = parseScope(raw);
  if (s === null) throw new HttpError(400, 'collection must be a collection id.');
  const hits = s === 'all' ? all : all.filter((r) => r.collectionId === s);
  if (!hits.length) throw new HttpError(404, 'Not found');
  if (pick === 'only' && hits.length > 1) throw new HttpError(409, `${figNo} is in ${hits.length} collections. Say which one (collection).`);
  return { row: hits[0], all };
}

/**
 * GET /api/v1/minifigs/:figNo[?collection=<id>] – one figure, by BrickLink (sw0001) or Rebrickable (fig-000123)
 * number: its entry in that collection, or its first, with `collections` listing the ones you can see it in.
 */
export const GET = api<P>('member', async (req, { db, access, params }) => {
  const { row: m, all } = await row(req, db, access, params.figNo, 'first');
  return json({ minifig: m, collections: all.map((r) => ({ collectionId: r.collectionId, qty: r.qty })) });
});

/** PATCH /api/v1/minifigs/:figNo[?collection=<id>] – change the given fields; `collectionId` in the body moves it. Needs write access to both collections. */
export const PATCH = api<P>('member', async (req, { db, access, params, need, target }) => {
  const { row: m } = await row(req, db, access, params.figNo, 'only');
  need({ action: 'write', collectionId: m.collectionId });
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseFigInput(b, await listLocations(db), true);
  if (!p.ok) return json({ error: p.error }, 400);
  if (p.value.collectionId !== undefined && p.value.collectionId !== m.collectionId) p.value.collectionId = await target(req, p.value.collectionId);
  return fromResult(await editMinifig(db, params.figNo, p.value, brickMinifig(), m.collectionId));
});

/** DELETE /api/v1/minifigs/:figNo[?collection=<id>] – remove one copy (deletes the entry on the last one). Returns { remaining }. */
export const DELETE = api<P>('member', async (req, { db, access, params, need }) => {
  const { row: m } = await row(req, db, access, params.figNo, 'only');
  need({ action: 'write', collectionId: m.collectionId });
  return fromResult(await removeMinifig(db, params.figNo, m.collectionId));
});
