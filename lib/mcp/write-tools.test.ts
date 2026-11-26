import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import type { Access } from '../service/permissions';
import * as svc from '../service/sets';
import { handleRpc } from './server';

let db: DB;
const admin: Access = { login: 'me', admin: true, roles: new Map() };
const viewer: Access = { login: 'guest', admin: false, roles: new Map([[1, 'viewer']]) };
const call = async (name: string, args: Record<string, unknown> = {}, access: Access = admin) => {
  const r = (await handleRpc(db, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, access)) as { result?: { isError: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] }; error?: { message: string } };
  return r;
};
const names = async () => ((await handleRpc(db, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean; destructiveHint?: boolean } }[] } }).result.tools;

beforeEach(() => { db = openNodeDb(':memory:').db; vi.stubEnv('MCP_WRITE', 'on'); });
afterEach(() => vi.unstubAllEnvs());

it('lists write tools only with MCP_WRITE=on, marked as not read-only', async () => {
  const tools = await names();
  expect(tools.find((t) => t.name === 'add_set')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  expect(tools.find((t) => t.name === 'remove_copy')?.annotations.destructiveHint).toBe(true);
  expect(tools.find((t) => t.name === 'get_set')?.annotations.readOnlyHint).toBe(true);
  vi.stubEnv('MCP_WRITE', '');
  expect((await names()).some((t) => t.name === 'add_set')).toBe(false);
  expect((await call('add_set', { setNo: '10497' })).error?.message).toMatch(/Unknown tool/);
});

it('adds a set, a copy, marks one sold and removes one', async () => {
  const added = await call('add_set', { setNo: '10497', name: 'Galaxy Explorer', condition: 'New', pricePaid: 99 });
  expect(added.result?.isError).toBe(false);
  expect(added.result?.structuredContent).toMatchObject({ added: '10497', qty: 1 });
  const copy = await call('add_copy', { setNo: '10497', status: 'built', condition: 'Used', hasBox: true });
  const copyId = copy.result?.structuredContent?.copyId as number;
  expect(copy.result?.structuredContent).toMatchObject({ qty: 2 });
  const sold = await call('edit_copy', { copyId, status: 'sold', salePrice: 120, saleFees: 10, soldVia: 'BrickLink' });
  expect(sold.result?.structuredContent).toMatchObject({ qty: 1, sold: 1, copy: { status: 'sold', salePrice: 120, soldDate: svc.today() } });
  const set = await svc.getSet(db, '10497-1');
  const first = set!.copies.find((c) => c.status === 'sealed')!.id;
  expect((await call('remove_copy', { copyId: first })).result?.structuredContent).toMatchObject({ remaining: 0 });
  expect((await call('add_set', { setNo: 'nope' })).result?.isError).toBe(true);
});

it('refuses people without write access, hides copies they cannot see, and refuses in demo mode', async () => {
  await call('add_set', { setNo: '10497' });
  const id = (await svc.getSet(db, '10497-1'))!.copies[0].id;
  expect((await call('add_set', { setNo: '10280' }, viewer)).result?.content[0].text).toMatch(/permission/i);
  expect((await call('edit_copy', { copyId: id, location: null }, viewer)).result?.content[0].text).toMatch(/permission|can't|cannot/i);
  expect((await call('remove_copy', { copyId: id }, { login: 'x', admin: false, roles: new Map([[99, 'owner']]) })).result?.content[0].text).toBe(`Copy ${id} doesn't exist.`);
  expect((await call('add_wish', { setNo: '10316' }, viewer)).result?.isError).toBe(true);
  vi.stubEnv('DEMO_MODE', 'on');
  expect((await call('add_wish', { setNo: '10316' })).result?.content[0].text).toMatch(/demo/i);
});

it('changes the wishlist', async () => {
  expect((await call('add_wish', { setNo: '10316', target: 400 })).result?.structuredContent).toMatchObject({ added: '10316', target: 400 });
  expect((await call('remove_wish', { setNo: '10316' })).result?.structuredContent).toEqual({ removed: '10316' });
  expect((await call('remove_wish', { setNo: '10316' })).result?.isError).toBe(true);
});

it('leaves the write tools out for an OAuth token without mcp:write', async () => {
  const list = (await handleRpc(db, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, admin, { write: false })) as { result: { tools: { name: string }[] } };
  expect(list.result.tools.some((t) => t.name === 'add_set')).toBe(false);
  const r = (await handleRpc(db, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'add_set', arguments: { setNo: '10497' } } }, admin, { write: false })) as { error?: { message: string } };
  expect(r.error?.message).toMatch(/Unknown tool/);
});
