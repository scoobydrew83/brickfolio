'use client'; // error boundaries are client components
// The last resort when the root layout itself fails: its own document, with the app's styles so it matches.
import './globals.css';
import { DOCS_TROUBLESHOOTING } from '@/lib/brand';

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <html lang="en">
      <body className="bg-canvas text-fg">
        <title>Brickfolio: something went wrong</title>
        <main role="alert" className="mx-auto max-w-lg space-y-3 px-4 py-24 text-center">
          <h1 className="text-2xl font-extrabold">Brickfolio didn’t start this page</h1>
          <p className="text-fg-3">
            The server hit an error before the page could load. Retry in a moment; if it keeps failing, check the server
            log{digest ? <> for <code>{digest}</code></> : null} and <a className="text-link underline" href={DOCS_TROUBLESHOOTING} target="_blank" rel="noreferrer">Troubleshooting</a>.
          </p>
          <button type="button" onClick={() => retry()} className="rounded-control bg-primary px-4 py-2 font-medium text-on-primary">Retry</button>
        </main>
      </body>
    </html>
  );
}
