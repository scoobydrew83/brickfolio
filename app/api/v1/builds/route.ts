import { api, body, fromResult, json } from '@/lib/api';
import { addBuild, buildMatches, parseBuildInput, type BuildKind } from '@/lib/service/builds';
import { rebrickable } from '@/lib/session';

const KINDS: BuildKind[] = ['alternate', 'moc', 'custom'];

/** GET /api/v1/builds[?set=31120][&kind=alternate|moc|custom] – builds and how much of each you can make. */
export const GET = api(async (req, { db }) => {
  const p = new URL(req.url).searchParams;
  const kind = p.get('kind');
  if (kind && !KINDS.includes(kind as BuildKind)) return json({ error: `kind must be one of: ${KINDS.join(', ')}.` }, 400);
  return json({ builds: await buildMatches(db, { sourceSetNo: p.get('set') ?? undefined, kind: (kind as BuildKind) || undefined }) });
});

/** POST /api/v1/builds – { kind: 'moc', mocNo } (parts come with the next sync) or { kind: 'custom', name }. */
export const POST = api(async (req, { db }) => {
  const p = parseBuildInput(await body(req));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await addBuild(db, p.value, rebrickable()), 201);
});
