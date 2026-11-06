'use client';
import { useEffect, useState, useTransition } from 'react';
import { clearImageCache, imageCacheStatus, type ImageCacheStatus, shareCodes, syncCommunityNow, bricksetStatus, downloadLdrawLibrary, ldrawLibraryStatus, rebrickableStatus, syncBricksetNow, syncRebrickableNow, testBricksetKey, testRebrickableKey, type BricksetStatus, type RebrickableStatus, addLocation, createShareLink, createToken, deleteLocation, revokeShareLink, importFile, renameLocation, revokeToken, setCurrency, setValueSource, type Result } from '@/app/actions';
import { Copy } from 'lucide-react';
import { Banner, Button, Select, field } from './ui';
import { PageHeader } from './shell/PageHeader';
import type { LibraryStatus } from '@/lib/ldraw/download';
import type { BarcodeCapabilities } from '@/lib/barcode/providers';
import type { CommunityStatus } from '@/lib/barcode/community';
import Link from 'next/link';

type BarcodeStatus = { caps: BarcodeCapabilities; saved: { total: number; user: number; community: number; brickset: number; providers: number }; community: CommunityStatus };

import type { ShareLinkRow } from '@/lib/service/share';

type Token = { id: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };
type Props = { locations: string[]; currency: string; valueSource: { current: string; options: [string, string][] }; tokens: Token[]; shares: ShareLinkRow[]; user: string; authMode: string; priced: boolean; alerts: boolean; rebrickable: RebrickableStatus; brickset: BricksetStatus; ldraw: LibraryStatus; barcodes: BarcodeStatus };

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';

