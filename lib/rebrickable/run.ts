// Settings → "Sync Rebrickable now", and the daily Rebrickable run for installs without BrickLink keys.
// Runs themes, minifigs, part and colour IDs and alternate builds in the background and keeps progress in memory for the page.
import type { DB } from '../db/types';
import { syncBuilds } from '../service/builds';
import { syncCatalog } from '../service/catalog';
import { syncIdentifiers } from '../service/identifiers';
import type { BuildSource, Catalog, IdCatalog } from './client';

export type RebrickableRun = { running: boolean; step: string | null; errors: string[]; finishedAt: string | null };

const state: RebrickableRun = { running: false, step: null, errors: [], finishedAt: null };

export const rebrickableRun = (): RebrickableRun => ({ ...state, errors: [...state.errors] });

/** Starts a Rebrickable-only sync unless one is running. `recheck` asks again about sets it didn't know. */
export function startRebrickableSync(db: DB, rb: Catalog & BuildSource & Partial<IdCatalog>, opts: { recheck?: boolean } = {}): Promise<void> | null {
  if (state.running) return null;
  Object.assign(state, { running: true, step: 'Checking the key…', errors: [], finishedAt: null });
  const run = (async () => {
    try {
      await rb.check?.();
      state.step = 'Loading themes…';
      const errors = await syncCatalog(db, rb, { recheck: opts.recheck, onProgress: (done, total) => { state.step = `Matching sets… ${done + 1} of ${total}`; } });
      if (rb.colors && rb.partsPage) {
        state.step = 'Mapping part and colour IDs…';
        errors.push(...(await syncIdentifiers(db, { colors: rb.colors, partsPage: rb.partsPage })));
      }
      state.step = 'Finding alternate builds…';
      errors.push(...(await syncBuilds(db, rb)));
      state.errors = errors;
    } catch (e) {
      state.errors = [e instanceof Error ? e.message : String(e)];
    } finally {
      Object.assign(state, { running: false, step: null, finishedAt: new Date().toISOString() });
    }
  })();
  return run;
}
