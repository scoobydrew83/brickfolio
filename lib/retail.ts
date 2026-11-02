// Value vs. retail and the retirement watch: pure helpers shared by the server and the browser.
// The data comes from the optional Brickset sync (lib/service/retail.ts).

export const SOON_DAYS = 183; // "retiring soon": expected to retire within about six months

export type RetailFields = { retailPrice?: number | null; retailCurrency?: string | null; exitDate?: string | null; retired?: boolean | null };

/** Today's value against the original retail price, when both are known in the same currency. */
export function retailGain(r: RetailFields & { estValue?: number | null }, currency: string): { retail: number; gainPct: number } | null {
  if (!r.retailPrice || r.retailCurrency !== currency || r.estValue == null) return null;
  return { retail: r.retailPrice, gainPct: Math.round(((r.estValue - r.retailPrice) / r.retailPrice) * 1000) / 10 };
}

/** Retired, retiring within about six months, or neither (or unknown). `today` is YYYY-MM-DD. */
export function retirement(r: RetailFields, today = new Date().toISOString().slice(0, 10)): { kind: 'retired' | 'retiring'; date: string | null } | null {
  if (r.retired || (r.exitDate && r.exitDate < today)) return { kind: 'retired', date: r.exitDate ?? null };
  if (!r.exitDate) return null;
  const soon = new Date(Date.parse(today) + SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  return r.exitDate <= soon ? { kind: 'retiring', date: r.exitDate } : null;
}

/** The availability filter's label for a set, or null when Brickset hasn't said. */
export function availability(r: RetailFields, today?: string): 'Retiring soon' | 'Retired' | 'Available' | null {
  const ret = retirement(r, today);
  if (ret) return ret.kind === 'retired' ? 'Retired' : 'Retiring soon';
  return r.exitDate || r.retired === false ? 'Available' : null;
}

/** Whole-collection value against retail, over the sets whose retail price is known in the collection currency. */
export function collectionGain(rows: (RetailFields & { estValue?: number | null; qty: number })[], currency: string): { sets: number; retail: number; value: number; gainPct: number } | null {
  let retail = 0, value = 0, count = 0;
  for (const r of rows) {
    const g = retailGain(r, currency);
    if (!g || r.estValue == null) continue;
    retail += g.retail * r.qty;
    value += r.estValue * r.qty;
    count++;
  }
  return count ? { sets: count, retail, value, gainPct: Math.round(((value - retail) / retail) * 1000) / 10 } : null;
}