export default function Settings({ locations, currency, valueSource, tokens, shares, user, authMode, priced, alerts, rebrickable, brickset, ldraw, barcodes }: Props) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const run = (fn: () => Promise<Result & { message?: string }>, okText: string, after?: (r: Result) => void) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { kind: 'ok', text: r.message ?? okText } : { kind: 'error', text: r.error });
      if (r.ok) after?.(r);
    });

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}

      <section className={section}>
        <h2 className={h2}>Locations</h2>
        <ul className="divide-y divide-line">
          {locations.map((l) => <LocationRow key={l} name={l} pending={pending} run={run} />)}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const name = String(new FormData(f).get('name')); run(() => addLocation(name), `Added ${name}.`, () => f.reset()); }}>
          <input name="name" required maxLength={40} placeholder="New location" className={`${field} mt-0`} />
          <Button type="submit" disabled={pending}>Add</Button>
        </form>
      </section>

      <section className={section}>
        <h2 className={h2}>Currency</h2>
        <p className="text-sm text-fg-3">BrickLink prices are fetched in this currency. Run a sync after changing it.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const c = String(new FormData(e.currentTarget).get('currency')); run(() => setCurrency(c), `Currency set to ${c.toUpperCase()}.`); }}>
          <input name="currency" defaultValue={currency} required pattern="[A-Za-z]{3}" maxLength={3} className={`${field} mt-0 w-24 uppercase`} />
          <Button type="submit" disabled={pending}>Save</Button>
        </form>
        <h3 className="pt-2 font-semibold">Value source</h3>
        <p className="text-sm text-fg-3">
          Est. Value comes from this source only; other sources are shown next to it on each set&apos;s page, never mixed in.
          A set with no value from it shows no Est. Value. Sources appear here once they have stored prices.
        </p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('source')); run(() => setValueSource(v), `Est. Value now comes from ${valueSource.options.find(([k]) => k === v)?.[1] ?? v}.`); }}>
          <Select name="source" aria-label="Value source" defaultValue={valueSource.current} options={valueSource.options} disabled={valueSource.options.length < 2} />
          <Button type="submit" disabled={pending || valueSource.options.length < 2}>Save</Button>
        </form>
      </section>

      <section className={section}>
        <h2 className={h2}>Import and export</h2>
        <p className="text-sm text-fg-3">
          Upload a Sets, History or Parts CSV. Columns from the original Google Sheet (&quot;Lego #&quot;, &quot;Set Name&quot;, …) work as-is:
          in Sheets use File → Download → CSV for each tab, and import Sets before Parts. Sets already here are updated by set number.
        </p>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const data = new FormData(f); run(() => importFile(data), 'Imported.', () => f.reset()); }}>
          <input name="file" type="file" accept=".csv,text/csv" required className="min-w-0 max-w-full text-sm file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-fg" />
          <Button type="submit" disabled={pending}>{pending ? 'Importing…' : 'Import'}</Button>
        </form>
        <a href="/api/v1/export.csv" className="inline-block text-sm text-link hover:underline">Download all sets as CSV</a>
      </section>

      <section className={section}>
        <h2 className={h2}>Valuation report</h2>
        <p className="text-sm text-fg-3">
          A PDF for insurance or your records: every set and minifigure with its value, condition and location, how many BrickLink sales each price rests on and when it was fetched, with totals by location.
        </p>
        <form action="/api/v1/report.pdf" method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Name on the report <span className="text-fg-3">(optional)</span>
            <input name="owner" maxLength={80} placeholder="Your name" className={`${field} w-56`} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="photos" value="1" /> Include photos</label>
          <Button type="submit">Download PDF</Button>
        </form>
      </section>

      <ShareSection links={shares} />

      <section className={section}>
        <h2 className={h2}>API tokens</h2>
        <p className="text-sm text-fg-3">
          For scripts and apps: send <code className="rounded-chip bg-muted px-1">Authorization: Bearer &lt;token&gt;</code> to <code className="rounded-chip bg-muted px-1">/api/v1</code>.
          See the <a href="/api/v1/openapi.json" className="text-link hover:underline">OpenAPI spec</a>.
        </p>
        {newToken && (
          <div className="space-y-1 rounded-control bg-warn-soft p-3 text-sm text-warn ring-1 ring-warn-ring">
            <p className="font-semibold">Copy this token now. It won&apos;t be shown again.</p>
            <code className="block break-all rounded-chip bg-surface px-2 py-1 font-mono text-xs">{newToken}</code>
          </div>
        )}
        <ul className="divide-y divide-line text-sm">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-2">
              <span><b>{t.name}</b> <code className="text-xs text-fg-3">{t.prefix}…</code></span>
              <span className="text-xs text-fg-3">{t.lastUsedAt ? `used ${t.lastUsedAt.slice(0, 10)}` : 'never used'}</span>
              <Button variant="danger-link" onClick={() => run(() => revokeToken(t.id), `Revoked ${t.name}.`)} disabled={pending}>Revoke</Button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const name = String(new FormData(f).get('name')); run(() => createToken(name), 'Token created.', (r) => { if (r.ok && r.token) setNewToken(r.token); f.reset(); }); }}>
          <input name="name" required maxLength={60} placeholder="Token name, e.g. iPhone" className={`${field} mt-0`} />
          <Button type="submit" disabled={pending}>Create</Button>
        </form>
      </section>

      <RebrickableSection initial={rebrickable} />
      <BricksetSection initial={brickset} />
      <BarcodeSection status={barcodes} />

      <LdrawSection initial={ldraw} />
      <ImageCacheSection />

      <section className={`${section} text-sm text-fg-2`}>
        <h2 className={`${h2} text-fg`}>About this server</h2>
        <p>Signed in as <b>{user}</b> · Auth mode <b>{authMode}</b> · BrickLink keys <b>{priced ? 'set' : 'not set'}</b> · Rebrickable key <b>{rebrickable.key ? 'set' : 'not set'}</b> · Brickset key <b>{brickset.key ? 'set' : 'not set'}</b> · Wishlist alerts <b>{alerts ? 'on' : 'off'}</b></p>
        {!alerts && <p>To get a message when a wishlist set drops under your target, set <code className="rounded-chip bg-muted px-1">ALERT_WEBHOOK_URL</code> to an ntfy topic, a Discord webhook or any URL that accepts JSON.</p>}
      </section>

      <Credits />
    </div>
  );
}

