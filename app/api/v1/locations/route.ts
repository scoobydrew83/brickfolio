import { api, body, fromResult, json } from '@/lib/api';
import { addLocation, listLocations } from '@/lib/service/sets';

/** GET /api/v1/locations – the location list, in display order. */
export const GET = api(async (_req, { db }) => json({ locations: await listLocations(db) }));

/** POST /api/v1/locations – { name } adds a location. */
export const POST = api(async (req, { db }) => fromResult(await addLocation(db, (await body(req))?.name), 201));
