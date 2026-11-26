import { afterEach, expect, it, vi } from 'vitest';
import { mcpOAuthOn, resourceMetadataUrl, wwwAuthenticate } from './oauth';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllEnvs());

it('is on only with Better Auth sign-in and a BETTER_AUTH_URL', () => {
  vi.stubEnv('AUTH_MODE', 'tailscale');
  vi.stubEnv('BETTER_AUTH_URL', 'https://bricks.example');
  expect(mcpOAuthOn()).toBe(false);
  expect(wwwAuthenticate()).toBe('Bearer');
  vi.stubEnv('AUTH_MODE', 'better-auth');
  expect(mcpOAuthOn()).toBe(true);
  vi.stubEnv('BETTER_AUTH_URL', '');
  expect(mcpOAuthOn()).toBe(false);
});

it('points MCP clients at the path-inserted protected resource metadata', () => {
  vi.stubEnv('AUTH_MODE', 'better-auth');
  vi.stubEnv('BETTER_AUTH_URL', 'https://bricks.example/');
  expect(resourceMetadataUrl()).toBe('https://bricks.example/.well-known/oauth-protected-resource/api/mcp');
  expect(wwwAuthenticate()).toBe('Bearer resource_metadata="https://bricks.example/.well-known/oauth-protected-resource/api/mcp"');
});
