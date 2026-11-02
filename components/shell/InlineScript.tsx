/**
 * A script that runs while the HTML is parsed, before first paint. On the client it renders as text/plain so
 * React never runs or warns about it again (pattern from Next's "preventing flash before hydration" guide).
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
