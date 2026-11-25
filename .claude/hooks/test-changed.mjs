// TaskCompleted: runs the tests related to what changed on this branch (vitest related), so a task isn't marked
// complete with failing tests. Exit 2 keeps the task open.
import { block, input, run } from './lib.mjs';

const e = await input();
const cwd = e.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const base = run('git', ['merge-base', 'HEAD', 'origin/main'], cwd);
const changed = [
  ...run('git', ['diff', '--name-only', base.ok ? base.out.trim() : 'HEAD'], cwd).out.split('\n'),
  ...run('git', ['ls-files', '--others', '--exclude-standard'], cwd).out.split('\n'),
].filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
if (!changed.length) process.exit(0);
const r = run('npx', ['vitest', 'related', '--run', '--passWithNoTests', ...new Set(changed)], cwd);
if (!r.ok) block('Tests related to your changes are failing. Fix them before completing this task.', r.out);
