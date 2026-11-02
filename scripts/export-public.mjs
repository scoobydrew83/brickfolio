// Copies this repo's current commit into a checkout of the public repo, as one snapshot commit, leaving out
// the paths in .public-exclude. Private history, PR links and session notes never reach the public repo.
//   node scripts/export-public.mjs <path to a clone of the public repo>           → commit only
//   node scripts/export-public.mjs <path to a clone of the public repo> --push    → commit and push
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [target, ...flags] = process.argv.slice(2);
if (!target || !existsSync(join(target, '.git'))) {
  console.error('Usage: node scripts/export-public.mjs <clone of the public repo> [--push]');
  process.exit(1);
}
const git = (args, cwd = '.') => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
if (git(['status', '--porcelain'])) console.warn('Note: uncommitted changes here are not exported; only HEAD is.');

// Small edits for the public copy: references to files that are left out.
const REWRITES = {
  'docs/design.md': (s) => s.replace("; the direction contract for the Sets page is in `.impeccable/surfaces/app-page-tsx.md`", ''),
};

const exclude = readFileSync('.public-exclude', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const sha = git(['rev-parse', '--short', 'HEAD']);
const tmp = mkdtempSync(join(tmpdir(), 'brickfolio-export-'));
execFileSync('sh', ['-c', `git archive HEAD | tar -x -C "${tmp}"`]);
for (const p of exclude) rmSync(join(tmp, p), { recursive: true, force: true });
for (const [file, fn] of Object.entries(REWRITES)) {
  const f = join(tmp, file);
  if (existsSync(f)) writeFileSync(f, fn(readFileSync(f, 'utf8')));
}

// Replace everything in the public checkout except its .git with the snapshot.
for (const entry of readdirSync(target)) if (entry !== '.git') rmSync(join(target, entry), { recursive: true, force: true });
cpSync(tmp, target, { recursive: true });
rmSync(tmp, { recursive: true, force: true });

// Refuse to publish anything that looks like a secret or a private address.
const SUSPECT = /BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|[a-z0-9-]+\.[a-z0-9-]+\.ts\.net|claude\.ai\/code\/session_/;
const EXAMPLES = /[a-z0-9-]+\.tail(1|1234)\.ts\.net/g; // made-up tailnets used in the tests and docs
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: target, encoding: 'utf8' }).split('\0').filter(Boolean);
const leaks = files.flatMap((f) => {
  const text = readFileSync(join(target, f));
  if (text.includes(0)) return []; // binary
  return text.toString('utf8').split('\n').flatMap((line, i) => (SUSPECT.test(line.replace(EXAMPLES, '')) ? [`${f}:${i + 1}: ${line.trim().slice(0, 160)}`] : []));
}).join('\n');
if (leaks) {
  console.error(`Stopped: possible secrets or private addresses in the export:\n${leaks}`);
  process.exit(1);
}

git(['add', '-A'], target);
if (!git(['status', '--porcelain'], target)) {
  console.log('The public repo is already up to date.');
  process.exit(0);
}
console.log(git(['status', '--short'], target).split('\n').slice(0, 40).join('\n'));
git(['commit', '-q', '-m', `Sync from the private repo (${sha})`], target);
console.log(`Committed the snapshot of ${sha} in ${target}.`);
if (flags.includes('--push')) {
  git(['push', 'origin', 'HEAD'], target);
  console.log('Pushed.');
}
