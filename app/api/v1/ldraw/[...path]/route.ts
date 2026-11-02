import { api, json } from '@/lib/api';
import { libraryPath, librarySource, readLibraryFile } from '@/lib/ldraw/library';

/** GET /api/v1/ldraw/<path> – one file from the LDraw parts library, for the 3D view. 404 when it isn't there. */
export const GET = api<{ path: string[] }>(async (_req, { params }) => {
  const source = librarySource();
  if (!source) return json({ error: 'No LDraw parts library. Set LDRAW_LIBRARY_DIR or LDRAW_LIBRARY_URL.' }, 404);
  const path = libraryPath(params.path);
  if (!path) return json({ error: 'Not a library file.' }, 400);
  const text = await readLibraryFile(source, path);
  if (text === null) return new Response('Not found', { status: 404 });
  // Library files never change for a given name, so browsers may keep them a day.
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=86400' } });
});
