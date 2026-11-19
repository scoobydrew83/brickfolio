import { describe, expect, it } from 'vitest';
import { csvRows, streamCsv } from './csv';
import { parseCsv } from '../csv';

async function* chunksOf(text: string, size: number) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}
const all = async (it: AsyncIterable<string[]>) => { const out: string[][] = []; for await (const r of it) out.push(r); return out; };

/** A gzipped Response, made with CompressionStream like Rebrickable's .csv.gz files. */
function gzResponse(text: string, init?: ResponseInit): Response {
  const body = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(body, init);
}

const SAMPLE = [
  'set_num,name,year,theme_id,num_parts,img_url',
  '10316-1,"Rivendell, The Lord of the Rings",2023,171,6181,https://x/1.jpg',
  '75192-1,"Millennium Falcon ""UCS""",2017,171,7541,',
  '',
  '42083-1,"Bugatti',
  'Chiron",2018,1,3599,https://x/2.jpg',
  '21318-1,Tree House,2019,575,3036,https://x/3.jpg',
].join('\r\n') + '\r\n';

describe('csvRows', () => {
  it('reads quoted commas, "" escapes, newlines in quotes and CRLF, like parseCsv', async () => {
    const rows = await all(csvRows(chunksOf(SAMPLE, 1 << 20)));
    expect(rows).toEqual(parseCsv(SAMPLE));
    expect(rows[1][1]).toBe('Rivendell, The Lord of the Rings');
    expect(rows[2][1]).toBe('Millennium Falcon "UCS"');
    expect(rows[3][1]).toBe('Bugatti\r\nChiron');
    expect(rows).toHaveLength(5);
  });

  it('gives the same rows however the text is split', async () => {
    const whole = await all(csvRows(chunksOf(SAMPLE, 1 << 20)));
    for (const size of [1, 2, 3, 5, 7, 13]) expect(await all(csvRows(chunksOf(SAMPLE, size)))).toEqual(whole);
  });

  it('handles LF only, no final newline and empty cells', async () => {
    expect(await all(csvRows(chunksOf('a,b\n1,\n,2', 2)))).toEqual([['a', 'b'], ['1', ''], ['', '2']]);
  });
});

describe('streamCsv', () => {
  it('reads a gzipped response', async () => {
    const rows = await all(streamCsv(gzResponse(SAMPLE)));
    expect(rows[0]).toEqual(['set_num', 'name', 'year', 'theme_id', 'num_parts', 'img_url']);
    expect(rows).toHaveLength(5);
  });

  it('streams a large file without reading it all first', async () => {
    const lines = ['inventory_id,part_num,color_id,quantity,is_spare,img_url'];
    for (let i = 0; i < 50_000; i++) lines.push(`${i},3001,${i % 50},2,False,`);
    let n = 0;
    for await (const r of streamCsv(gzResponse(lines.join('\n')))) { n++; if (n === 3) expect(r[0]).toBe('1'); }
    expect(n).toBe(50_001);
  });
});
