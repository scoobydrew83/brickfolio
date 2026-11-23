// Better Auth's endpoints (#90): sign-up, sign-in, sign-out, sessions, and its admin/organization/API key plugins.
// Only with AUTH_MODE=better-auth; otherwise they don't exist.
import { toNextJsHandler } from 'better-auth/next-js';
import { authMode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getAuth } from '@/lib/better-auth';

const handle = (method: 'GET' | 'POST') => async (req: Request) => {
  if (authMode() !== 'better-auth') return Response.json({ error: 'Not found.' }, { status: 404 });
  return toNextJsHandler(getAuth(await getDb()))[method](req);
};
export const GET = handle('GET');
export const POST = handle('POST');
