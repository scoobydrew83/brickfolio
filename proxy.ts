// Blocks browser requests from anyone the auth mode doesn't recognize (see lib/auth.ts).
// The REST API (/api/v1) checks its own auth so it can also accept API tokens, and every server action
// checks the user again, so this is the first line, not the only one.
import { NextResponse, type NextRequest } from 'next/server';
import { identify, isPublicShareRequest, isSharePath } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  // Share pages are public and read-only: no login, and nothing but GET/HEAD (so no server action runs there).
  if (isPublicShareRequest(request.nextUrl.pathname, request.method)) {
    const res = NextResponse.next();
    res.headers.set('Referrer-Policy', 'no-referrer'); // the token is in the URL: don't send it to BrickLink or anyone else
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
  }
  if (isSharePath(request.nextUrl.pathname)) return new NextResponse('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (await identify(request.headers)) return NextResponse.next();
  return new NextResponse('Not signed in. This app only accepts requests through Tailscale or Cloudflare Access.', { status: 401 });
}

export const config = {
  // Not static files, image optimization, icons, the health check or the REST API.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|api/).*)'],
};
