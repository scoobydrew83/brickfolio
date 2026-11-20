'use client';
import { useState, useTransition } from 'react';
import { addPerson, setAdmin, setRole, type Result } from '@/app/actions';
import { Banner, Button, field } from '../ui';
import type { Person, Role } from '@/lib/service/permissions';

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';
const ROLES: Role[] = ['viewer', 'editor', 'owner'];
const ROLE_HELP = 'Viewer: sees the collection. Editor: also adds, changes and removes its sets and minifigures. Owner: also chooses who else can.';
type Collection = { id: number; name: string };
type Run = (fn: () => Promise<Result>, ok: string) => void;

function useRun(): [boolean, Run, { kind: 'ok' | 'error'; text: string } | null, () => void] {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const run: Run = (fn, ok) => start(async () => { const r = await fn(); setNote(r.ok ? { kind: 'ok', text: ok } : { kind: 'error', text: r.error }); });
  return [pending, run, note, () => setNote(null)];
}

/** One login's role in one collection, as a select ("—" = none). */
function RoleSelect({ c, login, role, pending, run }: { c: Collection; login: string; role: Role | undefined; pending: boolean; run: Run }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="min-w-0 flex-1 break-words">{c.name}</span>
      <select value={role ?? ''} disabled={pending} aria-label={`${login}'s role in ${c.name}`} className="shrink-0 rounded-control border border-line-strong bg-surface px-2 py-1 text-sm text-fg"
        onChange={(e) => { const r = (e.target.value || null) as Role | null; run(() => setRole(c.id, login, r), r ? `${login} is now ${r} of ${c.name}.` : `${login} no longer has ${c.name}.`); }}>
        <option value="">—</option>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </label>
  );
}

/**
 * Settings → People (admins): everyone who has signed in or been added, whether they're an admin, and their role in
 * each collection. Someone who isn't an admin sees only the collections they have a role in.
 */
export function PeopleSection({ people, collections, me, envAdmins }: { people: Person[]; collections: Collection[]; me: string; envAdmins: boolean }) {
  const [pending, run, note, clear] = useRun();
  const [open, setOpen] = useState<string | null>(null);
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
  return (
    <section className={section} aria-labelledby="people-title">
      <h2 id="people-title" className={h2}>People</h2>
      <p className="text-sm text-fg-3">
        Who can use this Brickfolio. Admins can do everything; everyone else sees only the collections they have a role in. {ROLE_HELP}
        {!envAdmins && <> Every login allowed in is an admin until <code className="rounded-chip bg-muted px-1">ADMIN_USERS</code> names the admins (see docs/install.md).</>}
      </p>
      {note && <Banner kind={note.kind} onDismiss={clear}>{note.text}</Banner>}
      <ul className="divide-y divide-line">
        {people.map((p) => (
          <li key={p.login} className="py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0">
                <span className="break-all font-medium">{p.login}</span>
                <span className="text-xs text-fg-3"> · {p.admin ? (p.fromEnv ? 'admin (ADMIN_USERS)' : 'admin') : p.roles.length ? `${p.roles.length} collection${p.roles.length === 1 ? '' : 's'}` : 'no access yet'} · {p.lastSeenAt ? `last seen ${day(p.lastSeenAt)}` : 'not signed in yet'}</span>
              </span>
              <span className="flex gap-3">
                {!p.admin && <Button variant="link" onClick={() => setOpen(open === p.login ? null : p.login)} aria-expanded={open === p.login}>Collections</Button>}
                {!p.fromEnv && p.login !== me && (
                  <Button variant="link" disabled={pending} onClick={() => run(() => setAdmin(p.login, !p.admin), p.admin ? `${p.login} is no longer an admin.` : `${p.login} is now an admin.`)}>
                    {p.admin ? 'Remove admin' : 'Make admin'}
                  </Button>
                )}
              </span>
            </div>
            {open === p.login && !p.admin && (
              <div className="mt-2 grid gap-2 rounded-control bg-subtle p-3 sm:grid-cols-2">
                {collections.map((c) => <RoleSelect key={c.id} c={c} login={p.login} role={p.roles.find((r) => r.collectionId === c.id)?.role} pending={pending} run={run} />)}
              </div>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const login = String(new FormData(f).get('login')).trim(); run(() => addPerson(login), `Added ${login}. Give them a collection with Collections.`); f.reset(); setOpen(login.toLowerCase()); }}>
        <input name="login" required maxLength={200} placeholder="Tailscale login or Access email" aria-label="Add a person" autoCapitalize="none" className={`${field} mt-0`} />
        <Button type="submit" disabled={pending}>Add</Button>
      </form>
    </section>
  );
}

/** Settings → Members, for owners who aren't admins: who can see or change the collections they own. */
export function MembersSection({ collections, members, me }: { collections: Collection[]; members: { collectionId: number; login: string; role: Role }[]; me: string }) {
  const [pending, run, note, clear] = useRun();
  if (!collections.length) return null;
  return (
    <section className={section} aria-labelledby="members-title">
      <h2 id="members-title" className={h2}>Members of your collections</h2>
      <p className="text-sm text-fg-3">{ROLE_HELP}</p>
      {note && <Banner kind={note.kind} onDismiss={clear}>{note.text}</Banner>}
      {collections.map((c) => (
        <div key={c.id} className="space-y-2">
          <h3 className="font-semibold">{c.name}</h3>
          <ul className="divide-y divide-line">
            {members.filter((m) => m.collectionId === c.id).map((m) => (
              <li key={m.login} className="py-1.5">
                {m.login === me ? <p className="text-sm"><span className="break-all">{m.login}</span> <span className="text-xs text-fg-3">· {m.role} (you)</span></p>
                  : <RoleSelect c={{ id: c.id, name: m.login }} login={m.login} role={m.role} pending={pending} run={run} />}
              </li>
            ))}
          </ul>
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); const login = String(d.get('login')).trim(); const role = String(d.get('role')) as Role;
            run(() => setRole(c.id, login, role), `${login} is now ${role} of ${c.name}.`); f.reset();
          }}>
            <input name="login" required maxLength={200} placeholder="Tailscale login or Access email" aria-label={`Add someone to ${c.name}`} autoCapitalize="none" className={`${field} mt-0`} />
            <select name="role" defaultValue="viewer" aria-label="Role" className={`${field} mt-0 w-auto`}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            <Button type="submit" disabled={pending}>Add</Button>
          </form>
        </div>
      ))}
    </section>
  );
}
