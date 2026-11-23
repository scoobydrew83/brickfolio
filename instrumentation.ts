// Runs once when the server starts. On self-hosted Node it starts the daily sync and backup jobs.
// With DEMO_MODE=on it fills an empty database with demo data instead, and runs no background jobs.
// On Vercel (serverless: no long-running process) there is no scheduler; Vercel Cron calls GET /api/v1/sync/cron.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.DB_DRIVER === 'd1') return;
  if (process.env.VERCEL) {
    const { defaultAuthUrl, hostProblem } = await import('./lib/hosting');
    const problem = hostProblem(process.env);
    if (problem) throw new Error(problem); // every request fails with this in the logs until DATABASE_URL is set
    const authUrl = defaultAuthUrl(process.env);
    if (authUrl) process.env.BETTER_AUTH_URL = authUrl;
    return;
  }
  const { isDemo } = await import('./lib/demo');
  if (isDemo()) {
    const [{ nodeDb }, { seedDemo }] = await Promise.all([import('./lib/db/node'), import('./lib/db/seed.mjs')]);
    const { sqlite } = nodeDb();
    const { n } = sqlite.prepare('SELECT count(*) AS n FROM sets').get() as { n: number };
    if (!n) console.log(`Demo mode: added ${seedDemo(sqlite)} demo sets.`);
    return;
  }
  if (process.env.SCHEDULER !== 'off') (await import('./lib/scheduler')).startScheduler();
}
