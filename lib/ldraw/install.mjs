// Downloads and installs the official LDraw parts library (complete.zip) into a folder.
// Plain JavaScript so both the app (Settings → Download) and `npm run ldraw:download` use the same code.
// A failed download or unzip never touches a library that is already installed.
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

export const DEFAULT_ZIP_URL = 'https://library.ldraw.org/library/updates/complete.zip';
const META = '.brickfolio.json';

const exists = (p) => access(p).then(() => true, () => false);

/** The folder inside the unzipped archive that holds LDConfig.ldr (the zip has a top-level ldraw/ folder). */
async function findRoot(dir) {
  if (await exists(join(dir, 'LDConfig.ldr'))) return dir;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && (await exists(join(dir, entry.name, 'LDConfig.ldr')))) return join(dir, entry.name);
  }
  return null;
}

/**
 * Installs the library into `dir`. `onProgress({ phase: 'download', got, total })` and `({ phase: 'extract' })`
 * report progress. Needs the `unzip` command. Throws a readable Error on failure.
 */
export async function installLibrary(dir, { url = DEFAULT_ZIP_URL, onProgress, fetchImpl = fetch } = {}) {
  const target = resolve(dir);
  await mkdir(dirname(target), { recursive: true });
  const zip = `${target}.download.zip`, tmp = `${target}.tmp`, old = `${target}.old`;
  await rm(tmp, { recursive: true, force: true });
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`.trim());
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (chunk) => { got += chunk.length; onProgress?.({ phase: 'download', got, total }); });
    await pipeline(body, createWriteStream(zip));

    onProgress?.({ phase: 'extract' });
    await mkdir(tmp, { recursive: true });
    try {
      await promisify(execFile)('unzip', ['-q', '-o', zip, '-d', tmp], { maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      throw new Error(e.code === 'ENOENT' ? 'The unzip command is missing on this server.' : `Couldn't unzip the library: ${String(e.stderr || e.message).trim()}`);
    }
    const root = await findRoot(tmp);
    if (!root) throw new Error("The download doesn't look like the LDraw library (no LDConfig.ldr inside).");
    await writeFile(join(root, META), JSON.stringify({ downloadedAt: new Date().toISOString(), source: url }));

    // Swap in the new library; put the old one back if the swap fails.
    await rm(old, { recursive: true, force: true });
    const hadOld = await exists(target);
    if (hadOld) await rename(target, old);
    try {
      await rename(root, target);
    } catch (e) {
      if (hadOld) await rename(old, target);
      throw e;
    }
    await rm(old, { recursive: true, force: true });
  } finally {
    await rm(zip, { force: true });
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Whether `dir` holds a usable library, and when Brickfolio downloaded it (null if installed by hand). */
export async function readLibrary(dir) {
  const target = resolve(dir);
  const ready = (await exists(join(target, 'LDConfig.ldr'))) && (await exists(join(target, 'parts')));
  let downloadedAt = null;
  try { downloadedAt = JSON.parse(await readFile(join(target, META), 'utf8')).downloadedAt ?? null; } catch {}
  return { ready, downloadedAt };
}
