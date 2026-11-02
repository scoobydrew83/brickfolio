// Settings → "Download the LDraw library": runs the install in the background of this server process and
// keeps its progress in memory so the page can show it.
import 'server-only';
import { librarySource } from './library';

export type LibraryStatus = {
  kind: 'dir' | 'url' | null;
  ready: boolean;
  downloadedAt: string | null;
  running: boolean;
  progress: { phase: 'download' | 'extract'; got?: number; total?: number } | null;
  error: string | null;
};

const state: { running: boolean; progress: LibraryStatus['progress']; error: string | null } = { running: false, progress: null, error: null };

export async function libraryStatus(): Promise<LibraryStatus> {
  const source = librarySource();
  if (!source) return { kind: null, ready: false, downloadedAt: null, running: false, progress: null, error: null };
  if (source.kind === 'url') return { kind: 'url', ready: true, downloadedAt: null, running: false, progress: null, error: null };
  const { readLibrary } = await import('./install.mjs');
  return { kind: 'dir', ...(await readLibrary(source.dir)), running: state.running, progress: state.progress, error: state.error };
}

/** Starts downloading the library into LDRAW_LIBRARY_DIR. Returns an error message, or null once it's started. */
export async function startLibraryDownload(): Promise<string | null> {
  const source = librarySource();
  if (source?.kind !== 'dir') return 'Set LDRAW_LIBRARY_DIR to a folder on the server first (Docker and Coolify use /data/ldraw).';
  if (state.running) return null;
  // Claim the run before any await, so two clicks can't start two installs into the same folder.
  Object.assign(state, { running: true, progress: { phase: 'download' }, error: null });
  let install: typeof import('./install.mjs');
  try {
    install = await import('./install.mjs');
  } catch (e) {
    Object.assign(state, { running: false, progress: null, error: e instanceof Error ? e.message : String(e) });
    return state.error;
  }
  const { installLibrary, DEFAULT_ZIP_URL } = install;
  installLibrary(source.dir, {
    url: process.env.LDRAW_LIBRARY_ZIP_URL || DEFAULT_ZIP_URL,
    onProgress: (p) => { state.progress = p; },
  }).then(
    () => Object.assign(state, { running: false, progress: null, error: null }),
    (e: unknown) => Object.assign(state, { running: false, progress: null, error: e instanceof Error ? e.message : String(e) }),
  );
  return null;
}
