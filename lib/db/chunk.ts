/** D1 allows 100 bound parameters per query, so multi-row inserts go in chunks. */
export async function insertChunked<T extends object>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  if (!rows.length) return;
  const size = Math.max(1, Math.floor(100 / Object.keys(rows[0]).length));
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}
