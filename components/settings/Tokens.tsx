'use client';
import { useState } from 'react';
import { createToken, revokeToken, type Result } from '@/app/actions';
import { Button, Select, field } from '../ui';

/** A token row from lib/service/tokens.ts listTokens. `owner` null: no owner, acts as admin. */
export type Token = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; owner: string | null };

const EXPIRY = [['', 'Never expires'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']] as const;
const day = (iso: string) => iso.slice(0, 10);

/**
 * API tokens (#90: kept in Better Auth's apiKey table): name, prefix, created, last used and expiry, with revoke and a
 * form for a new one. `all`: an admin's list of everyone's, showing whose each is; else the person's own.
 */
export function TokensSection({ tokens, me, all, pending, run, intro }: {
  tokens: Token[]; me: string; all: boolean; pending: boolean; intro: React.ReactNode;
  run: (fn: () => Promise<Result>, ok: string, after?: (r: Result) => void) => void;
}) {
  const [newToken, setNewToken] = useState<string | null>(null);
  const now = new Date().toISOString();
  return (
    <>
      {intro}
      {newToken && (
        <div className="space-y-1 rounded-control bg-warn-soft p-3 text-sm text-warn ring-1 ring-warn-ring">
          <p className="font-semibold">Copy this token now. It won&apos;t be shown again.</p>
          <code className="block break-all rounded-chip bg-surface px-2 py-1 font-mono text-xs">{newToken}</code>
        </div>
      )}
      <ul className="divide-y divide-line text-sm">
        {tokens.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <b className="break-all">{t.name}</b> <code className="text-xs text-fg-3">{t.prefix}…</code>
              {all && t.owner === null && <span className="text-xs text-fg-3"> · no owner, acts as admin</span>}
              {all && t.owner && t.owner !== me && <span className="break-all text-xs text-fg-3"> · {t.owner}</span>}
            </span>
            <span className="text-xs text-fg-3">
              created {day(t.createdAt)} · {t.lastUsedAt ? `used ${day(t.lastUsedAt)}` : 'never used'}
              {t.expiresAt && (t.expiresAt <= now ? <b className="text-danger"> · expired</b> : ` · expires ${day(t.expiresAt)}`)}
            </span>
            <Button variant="danger-link" onClick={() => run(() => revokeToken(t.id), `Revoked ${t.name}.`)} disabled={pending}>Revoke</Button>
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        const f = e.currentTarget, data = new FormData(f), name = String(data.get('name')), exp = String(data.get('expires') ?? '');
        run(() => createToken(name, exp ? Number(exp) : null), 'Token created.', (r) => { if (r.ok && r.token) setNewToken(r.token); f.reset(); });
      }}>
        <input name="name" required maxLength={60} placeholder="Token name, e.g. iPhone" aria-label="Token name" className={`${field} mt-0 min-w-0 flex-1`} />
        <Select name="expires" aria-label="Expires" defaultValue="" options={EXPIRY} />
        <Button type="submit" disabled={pending}>Create</Button>
      </form>
    </>
  );
}
