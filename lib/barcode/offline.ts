// What the scanner needs to work without a connection: every saved barcode, and what you own and want. The server
// builds it (offlineMap in resolve.ts, GET /api/v1/barcodes/offline); the browser keeps it and resolves scans with
// localResolve while offline. Framework-free so both sides share it.
import type { Barcode } from './gtin';
import type { ScanCandidate, Source } from './resolve';

export type OfflineSet = { setNo: string; name: string | null; year: number | null; pieces: number | null; imageUrl: string | null; source: Source; verified: boolean };
export type OfflineMap = {
  at: string;
  barcodes: Record<string, OfflineSet[]>; // by GTIN, already filtered to the trusted rows
  owned: Record<string, { qty: number; condition: string | null; location: string | null; name: string }>;
  wished: Record<string, { name: string | null }>;
};

const RANK: Record<string, number> = { user: 0, community: 1, brickset: 2 };

/** Picks the rows a scan should trust, the same way the server does: confirmed ones if any, best source per set. */
export function trusted(rows: OfflineSet[]): OfflineSet[] {
  const pool = rows.some((r) => r.verified) ? rows.filter((r) => r.verified) : rows;
  const by = new Map<string, OfflineSet>();
  for (const r of pool) {
    const prev = by.get(r.setNo);
    if (!prev || (RANK[r.source] ?? 3) < (RANK[prev.source] ?? 3)) by.set(r.setNo, r);
  }
  return [...by.values()];
}

/** A set as the scanner shows it, from the offline map. */
export function offlineCandidate(map: OfflineMap, s: Pick<OfflineSet, 'setNo'> & Partial<OfflineSet>): ScanCandidate {
  const own = map.owned[s.setNo], wish = map.wished[s.setNo];
  return {
    setNo: s.setNo, name: own?.name ?? wish?.name ?? s.name ?? null, year: s.year ?? null, pieces: s.pieces ?? null, theme: null, imageUrl: s.imageUrl ?? null,
    source: s.source ?? 'user', verified: s.verified ?? false,
    owned: own ? { qty: own.qty, condition: own.condition, location: own.location } : null, wished: !!wish,
  };
}

/** Resolves a scan from the offline map, or null when the barcode isn't saved (look it up once back online). */
export function localResolve(map: OfflineMap, b: Barcode): { status: 'matched' | 'ambiguous'; candidates: ScanCandidate[] } | null {
  const rows = trusted(map.barcodes[b.gtin] ?? []);
  if (!rows.length) return null;
  return { status: rows.length === 1 ? 'matched' : 'ambiguous', candidates: rows.map((r) => offlineCandidate(map, r)) };
}
