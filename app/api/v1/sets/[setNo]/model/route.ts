import { api, fromResult, json } from '@/lib/api';
import { readable, setCollections, setRefusal } from '@/lib/service/permissions';
import { getModel, removeModel, saveModel } from '@/lib/service/models';
import { getSet } from '@/lib/service/sets';
import { setNo } from '@/lib/sets';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo/model – the set's LDraw model as text (404 when none). */
export const GET = api<P>('member', async (_req, { db, access, params }) => {
  const s = await getSet(db, setNo(params.setNo), { collectionId: readable(access) });
  const m = s && (await getModel(db, s.id));
  if (!m) return json({ error: 'No model for this set.' }, 404);
  return new Response(m.content, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `inline; filename="${m.fileName.replace(/"/g, '')}"`, 'Cache-Control': 'no-store' } });
});

/** PUT /api/v1/sets/:setNo/model?name=file.mpd – upload or replace the model (body: the file's text, ≤ 2 MB). */
export const PUT = api<P>('member', async (req, { db, access, params }) => {
  // The model is shared by every copy: changing it needs write access to at least one collection with a copy (#50).
  const no = setNo(params.setNo);
  const refused = setRefusal(access, await setCollections(db, no), false);
  if (refused) return fromResult(refused);
  const name = new URL(req.url).searchParams.get('name') || 'model.mpd';
  return fromResult(await saveModel(db, no, name, await req.text()));
});

/** DELETE /api/v1/sets/:setNo/model – remove the model. */
export const DELETE = api<P>('member', async (_req, { db, access, params }) => {
  const no = setNo(params.setNo);
  return fromResult(setRefusal(access, await setCollections(db, no), false) ?? await removeModel(db, no));
});
