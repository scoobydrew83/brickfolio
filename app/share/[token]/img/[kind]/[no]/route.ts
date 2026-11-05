import { getDb } from '@/lib/db';
import { imageStore } from '@/lib/images/cache';
import { cachedImage, imageResponse, isImageKind } from '@/lib/service/images';
import { checkShareLink, sharesItem } from '@/lib/service/share';

const notFound = () => new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** A photo on a share page: only for a valid link, and only for an item that link shows. Doesn't count as a view. */
export async function GET(_req: Request, ctx: RouteContext<'/share/[token]/img/[kind]/[no]'>) {
  const { token, kind, no: raw } = await ctx.params;
  if (!isImageKind(kind)) return notFound();
  const db = await getDb();
  const link = await checkShareLink(db, decodeURIComponent(token), new Date(), { count: false });
  const no = decodeURIComponent(raw);
  if (!link || !(await sharesItem(db, link, kind, no))) return notFound();
  return imageResponse(await cachedImage(db, await imageStore(), kind, no));
}
