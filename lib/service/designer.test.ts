import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import type { Alert } from './alerts';
import * as d from './designer';
import * as svc from './sets';
import * as wish from './wishlist';

let db: DB;
const TODAY = '2026-11-03';
beforeEach(() => { db = openNodeDb(':memory:').db; });

it('validates input', () => {
  expect(d.parseProjectInput({ name: 'Lunar Base', setNo: '910038', stage: 'preorder', preorderStart: '2026-11-05', price: '269.99', watching: 'on' }))
    .toEqual({ ok: true, value: { name: 'Lunar Base', setNo: '910038-1', stage: 'preorder', preorderStart: '2026-11-05', price: 269.99, watching: true } });
  expect(d.parseProjectInput({}).ok).toBe(false);
  expect(d.parseProjectInput({ name: 'X', stage: 'maybe' }).ok).toBe(false);
  expect(d.parseProjectInput({ name: 'X', preorderStart: '2026-12-02', preorderEnd: '2026-12-01' }).ok).toBe(false);
  expect(d.parseProjectInput({ name: 'X', url: 'http://insecure' }).ok).toBe(false);
});

it('works out the pre-order window and sorts open ones first, with owned and wished', async () => {
  await d.addProject(db, { name: 'Closed one', preorderStart: '2026-01-01', preorderEnd: '2026-02-01' });
  await d.addProject(db, { name: 'Coming', preorderStart: '2026-11-10' });
  await d.addProject(db, { name: 'Open now', setNo: '910038-1', preorderStart: '2026-11-01', preorderEnd: '2026-11-05' });
  await d.addProject(db, { name: 'Just an idea' });
  await svc.addSet(db, { setNo: '910038-1', name: 'Lunar', condition: 'New' }, { lookup: null });
  await wish.addWish(db, { setNo: '910038-1', name: 'Lunar' }, null);

  const list = await d.listProjects(db, TODAY);
  expect(list.map((p) => [p.name, p.window.state, p.window.days, p.stage])).toEqual([
    ['Open now', 'open', 2, 'preorder'], ['Coming', 'upcoming', 7, 'preorder'], ['Just an idea', 'none', null, 'crowdfunding'], ['Closed one', 'closed', null, 'preorder'],
  ]);
  expect(list[0]).toMatchObject({ owned: 1, wished: true });
});

it('alerts once before a window opens and once before it closes, and re-arms when dates move', async () => {
  const sent: Alert[] = [];
  const send = async (a: Alert) => { sent.push(a); };
  const { project: a } = (await d.addProject(db, { name: 'Coming', preorderStart: '2026-11-08' })) as { project: { id: number } };
  await d.addProject(db, { name: 'Closing', preorderStart: '2026-10-20', preorderEnd: '2026-11-05', price: 199 });
  await d.addProject(db, { name: 'Not watched', preorderStart: '2026-11-04', watching: false });

  expect(await d.notifyDesigner(db, send, 7, TODAY)).toBeNull();
  expect(sent).toHaveLength(1);
  expect(sent[0].title).toBe('2 Designer Program pre-orders need a look');
  expect(sent[0].message).toContain('Coming: pre-order opens 2026-11-08 (in 5 days)');
  expect(sent[0].message).toContain('Closing: pre-order closes 2026-11-05 (in 2 days), $199.00');
  await d.notifyDesigner(db, send, 7, TODAY);
  expect(sent).toHaveLength(1);

  await d.editProject(db, a.id, { preorderStart: '2026-11-09' });
  await d.notifyDesigner(db, send, 7, TODAY);
  expect(sent).toHaveLength(2);
  expect(sent[1].title).toBe('Coming: pre-order opens soon');
  expect(await d.removeProject(db, a.id)).toEqual({ ok: true });
  expect(await d.removeProject(db, a.id)).toMatchObject({ ok: false, status: 404 });
});
