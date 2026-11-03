import { api, json } from '@/lib/api';
import { ensureCommunity } from '@/lib/barcode/community';
import { offlineMap } from '@/lib/barcode/resolve';
import { isDemo } from '@/lib/demo';

/**
 * GET /api/v1/barcodes/offline – every saved barcode (the ones a scan would trust) with what you own and want, so
 * the scanner can identify boxes without a connection. The scan page keeps a copy on the device.
 */
export const GET = api(async (_req, { db }) => {
  if (!isDemo()) await ensureCommunity(db);
  return json(await offlineMap(db));
});
