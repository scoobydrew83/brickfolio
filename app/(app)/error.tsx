'use client'; // error boundaries are client components
// A page that failed to load: a plain message, Retry, and the reference that matches the server log. When the
// database is the cause, the banner above (components/shell/DbCheck) says what's wrong and how to fix it.
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';
import { DOCS_TROUBLESHOOTING } from '@/lib/brand';

export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <section role="alert" className="mx-auto max-w-lg space-y-3 py-16 text-center">
      <h1 className="text-2xl font-extrabold [font-stretch:110%]">This page didn’t load</h1>
      <p className="text-fg-3">
        Something went wrong on the server. Retry in a moment; if it keeps failing, the server log has the error
        {digest ? <> (look for <code className="rounded-chip bg-muted px-1">{digest}</code>)</> : null}, and{' '}
        <a className="text-link underline" href={DOCS_TROUBLESHOOTING} target="_blank" rel="noreferrer">Troubleshooting</a> covers the common causes.
      </p>
      <Button variant="primary" icon={RefreshCw} onClick={() => retry()}>Retry</Button>
    </section>
  );
}
