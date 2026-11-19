// Streams Rebrickable's gzipped CSV downloads row by row, so a file of a million rows never sits in memory.
// DecompressionStream and TextDecoderStream are Web APIs: the same code runs on Node and in a Worker.

/**
 * Parses one row starting at `pos`: the cells and where the next row starts, or null when the text ends before the row
 * does (more may come). At the end of the stream (`final`), the text's end ends the row. RFC 4180, like parseCsv() in
 * lib/csv.ts: quoted fields, "" escapes, CRLF or LF, and newlines inside quotes.
 */
function parseRow(text: string, pos: number, final: boolean): { cells: string[]; next: number } | null {
  const cells: string[] = [];
  let cell = '', quoted = false;
  for (let i = pos; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (i + 1 >= text.length && !final) return null; // "" or a closing quote: wait for the next chunk
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else if (c === '\n') { cells.push(cell); return { cells, next: i + 1 }; }
    else if (c === '\r') {
      if (i + 1 >= text.length && !final) return null; // a CRLF split between chunks
      cells.push(cell);
      return { cells, next: text[i + 1] === '\n' ? i + 2 : i + 1 };
    } else cell += c;
  }
  if (!final) return null;
  cells.push(cell);
  return { cells, next: text.length };
}

const blank = (cells: string[]) => cells.length === 1 && cells[0] === '';

/** RFC 4180 rows from text chunks split anywhere. Blank lines are skipped. Only the unfinished row is kept between chunks. */
export async function* csvRows(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  let text = '';
  for await (const chunk of chunks) {
    text += chunk;
    let pos = 0;
    while (pos < text.length) {
      // Fast path for the usual line with no quotes: one indexOf and a split.
      const nl = text.indexOf('\n', pos);
      if (nl === -1) break;
      const line = text.slice(pos, nl);
      if (line.indexOf('"') === -1) {
        const l = line.endsWith('\r') ? line.slice(0, -1) : line;
        if (l.indexOf('\r') === -1) {
          if (l !== '') yield l.split(',');
          pos = nl + 1;
          continue;
        }
      }
      const r = parseRow(text, pos, false);
      if (!r) break;
      if (!blank(r.cells)) yield r.cells;
      pos = r.next;
    }
    text = text.slice(pos);
  }
  let pos = 0;
  while (pos < text.length) {
    const r = parseRow(text, pos, true)!;
    if (!blank(r.cells)) yield r.cells;
    pos = r.next;
  }
}

/** A fetch Response's gzipped body as text chunks. */
export async function* gunzipText(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream()).getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { finished = true; return; }
      yield value;
    }
  } finally {
    // Stopped early (a bad header, an error): stop the download too.
    if (!finished) await reader.cancel().catch(() => {});
  }
}

/** Rows of a gzipped CSV response, header first. */
export const streamCsv = (res: Response): AsyncGenerator<string[]> => csvRows(gunzipText(res));