function LocationRow({ name, pending, run }: { name: string; pending: boolean; run: (fn: () => Promise<Result>, ok: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="py-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const to = String(new FormData(e.currentTarget).get('to')); run(() => renameLocation(name, to), `Renamed ${name} to ${to}.`); setEditing(false); }}>
          <input name="to" defaultValue={name} required maxLength={40} autoFocus className={`${field} mt-0`} />
          <Button type="submit" disabled={pending}>Save</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between py-2 text-sm">
      <span>{name}</span>
      <span className="flex gap-3">
        <Button variant="link" onClick={() => setEditing(true)}>Rename</Button>
        <Button variant="danger-link" onClick={() => run(() => deleteLocation(name), `Deleted ${name}.`)} disabled={pending}>Delete</Button>
      </span>
    </li>
  );
}

/** Rebrickable: whether the key works, how many sets it has matched, and a sync that doesn't need BrickLink. */
function RebrickableSection({ initial }: { initial: RebrickableStatus }) {
  const [st, setSt] = useState(initial);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const running = st.run.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => { const next = await rebrickableStatus(); if (next) setSt(next); }, 3000);
    return () => clearInterval(t);
  }, [running]);
  const refreshStatus = async () => { const next = await rebrickableStatus(); if (next) setSt(next); };
  const { stats: s, run } = st;
  if (!st.key) {
    return (
      <section className={section}>
        <h2 className={h2}>Rebrickable</h2>
        <p className="text-sm text-fg-3">
          Add a free key from your Rebrickable profile (Settings → API) as <code className="rounded-chip bg-muted px-1">REBRICKABLE_API_KEY</code>, then redeploy, to get themes, minifig counts and What can I build?
        </p>
      </section>
    );
  }
  return (
    <section className={section} aria-live="polite">
      <h2 className={h2}>Rebrickable</h2>
      <p className="text-sm text-fg-3">
        {s.sets === 0
          ? 'Add sets, then sync to fill in their themes and minifig counts.'
          : <><b className="text-fg tabular-nums">{s.matched}</b> of {s.sets} sets have a theme{s.notFound ? <>, <span className="tabular-nums">{s.notFound}</span> aren&apos;t on Rebrickable</> : null}{s.waiting ? <>, <span className="tabular-nums">{s.waiting}</span> not checked yet</> : null}. <span className="tabular-nums">{s.builds}</span> alternate builds found{s.builds ? <> (<span className="tabular-nums">{s.buildsWithParts}</span> with parts lists{s.buildsUnavailable ? <>, <span className="tabular-nums">{s.buildsUnavailable}</span> whose parts lists Rebrickable doesn&apos;t share: their designers keep them private or sell them</> : null})</> : null}.</>}
        {' '}Each BrickLink sync adds more; this button runs just the Rebrickable part.
      </p>
      {running && <p className="text-sm font-semibold">{run.step ?? 'Working…'}</p>}
      {!running && run.finishedAt && (run.errors.length
        ? <Banner kind="error">Last Rebrickable sync: {run.errors.slice(0, 3).join('; ')}{run.errors.length > 3 ? `; and ${run.errors.length - 3} more` : ''}</Banner>
        : <p className="text-sm text-ok">Last Rebrickable sync finished without errors.</p>)}
      {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={running} disabled={pending} onClick={() => start(async () => {
          setNote(null);
          const r = await syncRebrickableNow();
          if (!r.ok) setNote({ kind: 'error', text: r.error });
          await refreshStatus();
        })}>
          {running ? 'Syncing…' : 'Sync Rebrickable now'}
        </Button>
        <Button disabled={pending || running} onClick={() => start(async () => {
          const r = await testRebrickableKey();
          setNote(r.ok ? { kind: 'ok', text: 'Rebrickable accepted the key.' } : { kind: 'error', text: r.error });
        })}>
          Test key
        </Button>
      </div>
    </section>
  );
}

