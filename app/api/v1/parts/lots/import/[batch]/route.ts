import { api, fromResult } from '@/lib/api';
import { undoImport } from '@/lib/service/lots';

/** DELETE /api/v1/parts/lots/import/:batch – undo an import. */
export const DELETE = api<{ batch: string }>(async (_req, { db, params }) => fromResult(await undoImport(db, params.batch)));
