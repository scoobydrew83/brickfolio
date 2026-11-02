// Retakes the README screenshots and the tour GIF from a running app with the demo data.
// Dev only, not a dependency: needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium;
// run with NODE_PATH=$(npm root -g)) and ffmpeg.
//   DATABASE_PATH=/tmp/shots.db npm run seed && DATABASE_PATH=/tmp/shots.db npm run build && npx next start -p 3123
//   NODE_PATH=$(npm root -g) node scripts/screenshots.mjs http://localhost:3123
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.argv[2] ?? 'http://localhost:3000';
const out = new URL('../docs/screenshots/', import.meta.url).pathname;
const browser = await chromium.launch();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name, path, { width = 1440, height = 1100, dark = false, mobile = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, colorScheme: dark ? 'dark' : 'light', isMobile: mobile, hasTouch: mobile });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
  console.log(`${name}.png`);
}

await shot('sets-light', '/');
await shot('sets-dark', '/', { dark: true });
await shot('phone', '/', { width: 390, height: 844, mobile: true });
await shot('set-detail', '/sets/10497', { height: 1000 });
await shot('wishlist', '/wishlist', { height: 900 });

// The tour: Sets → a theme filter → a set → the wishlist → dark mode.
const dir = mkdtempSync(join(tmpdir(), 'brickfolio-tour-'));
const ctx = await browser.newContext({ viewport: { width: 1200, height: 750 }, recordVideo: { dir, size: { width: 1200, height: 750 } } });
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle' });
await pause(1200);
await page.mouse.wheel(0, 320); await pause(900);
await page.getByRole('button', { name: /^Icons/ }).first().click(); await pause(1400);
await page.getByRole('button', { name: /^Icons/ }).first().click(); await pause(500);
await page.getByLabel('Search sets').pressSequentially('castle', { delay: 90 }); await pause(1400);
await page.getByRole('link', { name: /Lion Knights/ }).first().click();
await page.waitForURL(/\/sets\//); await pause(1800);
await page.mouse.wheel(0, 400); await pause(1200);
await page.getByRole('link', { name: 'Wishlist' }).first().click();
await page.waitForURL(/wishlist/); await pause(1800);
await page.getByRole('button', { name: /^Theme:/ }).click(); await pause(400);
await page.getByRole('button', { name: /^Theme:/ }).click(); await pause(1800);
await ctx.close();
await browser.close();

const video = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
const gif = join(out, 'tour.gif');
const palette = join(dir, 'palette.png');
const filters = 'fps=12,scale=800:-1:flags=lanczos';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', video, '-vf', `${filters},palettegen=stats_mode=diff`, palette]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', video, '-i', palette, '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, gif]);
console.log(`tour.gif (${(statSync(gif).size / 1e6).toFixed(1)} MB)`);