/** Brickset: original retail prices and retirement dates, with a key test and a sync button. */
function BricksetSection({ initial }: { initial: BricksetStatus }) {
  const [st, setSt] = useState(initial);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const s = st.stats;
  if (!st.key) {
    return (
      <section className={section}>
        <h2 className={h2}>Brickset</h2>
        <p className="text-sm text-fg-3">
          Add a free key from brickset.com (your account → API) as <code className="rounded-chip bg-muted px-1">BRICKSET_API_KEY</code>, then redeploy, to see each set&apos;s original retail price, your gain over retail, and which sets are retiring.
        </p>
      </section>
    );
  }
  return (
    <section className={section} aria-live="polite">
      <h2 className={h2}>Brickset</h2>
      <p className="text-sm text-fg-3">
        {s.sets === 0 ? 'Add sets, then sync to fill in retail prices and retirement dates.' : (
          <><b className="text-fg tabular-nums">{s.withRetail}</b> of {s.sets} sets have a retail price · <span className="tabular-nums">{s.retiring}</span> retiring soon · <span className="tabular-nums">{s.retired}</span> retired{s.notChecked ? <> · <span className="tabular-nums">{s.notChecked}</span> not checked yet</> : null}.</>
        )}
        {' '}Each sync checks sets Brickset hasn&apos;t been asked about in 30 days.
      </p>
      {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={pending} onClick={() => start(async () => {
          const r = await syncBricksetNow();
          setNote(r.ok ? { kind: 'ok', text: 'Brickset sync finished.' } : { kind: 'error', text: r.error });
          const next = await bricksetStatus();
          if (next) setSt(next);
        })}>Sync Brickset now</Button>
        <Button disabled={pending} onClick={() => start(async () => {
          const r = await testBricksetKey();
          setNote(r.ok ? { kind: 'ok', text: 'Brickset accepted the key.' } : { kind: 'error', text: r.error });
        })}>Test key</Button>
      </div>
    </section>
  );
}

/** Barcode scanning: which lookup services are on, and how many barcodes are saved. Keys live in the server env. */
function BarcodeSection({ status: { caps, saved, community } }: { status: BarcodeStatus }) {
  const on = caps.providers.filter((p) => p.enabled);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [share, setShare] = useState<{ count: number; issueUrl: string | null; href: string } | null>(null);
  const [pending, start] = useTransition();
  const code = (s: string) => <code className="rounded-chip bg-muted px-1">{s}</code>;
  return (
    <section id="barcodes" className={section}>
      <h2 className={h2}>Barcode scanning</h2>
      {!caps.scanning ? <p className="text-sm text-fg-3">Turned off with {code('BARCODE_SCANNING=off')}.</p> : (
        <>
          <p className="text-sm text-fg-3">
            <Link href="/scan" className="font-medium text-link hover:underline">Scan</Link> the UPC or EAN on a box to add it.{' '}
            <b className="text-fg tabular-nums">{saved.total}</b> barcode{saved.total === 1 ? '' : 's'} saved
            {saved.total > 0 && <> ({saved.user} you confirmed, {saved.community} from the community list, {saved.brickset} from Brickset, {saved.providers} from lookup services)</>}.
          </p>
          <p className="text-sm text-fg-3">
            {on.length ? <>Unknown barcodes are looked up with {on.map((p) => p.name).join(', then ')}. </> : <>No lookup service is set up: unknown boxes need their set number typed once, then they&apos;re remembered. </>}
            {caps.brickset ? 'The Brickset sync also saves the barcodes of sets you own or want.' : <>With {code('BRICKSET_API_KEY')} set, the Brickset sync also saves the barcodes of sets you own or want.</>}
          </p>
          <p className="text-sm text-fg-3">
            Optional keys: {code('COMPARETHEBRICKS_API_KEY')} (free key, 250 lookups a day) and {code('BRICKECONOMY_API_KEY')} (needs BrickEconomy Premium; unverified). Order with {code('BARCODE_PROVIDERS')}. See docs/install.md. Only the barcode is sent, never anything about your collection.
          </p>
          <p className="text-sm text-fg-3">
            Minifigure boxes are recognised from their square code using the fan-collected L-Scan table, the community list and the codes you confirm.
          </p>
          <h3 className="pt-2 font-semibold">Community list</h3>
          <p className="text-sm text-fg-3">
            {community.enabled ? <>Barcodes and minifigure codes other collectors confirmed and a maintainer reviewed (CC0): <b className="text-fg tabular-nums">{community.sets}</b> barcodes and <b className="text-fg tabular-nums">{community.minifigs}</b> minifigure codes here{community.syncedAt ? <>, updated {new Date(community.syncedAt).toLocaleDateString()}</> : null}. Downloaded in the daily sync; nothing is sent.</> : <>Turned off with {code('COMMUNITY_LIST=off')}.</>}
          </p>
          {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
          <div className="flex flex-wrap gap-2">
            {community.enabled && <Button loading={pending} onClick={() => start(async () => { const r = await syncCommunityNow(); setNote(r.ok ? { kind: 'ok', text: r.message ?? 'Updated.' } : { kind: 'error', text: r.error }); })}>Update now</Button>}
            <Button disabled={pending} onClick={() => start(async () => {
              const r = await shareCodes();
              if (!r.ok) return setNote({ kind: 'error', text: r.error });
              const count = r.file.sets.length + r.file.minifigs.length;
              setShare({ count, issueUrl: r.issueUrl, href: URL.createObjectURL(new Blob([JSON.stringify(r.file, null, 1)], { type: 'application/json' })) });
            })}>Share my codes</Button>
          </div>
          {share && (
            <div className="space-y-2 rounded-control bg-subtle p-3 text-sm" aria-live="polite">
              {share.count === 0 ? <p className="text-fg-3">You haven’t confirmed any codes yet. Scan a box nobody knows and type its set number (or pick the figure in an opened minifigure box) to confirm one.</p> : (
                <>
                  <p>{share.count} code{share.count === 1 ? '' : 's'} you confirmed. Only barcodes, set numbers and figure names are shared: nothing else about your collection. By sharing you release them under CC0.</p>
                  <p className="flex flex-wrap gap-3">
                    {share.issueUrl && <a href={share.issueUrl} target="_blank" rel="noreferrer" className="font-medium text-link hover:underline">Send as a GitHub issue</a>}
                    <a href={share.href} download="brickfolio-codes.json" className="font-medium text-link hover:underline">Download the file</a>
                  </p>
                  {!share.issueUrl && <p className="text-xs text-fg-3">Too many for a link: attach the file to a new issue, or open a pull request adding them to lib/barcode/data/community.json.</p>}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The LDraw parts library for the 3D view: status, and a button that downloads or updates it on the server. */
function LdrawSection({ initial }: { initial: LibraryStatus }) {
  const [st, setSt] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [starting, start] = useTransition();
  useEffect(() => {
    if (!st.running) return;
    const t = setInterval(async () => { const next = await ldrawLibraryStatus(); if (next) setSt(next); }, 3000);
    return () => clearInterval(t);
  }, [st.running]);
  const mb = (n?: number) => Math.round((n ?? 0) / 1e6);
  const go = () => start(async () => {
    setError(null);
    const r = await downloadLdrawLibrary();
    if (!r.ok) return setError(r.error);
    const next = await ldrawLibraryStatus();
    if (next) setSt(next);
  });
  return (
    <section className={section} aria-live="polite">
      <h2 className={h2}>3D models</h2>
      {st.kind === 'url' ? (
        <p className="text-sm text-fg-3">Parts come from <code className="rounded-chip bg-muted px-1">LDRAW_LIBRARY_URL</code>. Set pages fetch models from LDraw, and the daily sync finds them for sets without one.</p>
      ) : st.kind === null ? (
        <p className="text-sm text-fg-3">Set <code className="rounded-chip bg-muted px-1">LDRAW_LIBRARY_DIR</code> to a folder on the server (Docker and Coolify use <code className="rounded-chip bg-muted px-1">/data/ldraw</code>), then download the library here.</p>
      ) : (
        <>
          <p className="text-sm text-fg-3">
            {st.running
              ? st.progress?.phase === 'extract' ? 'Unzipping the library…' : `Downloading the LDraw parts library… ${mb(st.progress?.got)}${st.progress?.total ? ` of ${mb(st.progress.total)}` : ''} MB`
              : st.ready
                ? `The LDraw parts library is installed${st.downloadedAt ? ` (downloaded ${st.downloadedAt.slice(0, 10)})` : ''}. Set pages fetch models from LDraw (the daily sync does too), or you can upload one.`
                : 'The 3D view needs the LDraw parts library (about 90 MB from library.ldraw.org). It downloads into the data volume and unzips in the background.'}
          </p>
          {(error || st.error) && <Banner kind="error">{error || st.error}</Banner>}
          <Button variant={st.ready ? 'secondary' : 'primary'} loading={st.running || starting} onClick={go}>
            {st.running ? 'Working…' : st.ready ? 'Update the library' : 'Download the LDraw library'}
          </Button>
        </>
      )}
    </section>
  );
}

/** The photo cache behind share pages and offline scanning: where it lives, how much it holds, and a Clear button. */
function ImageCacheSection() {
  const [st, setSt] = useState<ImageCacheStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, startClear] = useTransition();
  useEffect(() => { imageCacheStatus().then(setSt, () => setError('Couldn’t read the image cache.')); }, []);
  const clear = () => startClear(async () => {
    setError(null);
    const r = await clearImageCache();
    if (!r.ok) return setError(r.error);
    setSt(await imageCacheStatus());
  });
  const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  return (
    <section className={section} aria-live="polite">
      <h2 className={h2}>Image cache</h2>
      {!st ? <p className="text-sm text-fg-3">{error ?? 'Reading…'}</p> : st.kind === null ? (
        <p className="text-sm text-fg-3">
          Off. Share pages and the Scan page pass photos through from BrickLink without keeping them. On Docker, set{' '}
          <code className="rounded-chip bg-muted px-1">IMAGE_CACHE_DIR</code>; on Cloudflare, add the <code className="rounded-chip bg-muted px-1">IMAGE_CACHE</code> R2 binding.
        </p>
      ) : (
        <>
          <p className="text-sm text-fg-3">
            {st.count.toLocaleString()} photo{st.count === 1 ? '' : 's'}, {size(st.bytes)}, {st.kind === 'r2' ? 'in R2' : 'on the server’s disk'}.
            Share pages and offline scanning show photos from here, and the daily sync fills in new ones. Clearing is safe: photos are fetched again when needed.
          </p>
          {error && <Banner kind="error">{error}</Banner>}
          <Button variant="secondary" loading={clearing} disabled={!st.count} onClick={clear}>Clear the cache</Button>
        </>
      )}
    </section>
  );
}

const REPO = 'https://github.com/scoobydrew83/brickfolio/blob/main';
const DATA: [string, string, string][] = [
  ['BrickLink', 'https://www.bricklink.com', 'set details, images, parts lists and sold prices'],
  ['Rebrickable', 'https://rebrickable.com', 'themes, minifigure counts and alternate builds'],
  ['Brickset', 'https://brickset.com', 'original retail prices and retirement dates'],
  ['LDraw', 'https://www.ldraw.org', 'the parts library and set models (CC BY 2.0, by the LDraw.org contributors)'],
];
const SOFTWARE: [string, string][] = [
  ['Next.js', 'https://nextjs.org'], ['React', 'https://react.dev'], ['three.js', 'https://threejs.org'], ['Drizzle ORM', 'https://orm.drizzle.team'],
  ['SQLite', 'https://sqlite.org'], ['Lucide', 'https://lucide.dev'], ['Archivo', 'https://github.com/Omnibus-Type/Archivo'],
];
const ext = 'text-link hover:underline';

/** Data sources and open-source software Brickfolio is built on. */
function Credits() {
  return (
    <section className={`${section} text-sm text-fg-3`} aria-labelledby="credits-title">
      <h2 id="credits-title" className={`${h2} text-fg`}>Credits</h2>
      <ul className="space-y-1">
        {DATA.map(([name, href, what]) => (
          <li key={name}><a href={href} target="_blank" rel="noreferrer" className={`${ext} font-semibold`}>{name}</a>: {what}.</li>
        ))}
      </ul>
      <p>Each service is used with your own key and under its own terms. This app uses the BrickLink API but is not endorsed or certified by BrickLink. LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this project.</p>
      <p>
        Built with{' '}
        {SOFTWARE.map(([name, href], i) => (
          <span key={name}>{i ? (i === SOFTWARE.length - 1 ? ' and ' : ', ') : ''}<a href={href} target="_blank" rel="noreferrer" className={ext}>{name}</a></span>
        ))}
        . Every bundled package and its license: <a href={`${REPO}/THIRD_PARTY_NOTICES.md`} target="_blank" rel="noreferrer" className={ext}>third-party notices</a> · <a href={`${REPO}/NOTICE`} target="_blank" rel="noreferrer" className={ext}>NOTICE</a>.
      </p>
    </section>
  );
}

/** Read-only links to the collection, for people without access to the app. The URL is shown once. */
function ShareSection({ links }: { links: ShareLinkRow[] }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [expiry, setExpiry] = useState('never');
  const opts = (l: ShareLinkRow) => [l.showValues && 'values', l.showLocations && 'locations', l.showNotes && 'notes', l.showMinifigs && 'minifigures'].filter(Boolean).join(', ') || 'sets only';
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
  return (
    <section className={section} aria-labelledby="share-title">
      <h2 id="share-title" className={h2}>Share links</h2>
      <p className="text-sm text-fg-3">
        A read-only page of your sets for someone without access to the app: no editing, no settings, and no locations, notes or values unless you turn them on.
        To reach it from outside your tailnet or Access, see <a href="https://github.com/scoobydrew83/brickfolio/blob/main/docs/install.md#share-a-read-only-link" className="text-link hover:underline">Share a read-only link</a>.
      </p>
      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}
      {url && (
        <div className="space-y-1 rounded-control bg-warn-soft p-3 text-sm text-warn ring-1 ring-warn-ring">
          <p className="font-semibold">Copy this link now. It won&apos;t be shown again.</p>
          <code className="block break-all rounded-chip bg-surface px-2 py-1 font-mono text-xs">{url}</code>
          <Button size="sm" icon={Copy} onClick={() => navigator.clipboard.writeText(url).then(() => setMessage({ kind: 'ok', text: 'Link copied.' }), () => {})}>Copy</Button>
        </div>
      )}
      <ul className="divide-y divide-line text-sm">
        {links.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
            <span><b>{l.name}</b> <code className="text-xs text-fg-3">{l.prefix}…</code> <span className="text-xs text-fg-3">· {opts(l)}</span></span>
            <span className="text-xs text-fg-3">
              created {day(l.createdAt)} · {l.expiresAt ? (l.expired ? `expired ${day(l.expiresAt)}` : `expires ${day(l.expiresAt)}`) : 'never expires'} · {l.lastViewedAt ? `viewed ${l.views}×, last ${day(l.lastViewedAt)}` : 'not viewed yet'}
            </span>
            <Button variant="danger-link" disabled={pending} onClick={() => start(async () => {
              const r = await revokeShareLink(l.id);
              setMessage(r.ok ? { kind: 'ok', text: `Revoked ${l.name}. The link stopped working.` } : { kind: 'error', text: r.error });
            })}>Revoke</Button>
          </li>
        ))}
      </ul>
      <form
        className="space-y-3 rounded-control border border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget, d = new FormData(f);
          const form = {
            name: d.get('name'), showValues: d.get('showValues') === 'on', showLocations: d.get('showLocations') === 'on', showNotes: d.get('showNotes') === 'on',
            showMinifigs: d.get('showMinifigs') === 'on', expires: expiry === 'date' ? d.get('expiresOn') : expiry,
          };
          start(async () => {
            const r = await createShareLink(form);
            if (!r.ok) return setMessage({ kind: 'error', text: r.error });
            setUrl(r.url ?? null); setMessage(null); f.reset(); setExpiry('never');
          });
        }}
      >
        <input name="name" required maxLength={60} placeholder="Who it's for, e.g. For Dad" aria-label="Link name" className={`${field} mt-0`} />
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <legend className="sr-only">What the link shows</legend>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="showValues" className="size-4" />Show values</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="showLocations" className="size-4" />Show locations</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="showNotes" className="size-4" />Show notes</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="showMinifigs" defaultChecked className="size-4" />Include minifigures</label>
        </fieldset>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="block">Expires
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={field}>
              <option value="never">Never</option><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="date">On a date</option>
            </select>
          </label>
          {expiry === 'date' && <input type="date" name="expiresOn" required aria-label="Expiry date" className={field} />}
          <Button type="submit" variant="primary" loading={pending}>Create link</Button>
        </div>
      </form>
    </section>
  );
}
