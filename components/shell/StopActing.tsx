'use client';
import { useState, useTransition } from 'react';
import { stopImpersonating } from '@/app/actions';

/** Stop in the impersonation bar: back to the admin's own session, then Settings. */
export function StopActing() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const stop = () => start(async () => {
    const r = await stopImpersonating();
    if (!r.ok) { setError(r.error); return; }
    // A full load: the signed-in person changed, so the header (a layout the router keeps) must render again.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/settings');
  });
  return (
    <>
      <button type="button" disabled={pending} onClick={stop} className="font-bold underline underline-offset-2 disabled:opacity-50">Stop</button>
      {error && <span role="alert" className="ml-2">{error}</span>}
    </>
  );
}
