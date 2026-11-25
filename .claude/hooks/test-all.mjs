// Stop: runs the full test suite before the session ends. Exit 2 sends the session back to work. After 3 blocks in a
// row it lets the session stop (it must then report the failure; CI still catches it), so it can't loop forever.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { block, input, run } from './lib.mjs';

const MAX_BLOCKS = 3;
const e = await input();
const cwd = e.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Nothing changed on this branch: nothing to check.
if (!run('git', ['status', '--porcelain'], cwd).out.trim() && run('git', ['diff', '--quiet', 'origin/main...HEAD'], cwd).ok) process.exit(0);
const counter = join(tmpdir(), `claude-stop-${String(e.session_id ?? 'unknown').replace(/[^\w-]/g, '')}`);
const r = run('npx', ['vitest', 'run'], cwd);
if (r.ok) { rmSync(counter, { force: true }); process.exit(0); }
let n = 0;
try { n = Number(readFileSync(counter, 'utf8')) || 0; } catch {}
if (n >= MAX_BLOCKS) process.exit(0);
writeFileSync(counter, String(n + 1));
block('The full test suite is failing. Fix it before finishing, or say clearly why it cannot be fixed.', r.out);
