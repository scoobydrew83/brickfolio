import { getModule } from '@/lib/service/layouts';
import type { DB } from '@/lib/db';

/** An id from the path, or null when it isn't a positive whole number. */
export const idOf = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

/** The module id from the path, when the module is on this layout. */
export async function moduleOn(db: DB, layoutId: string, moduleId: string): Promise<number | null> {
  const l = idOf(layoutId), m = idOf(moduleId);
  if (l === null || m === null) return null;
  const mod = await getModule(db, m);
  return mod && mod.layoutId === l ? mod.id : null;
}
