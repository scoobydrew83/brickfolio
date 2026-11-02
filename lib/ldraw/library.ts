// The LDraw parts library the 3D view loads parts from. Either a folder on the server (LDRAW_LIBRARY_DIR: the
// official library unzipped, with parts/, p/ and LDConfig.ldr) or a base URL to fetch from (LDRAW_LIBRARY_URL,
// e.g. a bucket holding the same files). Off unless one is set.
import 'server-only';

/** Library paths the 3D view may ask for: parts/, p/ and models/ files, plus LDConfig.ldr. Null when refused. */
export function libraryPath(segments: string[]): string | null {
  const path = segments.join('/');
  if (path.length > 200 || path.includes('..') || path.includes('//')) return null;
  if (path.toLowerCase() === 'ldconfig.ldr') return 'LDConfig.ldr';
  if (!/^(parts|p|models)\/[A-Za-z0-9_\-.]+(\/[A-Za-z0-9_\-.]+)*\.(dat|ldr|mpd)$/i.test(path)) return null;
  return path;
}

export type LibrarySource = { kind: 'dir'; dir: string } | { kind: 'url'; url: string } | null;

/** LDRAW_LIBRARY_URL wins when set: Docker always sets LDRAW_LIBRARY_DIR as a default, so the URL is the explicit choice. */
export function librarySource(): LibrarySource {
  const url = process.env.LDRAW_LIBRARY_URL;
  if (url && /^https?:\/\//.test(url)) return { kind: 'url', url: url.endsWith('/') ? url : `${url}/` };
  const dir = process.env.LDRAW_LIBRARY_DIR;
  if (dir) return { kind: 'dir', dir };
  return null;
}

/** Reads one library file, or null when it isn't there. */
export async function readLibraryFile(source: NonNullable<LibrarySource>, path: string): Promise<string | null> {
  if (source.kind === 'url') {
    const res = await fetch(source.url + path, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? res.text() : null;
  }
  // Loaded only on the Node build: Cloudflare has no file system and uses LDRAW_LIBRARY_URL instead.
  const { readFile } = await import(/* turbopackIgnore: true */ 'node:fs/promises');
  const { join, resolve, sep } = await import(/* turbopackIgnore: true */ 'node:path');
  const root = resolve(/*turbopackIgnore: true*/ source.dir);
  const full = resolve(/*turbopackIgnore: true*/ join(root, path));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ full, 'utf8');
  } catch {
    return null;
  }
}
