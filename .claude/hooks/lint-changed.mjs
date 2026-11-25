// PostToolUse (Edit|Write): lints the file that was just edited. The edit already happened, so exit 2 only sends the
// lint errors back to Claude to fix next.
import { relative } from 'node:path';
import { block, input, run } from './lib.mjs';

const e = await input();
const file = e.tool_input?.file_path;
const cwd = e.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!file || !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) process.exit(0);
const rel = relative(cwd, file);
if (rel.startsWith('..') || /(^|\/)(node_modules|\.next|\.open-next)\//.test(rel)) process.exit(0);
const r = run('npx', ['eslint', '--no-warn-ignored', file], cwd);
if (!r.ok) block(`Lint failed for ${rel}:`, r.out, 30);
