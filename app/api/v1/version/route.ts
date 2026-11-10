import { api, json } from '@/lib/api';
import { checkForUpdate } from '@/lib/service/updates';

/** GET /api/v1/version – the running version and, unless UPDATE_CHECK=off, the latest release (checked at most daily). */
export const GET = api(async (_req, { db }) => json(await checkForUpdate(db)));
