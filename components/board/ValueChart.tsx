import { dailyHistory, type HistoryRow } from '@/lib/sets';
import type { Money } from './ui';

/**
 * Est. Value per day from the saved history, drawn bare so it can sit beside the headline value.
 * Shows a note instead until there are two days to compare.
 */
export function ValueChart({ history, money }: { history: HistoryRow[]; money: Money }) {
  const days = dailyHistory(history);
  if (days.length < 2) {
    return <p className="self-center text-sm text-fg-3">The value history fills in after the next sync. Brickfolio saves the total once a day.</p>;
  }
  const W = 600, H = 140, P = 8; // viewBox size and padding so the end marker isn't clipped
  const t = days.map((d) => Date.parse(d.date));
  const v = days.map((d) => d.estValue);
  const [t0, t1, lo, hi] = [t[0], t[t.length - 1], Math.min(...v), Math.max(...v)];
  const x = (i: number) => P + ((t[i] - t0) / (t1 - t0)) * (W - 2 * P);
  const y = (i: number) => (hi === lo ? H / 2 : P + (1 - (v[i] - lo) / (hi - lo)) * (H - 2 * P));
  const last = days[days.length - 1], change = v[v.length - 1] - v[0];
  const line = days.map((_, i) => `${x(i)},${y(i)}`).join(' ');
  const end = { x: x(days.length - 1), y: y(days.length - 1) };
  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-fg-3">
        <span>Since {days[0].date}</span>
        <span className={change >= 0 ? 'font-semibold text-ok' : 'font-semibold text-danger'}>
          {change >= 0 ? '+' : '−'}{money(Math.abs(change))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-32 w-full" preserveAspectRatio="none" role="img" aria-label={`Est. Value from ${money(v[0])} on ${days[0].date} to ${money(last.estValue)} on ${last.date}`}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        <polygon points={`${x(0)},${H} ${line} ${end.x},${H}`} fill="var(--primary)" fillOpacity={0.22} />
        <polyline points={line} fill="none" stroke="var(--outline)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The last point is HTML so it stays round while the SVG stretches. */}
      <div className="relative -mt-32 h-32" aria-hidden>
        <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-outline bg-primary" style={{ left: `${(end.x / W) * 100}%`, top: `${(end.y / H) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-fg-3"><span>{days[0].date}</span><span>{last.date}</span></div>
    </figure>
  );
}
