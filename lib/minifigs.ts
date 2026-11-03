// Minifigure totals: pure, so the browser can use them too. The service is lib/service/minifigs.ts.

/** BrickLink minifig numbers: letters, digits, an optional dash part (sw0001, col25-3, hp150a). Stored lowercase. */
export const FIG_NO = /^[a-z]{1,6}\d{1,5}[a-z]?(-\d{1,2})?$/i;

export function minifigTotals(rows: { qty: number; estValue: number | null }[]) {
  return {
    count: rows.length,
    copies: rows.reduce((t, m) => t + m.qty, 0),
    estValue: rows.reduce((t, m) => t + (m.estValue ?? 0) * m.qty, 0),
    unpriced: rows.filter((m) => m.estValue == null).length,
  };
}
