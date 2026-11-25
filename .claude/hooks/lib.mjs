// Shared by the Claude Code hooks in this folder (.claude/settings.json). Each hook reads the event as JSON on stdin.
// Exit code 2 blocks (its stderr goes back to Claude); 0 lets it through. Exit 1 would NOT block, so failures exit 2.
import { spawnSync } from 'node:child_process';

export async function input() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/** Runs a command in `cwd`; returns { ok, out } with stdout and stderr together. */
export function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const tail = (text, n) => text.trimEnd().split('\n').slice(-n).join('\n');

/** Blocks with a short reason and the end of the output. */
export function block(reason, out, lines = 40) {
  process.stderr.write(`${reason}\n${tail(out, lines)}\n`);
  process.exit(2);
}
