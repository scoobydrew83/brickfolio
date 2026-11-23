// Starts Brickfolio's daily sync from a scheduler that runs a command (a Render cron job, crontab, a CI schedule):
//   BRICKFOLIO_URL=https://bricks.example CRON_SECRET=… node scripts/cron-trigger.mjs [--wait]
// Calls GET /api/v1/sync/cron, retrying while the service wakes up (a sleeping free instance can take a minute or
// more). With --wait it then checks GET /api/v1/sync once a minute until the sync finishes, which also keeps a
// free instance that sleeps without traffic awake. Needs Node 18+ and nothing installed.
const base = (process.env.BRICKFOLIO_URL || process.env.APP_URL || '').replace(/\/+$/, '');
const secret = process.env.CRON_SECRET;
const wait = process.argv.includes('--wait');
const waitMinutes = Number(process.env.CRON_WAIT_MINUTES || 90);

if (!/^https?:\/\//.test(base) || !secret) {
  console.error('Set BRICKFOLIO_URL (the app\'s address, e.g. https://brickfolio.onrender.com) and CRON_SECRET.');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${secret}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(90_000), redirect: 'manual' });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let r;
for (let attempt = 1; ; attempt++) {
  try {
    r = await get('/api/v1/sync/cron');
    if (![502, 503, 504].includes(r.status)) break; // those while a sleeping instance starts
  } catch (e) {
    r = { status: 0, body: { error: e instanceof Error ? e.message : String(e) } };
  }
  if (attempt === 6) break;
  console.log(`Not answering yet (${r.status || r.body.error}); trying again in 30 s.`);
  await sleep(30_000);
}
console.log(`GET /api/v1/sync/cron → ${r.status}`, JSON.stringify(r.body));
if (r.status === 401) console.error('CRON_SECRET doesn\'t match the app\'s.');
if (r.status !== 200 && r.status !== 202 && r.status !== 409) process.exit(1);

if (wait && r.status !== 200) {
  const until = Date.now() + waitMinutes * 60_000;
  while (Date.now() < until) {
    await sleep(60_000);
    const s = await get('/api/v1/sync').catch(() => null);
    // Without BrickLink keys the cron route runs only Rebrickable and Brickset (`started`), tracked as `catalogOnly`.
    if (r.body?.started) {
      const c = s?.body?.catalogOnly;
      if (c && !c.running) {
        console.log(`Rebrickable and Brickset finished${c.errors.length ? ` with ${c.errors.length} error(s): ${c.errors.slice(0, 3).join('; ')}` : '.'}`);
        process.exit(0);
      }
      if (s && !c) { console.error('The app restarted during the run; stopped waiting.'); process.exit(0); }
      console.log('Running: Rebrickable and Brickset.');
      continue;
    }
    const sync = s?.body?.sync;
    if (sync && !sync.running) {
      console.log(`Sync finished: ${sync.processed} of ${sync.total} sets, ${sync.errors} errors.${sync.message ? ` ${sync.message}` : ''}`);
      process.exit(0);
    }
    if (sync) console.log(`Running: ${sync.processed} of ${sync.total} sets.`);
  }
  console.error(`Still running after ${waitMinutes} minutes; stopped waiting.`);
}
