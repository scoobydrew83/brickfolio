import { api, fromResult, json } from '@/lib/api';
import { getModel, removeModel, saveModel } from '@/lib/service/models';
import { getSet } from '@/lib/service/sets';
import { setNo } from '@/lib/sets';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo/model – the set's LDraw model as text (404 when none). */
export const GET = api<P>(async (_req, { db, params }) => {
  const s = await getSet(db, setNo(params.setNo));
  const m = s && (await getModel(db, s.id));
  if (!m) return json({ error: 'No model for this set.' }, 404);
  return new Response(m.content, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `inline; filename="${m.fileName.replace(/"/g, '')}"`, 'Cache-Control': 'no-store' } });
});

/** PUT /api/v1/sets/:setNo/model?name=file.mpd – upload or replace the model (body: the file's text, ≤ 2 MB). */
export const PUT = api<P>(async (req, { db, params }) => {
  const name = new URL(req.url).searchParams.get('name') || 'model.mpd';
  return fromResult(await saveModel(db, setNo(params.setNo), name, await req.text()));
});

/** DELETE /api/v1/sets/:setNo/model – remove the model. */
export const DELETE = api<P>(async (_req, { db, params }) => fromResult(await removeModel(db, setNo(params.setNo))));
