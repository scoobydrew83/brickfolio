// Rebuilds lib/barcode/data/cmf-codes.json from a checkout of L-Scan (https://github.com/le0pard/lego-scanner, MIT):
//   git clone --depth 1 https://github.com/le0pard/lego-scanner /tmp/lscan && node scripts/import-lscan.mjs /tmp/lscan
// Keeps only what the scanner needs: series, figure names and their box codes (no images).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
if (!repo) { console.error('Usage: node scripts/import-lscan.mjs <path to lego-scanner checkout>'); process.exit(1); }
const dir = join(repo, 'src/lib/data');
const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
const ok = (s, re) => typeof s === 'string' && re.test(s);

const series = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return {
    name: String(d.displayName),
    year: Number(d.releaseYear) || null,
    figures: d.minifigures.map((m) => ({
      name: String(m.name),
      codes: (m.identifiers ?? []).filter((i) => ok(i.code, /^\d{7}$/)).map((i) => [i.code, ok(i.factory, /^[A-Z]$/) ? i.factory : '', ok(i.year, /^\d$/) ? i.year : '']),
    })).filter((m) => m.codes.length),
  };
});

const out = {
  source: 'L-Scan by Oleksii Vasyliev, https://github.com/le0pard/lego-scanner (MIT License). Codes collected by fans; not from the LEGO Group.',
  commit,
  // Each code is [7-digit box code, factory letter (S = Czech Republic, R = Mexico), production year digit].
  series,
};
writeFileSync(new URL('../lib/barcode/data/cmf-codes.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`${series.length} series, ${series.reduce((t, s) => t + s.figures.reduce((u, f) => u + f.codes.length, 0), 0)} codes from ${commit.slice(0, 7)}`);
