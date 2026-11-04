import Image from 'next/image';
import Link from 'next/link';
import { Box, Pencil, Puzzle } from 'lucide-react';
import { copiesSummary, displayNo, num, type SetRow } from '@/lib/sets';
import { locationLabel, RemoveButton, type RowActions } from './SetCard';
import { Button, CONDITION_TONE, Chip, IconButton } from '../ui';

const th = 'px-3 py-2 font-medium';
const num_ = 'px-3 py-2 text-right tabular-nums';

/** The collection as one dense table: for scanning many sets at a desk. */
export function SetTable({ sets, onEdit, onParts, onRemove, onRetry, pending, money }: { sets: SetRow[] } & RowActions) {
  return (
    <div className="overflow-x-auto rounded-callout border-[1.5px] border-outline bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-fg-3">
          <tr>
            <th className={th}><span className="sr-only">Photo</span></th>
            <th className={th}>Set</th>
            <th className={`${th} text-right`}>Copies</th>
            <th className={th}>Name</th>
            <th className={th}>Theme</th>
            <th className={th}>Location</th>
            <th className={th}>Condition</th>
            <th className={`${th} text-right`}>Year</th>
            <th className={`${th} text-right`}>Pieces</th>
            <th className={`${th} text-right`}>Avg sold</th>
            <th className={`${th} text-right`}>Est. Value</th>
            <th className={th}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sets.map((s) => (
            <tr key={s.id} className="hover:bg-subtle">
              <td className="px-3 py-1.5">
                <span className="flex h-10 w-14 items-center justify-center rounded-chip bg-tile">
                  {s.imageUrl && <Image src={s.imageUrl} alt="" width={56} height={40} className="h-10 w-14 object-contain mix-blend-multiply" />}
                </span>
              </td>
              <td className="px-3 py-2 text-base font-extrabold tabular-nums [font-stretch:112%]">
                <Link href={`/sets/${encodeURIComponent(displayNo(s.setNo))}`} className="hover:text-link">{displayNo(s.setNo)}</Link>
              </td>
              <td className={`${num_} font-bold`} title={copiesSummary(s.copies)}>{s.qty}x</td>
              <td className="px-3 py-2">
                <Link href={`/sets/${encodeURIComponent(displayNo(s.setNo))}`} className="font-medium hover:text-link hover:underline">{s.name}</Link>
                {s.hasModel && (
                  <Link href={`/sets/${encodeURIComponent(displayNo(s.setNo))}?view=3d`} title="Has a 3D model" aria-label="Has a 3D model: open it" className="ml-1.5 inline-flex align-[-2px] text-fg-3 hover:text-link">
                    <Box aria-hidden className="size-4" />
                  </Link>
                )}
                {s.blError && (
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-danger">
                    Lookup failed
                    <Button variant="danger-link" onClick={() => onRetry(s)} disabled={pending} title={s.blError} className="text-xs underline">Retry</Button>
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-fg-3">{s.theme ?? ''}</td>
              <td className="px-3 py-2 text-fg-2">{s.location ?? (s.mixed.location ? locationLabel(s) : '')}</td>
              <td className="px-3 py-2">
                {s.condition ? <Chip tone={CONDITION_TONE[s.condition] ?? 'neutral'}>{s.condition}</Chip> : s.mixed.condition ? <Chip>Mixed</Chip> : null}
                {!!s.missingPct && <span className="ml-1.5 text-xs text-warn">{s.missingPct}% missing</span>}
              </td>
              <td className={num_}>{s.year ?? ''}</td>
              <td className={num_}>{s.pieces ? num(s.pieces).toLocaleString() : ''}</td>
              <td className={num_}>{money(s.avgSold)}</td>
              <td className={`${num_} font-bold`} title={s.qty > 1 ? `${money(s.estValue)} each` : undefined}>{money(s.valueTotal)}</td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <span className="flex items-center justify-end">
                  <IconButton icon={Puzzle} label="Parts list" onClick={() => onParts(s)} />
                  <IconButton icon={Pencil} label="Edit" onClick={() => onEdit(s)} />
                  <RemoveButton s={s} onRemove={() => onRemove(s)} busy={pending} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
