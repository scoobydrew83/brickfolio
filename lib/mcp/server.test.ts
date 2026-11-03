import { beforeEach, expect, it } from 'vitest';
import type { Lookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import * as svc from '../service/sets';
import { handleRpc, TOOLS } from './server';

let db: DB;
const lookup: Lookup = async (no) => ({ blName: `BL ${no}`, year: 2022, categoryId: 1, imageUrl: null, avgSold: 100, minSold: 90, maxSold: 110, qtySold: 5 });
const call = async (name: string, args: object = {}) => {
  const r = await handleRpc(db, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return r!.result as { content: { text: string }[]; structuredContent?: Record<string, unknown>; isError: boolean };
};
beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition: 'New', location: 'Display', qty: 2 }, { lookup });
  await svc.addSet(db, { setNo: '10305-1', name: "Lion Knights' Castle", condition: 'Used', location: 'Shelf' }, { lookup });
});

it('negotiates the protocol version and lists read-only tools', async () => {
  const init = await handleRpc(db, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  expect(init!.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'brickfolio' } });
  const old = await handleRpc(db, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  expect((old!.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
  expect(await handleRpc(db, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  const list = await handleRpc(db, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = (list!.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools;
  expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  expect(await handleRpc(db, { jsonrpc: '2.0', id: 3, method: 'nope' })).toMatchObject({ error: { code: -32601 } });
  expect(await handleRpc(db, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).toMatchObject({ error: { code: -32602 } });
});

it('answers questions about the collection', async () => {
  const sum = await call('collection_summary');
  expect(sum.isError).toBe(false);
  expect(sum.structuredContent).toMatchObject({ currency: 'USD', sets: { count: 2, copies: 3, estValue: 300 }, totalEstValue: 300 });
  expect(JSON.parse(sum.content[0].text).sets.count).toBe(2);

  const found = await call('search_sets', { query: 'castle' });
  expect(found.structuredContent).toMatchObject({ matched: 1, sets: [{ setNo: '10305', location: 'Shelf', estValueEach: 100 }] });

  const one = await call('get_set', { setNo: '10497' });
  expect(one.structuredContent).toMatchObject({ setNo: '10497', qty: 2, estValueTotal: 200, bricklink: { sales: 5 } });
  const missing = await call('get_set', { setNo: '99999' });
  expect(missing).toMatchObject({ isError: true, content: [{ text: "Set 99999 isn't in the collection." }] });

  for (const t of ['list_wishlist', 'retirement_radar', 'designer_program', 'list_minifigures', 'value_history']) expect((await call(t)).isError).toBe(false);
  expect((await call('search_parts', { query: '3001' })).structuredContent).toMatchObject({ total: 0 });
});
