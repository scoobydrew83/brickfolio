// compose.coolify-tailscale.yml is docker-compose.yml + compose.tailscale.yml merged by hand (Coolify takes one file).
// When it fell behind, Coolify installs lost IMAGE_CACHE_DIR and the sync failed with EACCES on mkdir '/app/data'.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

/** The variable names in every `environment:` list of a compose file. */
function envNames(file: string): Set<string> {
  const names = new Set<string>();
  let inEnv = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s+environment:\s*$/.test(line)) { inEnv = true; continue; }
    if (!inEnv || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s+-\s+([A-Z0-9_]+)/);
    if (m) names.add(m[1]);
    else inEnv = false;
  }
  return names;
}

it('keeps the Coolify compose file in step with docker-compose.yml + compose.tailscale.yml', () => {
  // Cloudflare Access settings don't apply: the Coolify file always signs in with Tailscale.
  const skip = new Set(['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD']);
  const expected = [...envNames('docker-compose.yml'), ...envNames('compose.tailscale.yml')].filter((n) => !skip.has(n));
  const coolify = envNames('compose.coolify-tailscale.yml');
  expect(expected.filter((n) => !coolify.has(n))).toEqual([]);
  expect(coolify.has('IMAGE_CACHE_DIR')).toBe(true);
});
