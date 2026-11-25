'use client';
import { useEffect, useState, useTransition } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { addPerson, banPerson, deletePerson, endPersonSessions, impersonate, personSessions, resetLink, resetTwoFactor, setAdmin, setPassword, setRole, unbanPerson, type Result } from '@/app/actions';
import { Banner, Button, Chip, DataTable, DatePicker, field, toast, type ColumnDef } from '../ui';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { Button as ShadButton } from '../ui/button';
import type { Person, Role } from '@/lib/service/permissions';
import type { SessionRow } from '@/lib/service/people-admin';

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';
const ROLES: Role[] = ['viewer', 'editor', 'owner'];
const ROLE_HELP = 'Viewer: sees the collection. Editor: also adds, changes and removes its sets and minifigures. Owner: also chooses who else can.';
type Collection = { id: number; name: string };
type Run = (fn: () => Promise<Result>, ok: string, then?: () => void) => void;

/** Errors stay on the page as a Banner; a success is a toast. */
function useRun(): [boolean, Run, { kind: 'error'; text: string } | null, () => void] {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: 'error'; text: string } | null>(null);
  const run: Run = (fn, ok, then) => start(async () => {
    const r = await fn();
    if (!r.ok) return setNote({ kind: 'error', text: r.error });
    setNote(null);
    toast.success(ok);
    then?.();
  });
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

/** Set password (#90): a password for someone who has none (or forgot theirs). */
function PasswordForm({ login, pending, run }: { login: string; pending: boolean; run: Run }) {
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const pw = String(new FormData(f).get('password')); run(() => setPassword(login, pw), `Set ${login}'s password. Tell them it, and they're signed out everywhere else.`); f.reset(); }}>
      <input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="New password (10+ characters)" aria-label={`New password for ${login}`} className={`${field} mt-0`} />
      <Button type="submit" disabled={pending}>Set</Button>
    </form>
  );
}

