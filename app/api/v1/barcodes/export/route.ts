import { api, json } from '@/lib/api';
import { shareable } from '@/lib/barcode/community';

/**
 * GET /api/v1/barcodes/export – your own confirmed barcodes and minifigure box codes in the community list's format
 * (CC0), for sharing. Only codes and set or figure names; nothing else from the collection.
 */
export const GET = api(async (_req, { db }) => json(await shareable(db)));
