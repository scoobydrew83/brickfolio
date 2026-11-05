import { api, body, fromResult, json } from '@/lib/api';
import { refreshEstValues } from '@/lib/service/copies';
import { primarySource, setPrimarySource, valueSources } from '@/lib/service/prices';

/** GET /api/v1/settings/value-source – the source Est. Value comes from, and the ones that can be chosen. */
export const GET = api(async (_req, { db }) => json({ source: await primarySource(db), options: await valueSources(db) }));

/** PUT /api/v1/settings/value-source – choose it ({ source }); every set is re-valued at once. */
export const PUT = api(async (req, { db }) => fromResult(await setPrimarySource(db, (await body(req))?.source, refreshEstValues)));