/** A reset link shown once (email isn't set up). It works like a password until it's used or expires. */
function LinkNote({ login, url, clear }: { login: string; url: string; clear: () => void }) {
  return (
    <Banner kind="ok" onDismiss={clear}>
      Reset link for {login}. Send it to them privately: anyone with it can set their password, for the next hour. It isn&apos;t shown again.
      <input readOnly value={url} aria-label={`Reset link for ${login}`} className={`${field} mt-2 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
    </Banner>
  );
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "Firefox on Mac" from a user agent, or the raw string when it's unusual. */
export function device(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /(Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Brickfolio/i.test(ua) ? 'Brickfolio app' : null;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return browser && os ? `${browser} on ${os}` : browser ?? os ?? ua.slice(0, 60);
}

/** What the confirm dialog is for. */
type Confirm = { kind: 'ban' | 'delete' | 'twoFactor' | 'impersonate' | 'endAll'; p: Person };

/** The status chips: banned (until when), two-factor, no password. */
function Status({ p, passwords }: { p: Person; passwords: boolean }) {
  const chips = [
    p.ban && <Chip key="ban" tone="danger">{p.ban.until ? `Banned until ${day(p.ban.until)}` : 'Banned'}</Chip>,
    p.twoFactor && <Chip key="2fa" tone="ok">Two-factor on</Chip>,
    passwords && !p.password && <Chip key="pw">No password</Chip>,
  ].filter(Boolean);
  return chips.length ? <span className="flex flex-wrap gap-1">{chips}</span> : <span className="text-fg-3">—</span>;
}

/**
 * Settings → People (admins): a table of everyone who has signed in or been added, and a panel per person with their
 * role and collections, password, ban, two-factor reset, acting as them, deleting them, and their sessions (#102).
 */
export function PeopleSection({ people, collections, me, envAdmins, passwords = null, authMode = 'none' }: { people: Person[]; collections: Collection[]; me: string; envAdmins: boolean; passwords?: 'reset' | 'set' | null; authMode?: string }) {
  const [pending, run, note, clear] = useRun();
  const [openLogin, setOpenLogin] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'sessions'>('overview');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [link, setLink] = useState<{ login: string; url: string } | null>(null);
  const [linking, startLink] = useTransition();
  const betterAuth = authMode === 'better-auth';
  const open = people.find((p) => p.login === openLogin) ?? null;
  const askLink = (login: string) => startLink(async () => {
    setLink(null);
    const r = await resetLink(login);
    if (r.ok && r.url) setLink({ login, url: r.url });
    else run(async () => r, `Sent ${login} a reset link.`);
  });
  const show = (login: string, t: 'overview' | 'sessions' = 'overview') => { setTab(t); setOpenLogin(login); };
  const can = (p: Person) => ({ act: p.login !== me && !p.fromEnv, impersonate: betterAuth && p.login !== me && !p.admin && !p.ban });
  const collectionsOf = (p: Person) => (p.admin ? 'All (admin)' : p.roles.length ? p.roles.map((r) => `${collections.find((c) => c.id === r.collectionId)?.name ?? r.collectionId}: ${r.role}`).join(', ') : 'No access yet');

  const columns: ColumnDef<Person>[] = [
    {
      id: 'person', header: 'Person', accessorFn: (p) => p.name ?? p.login,
      cell: ({ row: { original: p } }) => (
        <button type="button" onClick={() => show(p.login)} className="flex max-w-56 flex-col items-start text-left sm:max-w-72">
          <span className="truncate font-medium text-link hover:underline">{p.name ?? p.login}{p.login === me && <span className="font-normal text-fg-3"> (you)</span>}</span>
          {p.name && <span className="truncate text-xs text-fg-3">{p.login}</span>}
        </button>
      ),
    },
    { id: 'admin', header: 'Admin', accessorFn: (p) => (p.admin ? (p.fromEnv ? 2 : 1) : 0), cell: ({ row: { original: p } }) => (p.admin ? (p.fromEnv ? 'ADMIN_USERS' : 'Admin') : <span className="text-fg-3">—</span>) },
    { id: 'collections', header: 'Collections and roles', accessorFn: collectionsOf, cell: ({ getValue }) => <span className="block max-w-64 truncate">{getValue<string>()}</span> },
    { id: 'seen', header: 'Last seen', accessorFn: (p) => p.lastSeenAt ?? '', cell: ({ row: { original: p } }) => <span className="tabular-nums">{day(p.lastSeenAt) ?? <span className="text-fg-3">Not yet</span>}</span> },
    { id: 'status', header: 'Status', enableSorting: false, cell: ({ row: { original: p } }) => <Status p={p} passwords={!!passwords} /> },
    {
      id: 'menu', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { className: 'w-10 text-right' },
      cell: ({ row: { original: p } }) => {
        const c = can(p);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger render={<ShadButton variant="ghost" size="icon-sm" aria-label={`Actions for ${p.login}`} />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => show(p.login)}>Open</DropdownMenuItem>
                {betterAuth && <DropdownMenuItem onClick={() => show(p.login, 'sessions')}>Sessions</DropdownMenuItem>}
                {!p.fromEnv && p.login !== me && <DropdownMenuItem onClick={() => run(() => setAdmin(p.login, !p.admin), p.admin ? `${p.login} is no longer an admin.` : `${p.login} is now an admin.`)}>{p.admin ? 'Remove admin' : 'Make admin'}</DropdownMenuItem>}
                {passwords === 'reset' && p.login.includes('@') && <DropdownMenuItem onClick={() => askLink(p.login)}>Reset link</DropdownMenuItem>}
                {c.impersonate && <DropdownMenuItem onClick={() => setConfirm({ kind: 'impersonate', p })}>Act as {p.name ?? p.login}</DropdownMenuItem>}
              </DropdownMenuGroup>
              {(c.act || p.twoFactor) && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                {p.twoFactor && <DropdownMenuItem onClick={() => setConfirm({ kind: 'twoFactor', p })}>Reset two-factor</DropdownMenuItem>}
                {c.act && (p.ban ? <DropdownMenuItem onClick={() => run(() => unbanPerson(p.login), `${p.login} can sign in again.`)}>Unban</DropdownMenuItem>
                  : <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'ban', p })}>Ban</DropdownMenuItem>)}
                {c.act && <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'delete', p })}>Delete</DropdownMenuItem>}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <section className={section} aria-labelledby="people-title">
      <h2 id="people-title" className={h2}>People</h2>
      <p className="text-sm text-fg-3">
        Who can use this Brickfolio. Admins can do everything; everyone else sees only the collections they have a role in. {ROLE_HELP}
        {!envAdmins && <> Every login allowed in is an admin until <code className="rounded-chip bg-muted px-1">ADMIN_USERS</code> names the admins (see docs/install.md).</>}
      </p>
      {note && <Banner kind={note.kind} onDismiss={clear}>{note.text}</Banner>}
      {link && <LinkNote login={link.login} url={link.url} clear={() => setLink(null)} />}
      <DataTable label="People" columns={columns} data={people} rowId={(p) => p.login} initialSort={[{ id: 'person', desc: false }]}
        search={{ placeholder: 'Search people', text: (p) => `${p.name ?? ''} ${p.login} ${collectionsOf(p)}` }} empty="Nobody matches." />
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const login = String(new FormData(f).get('login')).trim(); run(() => addPerson(login), `Added ${login}. Give them a collection in their panel.`, () => show(login.toLowerCase())); f.reset(); }}>
        <input name="login" required maxLength={200} placeholder="Tailscale login or Access email" aria-label="Add a person" autoCapitalize="none" className={`${field} mt-0`} />
        <Button type="submit" disabled={pending}>Add</Button>
      </form>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenLogin(null); }}>
        <SheetContent side="right" className="overflow-y-auto">
          {open && (
            <>
              <SheetHeader className="border-b border-line px-5 pr-12">
                <SheetTitle className="break-all">{open.name ?? open.login}{open.login === me && <span className="font-normal text-fg-3"> (you)</span>}</SheetTitle>
                <SheetDescription className="break-all">{open.name ? `${open.login} · ` : ''}{open.admin ? (open.fromEnv ? 'Admin through ADMIN_USERS' : 'Admin') : 'Not an admin'} · {open.lastSeenAt ? `last seen ${day(open.lastSeenAt)}` : 'not signed in yet'}</SheetDescription>
              </SheetHeader>
              <Tabs value={tab} onValueChange={(v) => setTab(v as 'overview' | 'sessions')} className="px-5 pb-6">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="sessions">Sessions</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="pt-3">
                  <Overview p={open} me={me} collections={collections} passwords={passwords} betterAuth={betterAuth} pending={pending || linking} run={run} askLink={askLink} ask={(kind) => setConfirm({ kind, p: open })} can={can(open)} />
                </TabsContent>
                <TabsContent value="sessions" className="pt-3">
                  <Sessions key={open.login} p={open} betterAuth={betterAuth} confirmAll={() => setConfirm({ kind: 'endAll', p: open })} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog confirm={confirm} close={() => setConfirm(null)} pending={pending} run={run} onDeleted={() => setOpenLogin(null)} />
    </section>
  );
}

const sub = 'flex flex-col gap-2 border-t border-line pt-4';
const h3 = 'font-semibold';

function Overview({ p, me, collections, passwords, betterAuth, pending, run, askLink, ask, can }: {
  p: Person; me: string; collections: Collection[]; passwords: 'reset' | 'set' | null; betterAuth: boolean; pending: boolean; run: Run; askLink: (login: string) => void;
  ask: (kind: Confirm['kind']) => void; can: { act: boolean; impersonate: boolean };
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className={h3}>Role and collections</h3>
        {p.admin ? <p className="text-sm text-fg-3">Admins see and change every collection.</p> : collections.map((c) => <RoleSelect key={c.id} c={c} login={p.login} role={p.roles.find((r) => r.collectionId === c.id)?.role} pending={pending} run={run} />)}
        {p.fromEnv ? <p className="text-xs text-fg-3">An admin through ADMIN_USERS: change it in the server&apos;s settings.</p>
          : p.login !== me && <span><Button size="sm" disabled={pending} onClick={() => run(() => setAdmin(p.login, !p.admin), p.admin ? `${p.login} is no longer an admin.` : `${p.login} is now an admin.`)}>{p.admin ? 'Remove admin' : 'Make admin'}</Button></span>}
      </div>
      {passwords && (
        <div className={sub}>
          <h3 className={h3}>Password</h3>
          <p className="text-sm text-fg-3">{p.password ? 'Has a password.' : 'No password yet.'} Setting one signs them out everywhere else.</p>
          <PasswordForm login={p.login} pending={pending} run={run} />
          {passwords === 'reset' && p.login.includes('@') && <span><Button size="sm" variant="link" disabled={pending} onClick={() => askLink(p.login)}>Get a reset link instead</Button></span>}
        </div>
      )}
      {p.twoFactor && (
        <div className={sub}>
          <h3 className={h3}>Two-factor</h3>
          <p className="text-sm text-fg-3">On. If they lost their phone and their backup codes, reset it: they sign in with their password and can set it up again.</p>
          <span><Button size="sm" disabled={pending} onClick={() => ask('twoFactor')}>Reset two-factor</Button></span>
        </div>
      )}
      {can.impersonate && (
        <div className={sub}>
          <h3 className={h3}>Act as them</h3>
          <p className="text-sm text-fg-3">See Brickfolio with their rights, to check what they can see. You can&apos;t change admin settings meanwhile; a bar under the header stops it.</p>
          <span><Button size="sm" disabled={pending} onClick={() => ask('impersonate')}>Act as {p.name ?? p.login}</Button></span>
        </div>
      )}
      {!betterAuth && <p className="border-t border-line pt-4 text-sm text-fg-3">Acting as someone needs Brickfolio&apos;s own sign-in (AUTH_MODE=better-auth).</p>}
      {can.act && (
        <div className={sub}>
          <h3 className={h3}>Ban or delete</h3>
          {p.ban ? (
            <>
              <p className="text-sm text-fg-3">Banned{p.ban.until ? ` until ${day(p.ban.until)}` : ''}{p.ban.reason ? `: ${p.ban.reason}` : ''}. They can&apos;t sign in or use API tokens.</p>
              <span><Button size="sm" disabled={pending} onClick={() => run(() => unbanPerson(p.login), `${p.login} can sign in again.`)}>Unban</Button></span>
            </>
          ) : <p className="text-sm text-fg-3">A ban signs them out and keeps them out, in every sign-in mode, until it ends. Deleting removes them, their roles, invitations and API tokens.</p>}
          <span className="flex flex-wrap gap-2">
            {!p.ban && <Button size="sm" variant="danger" disabled={pending} onClick={() => ask('ban')}>Ban</Button>}
            <Button size="sm" variant="danger" disabled={pending} onClick={() => ask('delete')}>Delete</Button>
          </span>
        </div>
      )}
    </div>
  );
}

/** The Sessions tab: loads when it opens; end one, or all (with a confirmation). */
function Sessions({ p, betterAuth, confirmAll }: { p: Person; betterAuth: boolean; confirmAll: () => void }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = () => start(async () => { const r = await personSessions(p.login); if (r.ok) { setRows(r.sessions); setError(null); } else setError(r.error); });
  // Loads once when the tab opens (the component is keyed by person).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (betterAuth) load(); }, []);
  if (!betterAuth) return <p className="text-sm text-fg-3">People sign in through your proxy (Tailscale or Cloudflare Access), so Brickfolio keeps no sessions to show or end. Ban and delete still work.</p>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!rows) return <p className="text-sm text-fg-3" role="status">Loading sessions…</p>;
  const end = (id?: string) => start(async () => { const r = await endPersonSessions(p.login, id); if (!r.ok) setError(r.error); else load(); });
  return (
    <div className="flex flex-col gap-3">
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
              <span className="min-w-0 text-sm">
                <span className="font-medium">{device(s.userAgent)}</span>
                {s.current && <Chip tone="primary" className="ml-2">This is you</Chip>}
                {s.impersonated && <Chip tone="warn" className="ml-2">An admin acting as them</Chip>}
                <span className="block text-xs text-fg-3">{s.ip ?? 'Unknown address'} · started {when(s.createdAt)} · last active {when(s.updatedAt)}</span>
              </span>
              <Button size="sm" variant="danger-link" disabled={pending} onClick={() => end(s.id)} aria-label={`End session on ${device(s.userAgent)}`}>End</Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-fg-3">Not signed in anywhere.</p>}
      {rows.length > 0 && <span><Button size="sm" variant="danger" disabled={pending} onClick={confirmAll}>End all sessions</Button></span>}
    </div>
  );
}

const UNTIL = [['never', 'Until I unban them'], ['1', '1 day'], ['7', '7 days'], ['30', '30 days'], ['date', 'Until a date']] as const;

/** One confirmation for ban, delete (type their email), two-factor reset, acting as someone, and ending all sessions. */
function ConfirmDialog({ confirm, close, pending, run, onDeleted }: { confirm: Confirm | null; close: () => void; pending: boolean; run: Run; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const [until, setUntil] = useState<(typeof UNTIL)[number][0]>('never');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tomorrow] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const reset = () => { setTyped(''); setUntil('never'); setDate(''); setReason(''); setError(null); };
  const done = () => { reset(); close(); };
  const p = confirm?.p;
  const who = p ? p.name ?? p.login : '';
  const untilIso = () => (until === 'never' ? null : until === 'date' ? (date ? new Date(`${date}T23:59:59`).toISOString() : '') : new Date(Date.now() + Number(until) * 86_400_000).toISOString());
  const go = () => {
    if (!confirm || !p) return;
    if (confirm.kind === 'ban') { const u = untilIso(); if (u === '') { setError('Choose the date the ban ends.'); return; } run(() => banPerson(p.login, reason, u), `${p.login} is banned and signed out.`, done); return; }
    if (confirm.kind === 'delete') { run(() => deletePerson(p.login), `Deleted ${p.login}.`, () => { done(); onDeleted(); }); return; }
    if (confirm.kind === 'twoFactor') { run(() => resetTwoFactor(p.login), `Two-factor is off for ${p.login}, and they're signed out.`, done); return; }
    if (confirm.kind === 'endAll') { run(() => endPersonSessions(p.login), `${p.login} is signed out everywhere.`, () => { done(); onDeleted(); }); return; }
    start(async () => { const r = await impersonate(p.login); if (!r.ok) { setError(r.error); return; }
      // A full load: the signed-in person changed, so the header (a layout the router keeps) must render again.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/'); });
  };
  const text = confirm && {
    ban: { title: `Ban ${who}?`, body: 'They are signed out now and can’t sign in by any method, or use their API tokens, until the ban ends.', action: 'Ban', danger: true },
    delete: { title: `Delete ${who}?`, body: 'This removes them, their roles in every collection, their invitations and API tokens, and signs them out. It can’t be undone. Their sets stay.', action: 'Delete', danger: true },
    twoFactor: { title: `Reset two-factor for ${who}?`, body: 'Two-factor is turned off and they’re signed out everywhere. They sign in with their password and can turn it on again under Account.', action: 'Reset two-factor', danger: false },
    endAll: { title: `Sign ${who} out everywhere?`, body: 'Every session ends, on every device. They can sign in again.', action: 'End all sessions', danger: true },
    impersonate: { title: `Act as ${who}?`, body: 'You’ll see Brickfolio with their rights only, for up to an hour. Admin settings are off meanwhile; use Stop in the bar under the header to come back.', action: 'Act as them', danger: false },
  }[confirm.kind];
  const blocked = confirm?.kind === 'delete' && typed.trim().toLowerCase() !== p?.login;
  return (
    <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) done(); }}>
      {text && p && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-all">{text.title}</AlertDialogTitle>
            <AlertDialogDescription>{text.body}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirm.kind === 'ban' && (
            <div className="flex flex-col gap-3 text-sm">
              <label className="flex flex-col text-fg-2">Reason (only admins see it)
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={field} placeholder="Optional" />
              </label>
              <label className="flex flex-col text-fg-2">How long
                <select value={until} onChange={(e) => setUntil(e.target.value as typeof until)} className={field}>{UNTIL.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              </label>
              {until === 'date' && <label className="flex flex-col text-fg-2">Ends on<DatePicker label="Ends on" value={date} min={tomorrow} onChange={setDate} required /></label>}
            </div>
          )}
          {confirm.kind === 'delete' && (
            <label className="flex flex-col text-sm text-fg-2">Type <span className="font-medium break-all text-fg">{p.login}</span> to confirm
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoComplete="off" spellCheck={false} className={field} aria-label={`Type ${p.login} to confirm`} />
            </label>
          )}
          {error && <Banner kind="error">{error}</Banner>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <ShadButton variant={text.danger ? 'destructive' : 'default'} disabled={pending || busy || blocked} onClick={go}>{text.action}</ShadButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
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
