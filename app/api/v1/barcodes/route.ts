import { api, json } from '@/lib/api';
import { barcodeStats } from '@/lib/barcode/resolve';
import { barcodeCaps } from '@/lib/session';

/** GET /api/v1/barcodes – which barcode lookups are on (no keys), and how many barcodes are saved. */
export const GET = api(async (_req, { db }) => json({ ...barcodeCaps(), saved: await barcodeStats(db) }));
