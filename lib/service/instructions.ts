// Building instruction PDFs for a set's page, from Brickset (getInstructions2, which doesn't use the daily getSets
// limit). Kept in memory per server for a week (an hour after a failure), so opening a set page again costs nothing.
// Without BRICKSET_API_KEY, or when Brickset is slow or down, the page simply shows none.
import { bricksetFromEnv, type Instruction, type RetailSource } from '../brickset/client';

const WEEK = 7 * 86_400_000;
const HOUR = 3_600_000;
const cache = new Map<string, { at: number; ttl: number; list: Instruction[] }>();

/** The set's instruction PDFs, or [] (never throws). Waits at most `timeoutMs` so a slow Brickset can't hold the page. */
export async function setInstructions(setNo: string, opts: { source?: RetailSource | null; timeoutMs?: number; now?: number } = {}): Promise<Instruction[]> {
  const src = opts.source === undefined ? bricksetFromEnv() : opts.source;
  if (!src?.instructions) return [];
  const now = opts.now ?? Date.now();
  const hit = cache.get(setNo);
  if (hit && now - hit.at < hit.ttl) return hit.list;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const list = await Promise.race([
      src.instructions(setNo),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), opts.timeoutMs ?? 4000); }),
    ]);
    cache.set(setNo, { at: now, ttl: WEEK, list });
    return list;
  } catch {
    cache.set(setNo, { at: now, ttl: HOUR, list: hit?.list ?? [] });
    return hit?.list ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/** For tests. */
export const clearInstructionCache = () => cache.clear();
