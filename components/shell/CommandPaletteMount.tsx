import { connection } from 'next/server';
import { getDb } from '@/lib/db';
import { authMode } from '@/lib/auth';
import { listCollections } from '@/lib/service/collections';
import { can, clampScope, writable } from '@/lib/service/permissions';
import { currentAccess, currentSelection } from '@/lib/session';
import { CommandPalette } from './CommandPalette';

/** The command palette (#107) for whoever is signed in, with what they may do. Nothing when nobody is. Never breaks the page. */
export async function CommandPaletteMount() {
  await connection();
  const access = await currentAccess().catch(() => null);
  if (!access) return null;
  const [all, sel] = await Promise.all([getDb().then(listCollections).catch(() => []), currentSelection().catch(() => 'all' as const)]);
  const collections = all.filter((c) => access.admin || access.roles.has(c.id));
  const current = sel !== 'all' && collections.some((c) => c.id === sel) ? sel : 'all';
  // Search the collection the pages show (#49), when this person can read it; else all of theirs.
  const scope = current === 'all' ? null : clampScope(access, current);
  const w = writable(access);
  return (
    <CommandPalette
      admin={access.admin}
      account={authMode() === 'better-auth'}
      canAdd={can(access, 'member') && (w === 'all' || w.length > 0)}
      collection={typeof scope === 'number' ? scope : undefined}
      collections={collections.length > 1 ? collections.map((c) => ({ id: c.id, name: c.name })) : []}
      current={current}
    />
  );
}
