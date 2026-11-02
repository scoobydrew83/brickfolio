// LDraw's Official Model Repository (https://library.ldraw.org/omr): official LEGO sets rebuilt as LDraw models.
// It has no API, but each set's main model sits at a predictable address: library/omr/<set>-<variant>.mpd.
// Coverage is mostly older sets; a set it doesn't have answers 404. Models are CC BY 2.0, so we keep the author.
import { MAX_MODEL_BYTES, checkModel } from '../service/model-check';
import { setNo as fullSetNo } from '../sets';

const BASE = 'https://library.ldraw.org/library/omr/';

export type OmrModel = { fileName: string; content: string; author: string | null };

/** Where the OMR keeps a set's main model. LDRAW_OMR_BASE points elsewhere (tests, mirrors). */
export function omrUrl(setNo: string): string {
  const base = process.env.LDRAW_OMR_BASE || BASE;
  return `${base.endsWith('/') ? base : `${base}/`}${encodeURIComponent(fullSetNo(setNo))}.mpd`;
}

/** The `0 Author:` line of an LDraw file, for attribution. */
export function modelAuthor(content: string): string | null {
  const m = content.slice(0, 4000).match(/^\s*0\s+Author:\s*(.+?)\s*$/m);
  return m ? m[1].slice(0, 120) : null;
}

/** Fetches a set's model from the OMR. Null when the OMR doesn't have it; throws on any other failure. */
export async function fetchOmrModel(setNo: string, fetchImpl: typeof fetch = fetch): Promise<OmrModel | null> {
  const url = omrUrl(setNo);
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Brickfolio (+https://github.com/scoobydrew83/brickfolio)' }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LDraw answered ${res.status} ${res.statusText}`.trim());
  if (Number(res.headers.get('content-length') ?? 0) > MAX_MODEL_BYTES) throw new Error('The LDraw model is over 2 MB.');
  const content = await res.text();
  const fileName = `${fullSetNo(setNo)}.mpd`;
  const error = checkModel(fileName, content);
  if (error) throw new Error(`The LDraw file didn't look right: ${error}`);
  return { fileName, content, author: modelAuthor(content) };
}
