export {};
// #90: the #50 route and MCP tests, unchanged, with everyone signed in through Better Auth (email + password sessions)
// instead of a Tailscale header.
process.env.AUTH_MODE = 'better-auth';
process.env.BETTER_AUTH_SECRET = crypto.randomUUID() + crypto.randomUUID();
process.env.BETTER_AUTH_URL = 'http://app';
process.env.BETTER_AUTH_OPEN_SIGNUP = '1';
await import('./permissions.routes.test');

const { it, expect } = await import('vitest');
const sets = await import('../../app/api/v1/sets/route');
it('ignores the Tailscale header: only a session counts', async () => {
  const req = new Request('http://app/api/v1/sets', { headers: { 'tailscale-user-login': 'admin@x.test' } });
  expect((await sets.GET(req, { params: Promise.resolve({}) })).status).toBe(401);
});
