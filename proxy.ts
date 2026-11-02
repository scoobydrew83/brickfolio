// Blocks browser requests from anyone the auth mode doesn't recognize (see lib/auth.ts).
// The REST API (/api/v1) checks its own auth so it can also accept API tokens, and every server action
// checks the user again, so this is the first line, not the only one.
import { NextResponse, type NextRequest } from 'next/server';
import { identify } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  if (await identify(request.headers)) return NextResponse.next();
  return new NextResponse('Not signed in. This app only accepts requests through Tailscale or Cloudflare Access.', { status: 401 });
}

export const config = {
  // Not static files, image optimization, icons, the health check or the REST API.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|api/).*)'],
};
