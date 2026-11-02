// Runs once when the server starts. On self-hosted Node it starts the daily sync and backup jobs.
// With DEMO_MODE=on it fills an empty database with demo data instead, and runs no background jobs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.DB_DRIVER === 'd1') return;
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
