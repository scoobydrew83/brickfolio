import { api, fromResult, partsFileBody } from '@/lib/api';
import { setBuildParts } from '@/lib/service/builds';
import { rebrickable } from '@/lib/session';

/** PUT /api/v1/builds/:mocNo/parts – replace a MOC's or your own build's parts list: BrickLink XML or a Rebrickable CSV. */
export const PUT = api<{ mocNo: string }>(async (req, { db, params }) => {
  const { kind, text } = await partsFileBody(req);
  return fromResult(await setBuildParts(db, params.mocNo, kind, text, rebrickable()));
});
