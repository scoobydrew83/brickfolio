import { api, body, fromResult, json } from '@/lib/api';
import { deleteCollection, renameCollection, reorderCollections } from '@/lib/service/collections';

type P = { id: string };
const idOf = (raw: string) => (/^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null);

/** PATCH /api/v1/collections/:id – { name } renames it; { position } (0-based) moves it in the list. */
export const PATCH = api<P>('admin', async (req, { db, params }) => {
  const id = idOf(params.id);
  if (id === null) return json({ error: 'Not found.' }, 404);
  const b = (await body(req)) ?? {};
  if (b.name !== undefined) {
    const r = await renameCollection(db, id, b.name);
    if (!r.ok) return fromResult(r);
  }
  if (b.position !== undefined) {
    const { listCollections } = await import('@/lib/service/collections');
    const ids = (await listCollections(db)).map((c) => c.id).filter((x) => x !== id);
    const at = Math.max(0, Math.min(ids.length, Math.floor(Number(b.position)) || 0));
    ids.splice(at, 0, id);
    const r = await reorderCollections(db, ids);
    if (!r.ok) return fromResult(r);
  }
  return json({ ok: true });
});

/** DELETE /api/v1/collections/:id – deletes an empty collection (409 while it holds copies, minifigures or share links). */
export const DELETE = api<P>('admin', async (_req, { db, params }) => {
  const id = idOf(params.id);
  return id === null ? json({ error: 'Not found.' }, 404) : fromResult(await deleteCollection(db, id));
});
