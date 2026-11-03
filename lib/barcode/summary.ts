// The one-line answer after adding scanned sets and minifigures. Shared by the server action and the offline queue.
export type ScanAddCounts = { added: number; merged: number; wished: number; alreadyWished: number; waiting: number; figsAdded?: number; figsMerged?: number };

export function scanSummary(r: ScanAddCounts): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    r.added && `Added ${n(r.added, 'set')} to the collection`,
    r.merged && `${n(r.merged, 'set')} you had got more copies`,
    r.wished && `${n(r.wished, 'set')} went on the wishlist`,
    r.alreadyWished && `${n(r.alreadyWished, 'set')} ${r.alreadyWished === 1 ? 'was' : 'were'} already on it`,
    r.figsAdded && `added ${n(r.figsAdded, 'minifigure')}`,
    r.figsMerged && `${n(r.figsMerged, 'minifigure')} you had got more copies`,
  ].filter(Boolean).join(', ');
  const wait = r.waiting ? ` ${n(r.waiting, 'set')} will be looked up on BrickLink at the next sync.` : '';
  return parts ? `${parts.charAt(0).toUpperCase()}${parts.slice(1)}.${wait}` : 'Nothing to add.';
}
