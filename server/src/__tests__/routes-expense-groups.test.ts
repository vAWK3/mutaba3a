import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-267: expense groups on hosted profiles (ADR-094) — one test per acceptance criterion, plus the review findings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `g-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function setup() {
  const store = new MemoryLedgerStore();
  // 18 Oct 2026 in Asia/Jerusalem.
  const clock = { now: new Date('2026-10-18T09:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  const firm = async () => {
    const org = await read(await app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
    const key = await read(await app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
    return { id: org.id as string, auth: { authorization: `Bearer ${key.secret}` } };
  };
  const a = await firm();
  const b = await firm();
  const email = `trip${++seq}@firm.ps`;
  const created = await provisionUser(app, { email, displayName: 'Nour Haddad', organizationId: a.id });
  await app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId: b.id }, admin));
  const res = await app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile = a.id, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });

  const expense = async (body: Record<string, unknown>, profile = a.id) =>
    read(await app.request('/v1/expenses', json({ occurredOn: '2026-10-05', amount: '10.000', currency: 'JOD', ...body }, { ...as(profile), ...idem() })));
  const group = async (body: Record<string, unknown> = {}, profile = a.id) =>
    app.request('/v1/expense-groups', json({ name: 'Jordan trip', startOn: '2026-10-03', endOn: '2026-10-07', ...body }, { ...as(profile), ...idem() }));
  const newGroup = async (body: Record<string, unknown> = {}) => read(await group(body));
  const summary = async (groupId: string) => read(await app.request(`/v1/expense-groups/${groupId}/summary`, { headers: as() }));
  const members = async (groupId: string, membership = 'member') =>
    (await read(await app.request(`/v1/expenses?groupId=${groupId}&groupMembership=${membership}&limit=100`, { headers: as() }))).items.map((e: Loose) => e.id as string);
  const mark = (groupId: string, expenseId: string, mode: 'excluded' | 'included') => app.request(`/v1/expense-groups/${groupId}/expenses/${expenseId}`, json({ mode }, as(), 'PUT'));
  const reset = (groupId: string, expenseId: string) => app.request(`/v1/expense-groups/${groupId}/expenses/${expenseId}`, { method: 'DELETE', headers: as() });
  return { app, store, clock, a, b, as, expense, group, newGroup, summary, members, mark, reset, userId: created.user.id as string };
}

describe('POST/GET/PATCH/DELETE /v1/expense-groups', () => {
  it('creates a group with its window end, totals and version, and reads it back', async () => {
    const t = await setup();
    const res = await t.group({ name: '  Jordan trip ', endOn: undefined, notes: 'with family' });
    expect(res.status).toBe(201);
    const g = await read(res);
    expect(g).toMatchObject({ name: 'Jordan trip', startOn: '2026-10-03', endOn: null, windowEnd: '2027-10-03', notes: 'with family', currencies: [], memberCount: 0, version: 1 });
    const detail = await read(await t.app.request(`/v1/expense-groups/${g.id}`, { headers: t.as() }));
    expect(detail).toMatchObject({ id: g.id, excludedCount: 0 });
    expect(detail).not.toHaveProperty('includedCount');
  });

  it('replays an Idempotency-Key, and refuses a stale If-Match with 409', async () => {
    const t = await setup();
    const headers = { ...t.as(), ...idem() };
    const first = await t.app.request('/v1/expense-groups', json({ name: 'x', startOn: '2026-10-03' }, headers));
    const again = await t.app.request('/v1/expense-groups', json({ name: 'x', startOn: '2026-10-03' }, headers));
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    const g = await read(first);
    expect((await t.app.request(`/v1/expense-groups/${g.id}`, json({ name: 'y' }, { ...t.as(), 'if-match': '1' }, 'PATCH'))).status).toBe(200);
    const stale = await t.app.request(`/v1/expense-groups/${g.id}`, json({ name: 'z' }, { ...t.as(), 'if-match': '1' }, 'PATCH'));
    expect(stale.status).toBe(409);
    expect((await read(stale)).error.details.reason).toBe('VERSION_MISMATCH');
  });

  it('AC9: refuses bad ranges with 422 and the reason (END_BEFORE_START, GROUP_RANGE_TOO_LONG, DATE_INVALID floor, NAME_REQUIRED), merged on PATCH', async () => {
    const t = await setup();
    const reason = async (res: Response) => ({ status: res.status, reason: (await read(res)).error.details.reason });
    expect(await reason(await t.group({ endOn: '2026-10-01' }))).toEqual({ status: 422, reason: 'END_BEFORE_START' });
    expect(await reason(await t.group({ startOn: '2026-01-01', endOn: '2027-01-02' }))).toEqual({ status: 422, reason: 'GROUP_RANGE_TOO_LONG' });
    expect(await reason(await t.group({ startOn: '2015-01-01', endOn: '2015-02-01' }))).toEqual({ status: 422, reason: 'DATE_INVALID' });
    expect(await reason(await t.group({ name: '   ' }))).toEqual({ status: 422, reason: 'NAME_REQUIRED' });
    const g = await t.newGroup();
    expect(await reason(await t.app.request(`/v1/expense-groups/${g.id}`, json({ endOn: '2026-10-01' }, { ...t.as(), 'if-match': '1' }, 'PATCH')))).toEqual({ status: 422, reason: 'END_BEFORE_START' });
  });

  it('lists newest start first with per-currency totals and memberCount (3A); deleted groups drop out, their expenses stay (AC5)', async () => {
    const t = await setup();
    const older = await t.newGroup({ name: 'Amman', startOn: '2026-09-01', endOn: '2026-09-30' });
    const g = await t.newGroup();
    await t.expense({ amount: '12.500' });
    await t.expense({ amount: '40.00', currency: 'USD', occurredOn: '2026-10-06' });
    await t.expense({ occurredOn: '2026-09-10', amount: '3.000' });
    const list = await read(await t.app.request('/v1/expense-groups', { headers: t.as() }));
    expect(list.items.map((x: Loose) => x.id)).toEqual([g.id, older.id]);
    expect(list.items[0]).toMatchObject({ memberCount: 2, currencies: [{ currency: 'JOD', total: '12.500', count: 1 }, { currency: 'USD', total: '40.00', count: 1 }] });
    const s = await t.summary(g.id);
    expect(s.currencies.map((c: Loose) => [c.currency, c.total, c.count])).toEqual(list.items[0].currencies.map((c: Loose) => [c.currency, c.total, c.count]));

    expect((await t.app.request(`/v1/expense-groups/${g.id}`, { method: 'DELETE', headers: t.as() })).status).toBe(204);
    expect((await t.app.request(`/v1/expense-groups/${g.id}`, { method: 'DELETE', headers: t.as() })).status).toBe(204);
    expect((await t.app.request(`/v1/expense-groups/${g.id}/summary`, { headers: t.as() })).status).toBe(404);
    expect((await read(await t.app.request('/v1/expense-groups', { headers: t.as() }))).items.map((x: Loose) => x.id)).toEqual([older.id]);
    expect((await read(await t.app.request('/v1/expenses', { headers: t.as() }))).items).toHaveLength(3);
  });
});

describe('membership (MUT-267 acceptance criteria)', () => {
  it('AC1: a 3–7 Oct group includes a 5 Oct expense logged on 9 Oct', async () => {
    const t = await setup();
    const g = await t.newGroup();
    t.clock.now = new Date('2026-10-09T09:00:00Z');
    const e = await t.expense({ occurredOn: '2026-10-05' });
    expect(await t.members(g.id)).toEqual([e.id]);
    expect((await t.summary(g.id)).currencies[0]).toMatchObject({ currency: 'JOD', total: '10.000', count: 1 });
  });

  it('MUT-272: a member moved to another currency is summed under its new currency, with day buckets that still add up', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const e = await t.expense({ occurredOn: '2026-10-05', amount: '120.50', currency: 'ILS' });
    expect((await t.summary(g.id)).currencies.map((c: Loose) => c.currency)).toEqual(['ILS']);
    const moved = await t.app.request(`/v1/expenses/${e.id}`, json({ amount: '1.234', currency: 'JOD' }, { ...t.as(), 'if-match': '1' }, 'PATCH'));
    expect(moved.status).toBe(200);
    const s = await t.summary(g.id);
    expect(s.currencies).toHaveLength(1);
    expect(s.currencies[0]).toMatchObject({ currency: 'JOD', total: '1.234', count: 1 });
    const thousandths = (x: string) => Math.round(Number(x) * 1000);
    expect(s.currencies[0].byDay.reduce((sum: number, d: Loose) => sum + thousandths(d.total), 0)).toBe(1234);
    const listed = async (currency: string) => read(await t.app.request(`/v1/expenses?currency=${currency}`, { headers: t.as() }));
    expect((await listed('JOD')).items.map((x: Loose) => x.id)).toEqual([e.id]);
    expect((await listed('ILS')).items).toEqual([]);
  });

  it('AC2: leaving out drops it from the summary and the member list; reset brings it back', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const e = await t.expense({});
    const put = await t.mark(g.id, e.id, 'excluded');
    expect(put.status).toBe(200);
    expect(await read(put)).toMatchObject({ groupId: g.id, expenseId: e.id, mode: 'excluded' });
    expect(await t.members(g.id)).toEqual([]);
    expect(await t.members(g.id, 'excluded')).toEqual([e.id]);
    expect((await t.summary(g.id)).currencies).toEqual([]);
    expect((await read(await t.app.request(`/v1/expense-groups/${g.id}`, { headers: t.as() }))).excludedCount).toBe(1);
    expect((await t.reset(g.id, e.id)).status).toBe(204);
    expect((await t.reset(g.id, e.id)).status).toBe(204);
    expect(await t.members(g.id)).toEqual([e.id]);
  });

  it('AC3: a kept 12 Sep expense counts in the totals and sits in a before bucket', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const flight = await t.expense({ occurredOn: '2026-09-12', amount: '120.000' });
    await t.mark(g.id, flight.id, 'included');
    const s = await t.summary(g.id);
    expect(s).toMatchObject({ seriesFrom: '2026-10-03', seriesTo: '2026-10-07' });
    expect(s.currencies[0]).toMatchObject({ currency: 'JOD', total: '120.000', count: 1 });
    expect(s.currencies[0].byDay[0]).toEqual({ date: '2026-09-12', position: 'before', total: '120.000', count: 1 });
  });

  it('AC4: moving an expense out of range removes it, unless it was kept', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const moved = await t.expense({});
    const kept = await t.expense({});
    await t.mark(g.id, kept.id, 'included');
    for (const e of [moved, kept]) await t.app.request(`/v1/expenses/${e.id}`, json({ occurredOn: '2026-10-15' }, { ...t.as(), 'if-match': '1' }, 'PATCH'));
    expect(await t.members(g.id)).toEqual([kept.id]);
  });

  it('AC5: a deleted expense leaves every group', async () => {
    const t = await setup();
    const g1 = await t.newGroup();
    const g2 = await t.newGroup({ name: 'Amman', startOn: '2026-10-05', endOn: '2026-10-05' });
    const e = await t.expense({});
    await t.app.request(`/v1/expenses/${e.id}`, { method: 'DELETE', headers: t.as() });
    expect(await t.members(g1.id)).toEqual([]);
    expect(await t.members(g2.id)).toEqual([]);
  });

  it('AC6 + AC7: currencies stay apart, no converted block, and empty days are zero', async () => {
    const t = await setup();
    const g = await t.newGroup();
    await t.expense({ amount: '10.000' });
    await t.expense({ amount: '40.00', currency: 'USD', occurredOn: '2026-10-04' });
    await t.expense({ amount: '85.00', currency: 'ILS', occurredOn: '2026-10-07' });
    const s = await t.summary(g.id);
    expect(s).not.toHaveProperty('converted');
    expect(s.currencies.map((c: Loose) => [c.currency, c.total])).toEqual([['ILS', '85.00'], ['JOD', '10.000'], ['USD', '40.00']]);
    const jod = s.currencies.find((c: Loose) => c.currency === 'JOD');
    expect(jod.byDay.map((d: Loose) => [d.date, d.total, d.position])).toEqual([
      ['2026-10-03', '0.000', 'in'], ['2026-10-04', '0.000', 'in'], ['2026-10-05', '10.000', 'in'], ['2026-10-06', '0.000', 'in'], ['2026-10-07', '0.000', 'in'],
    ]);
  });

  it('6A: a future-dated member of an open group gets an after bucket, so buckets sum to the total', async () => {
    const t = await setup();
    const g = await t.newGroup({ endOn: undefined });
    await t.expense({ occurredOn: '2026-10-05', amount: '10.000' });
    await t.expense({ occurredOn: '2026-10-23', amount: '80.000' });
    const s = await t.summary(g.id);
    expect(s).toMatchObject({ seriesFrom: '2026-10-03', seriesTo: '2026-10-18' });
    const jod = s.currencies[0];
    expect(jod.byDay.at(-1)).toEqual({ date: '2026-10-23', position: 'after', total: '80.000', count: 1 });
    expect(jod.byDay.reduce((n: number, d: Loose) => n + d.count, 0)).toBe(jod.count);
  });

  it('R6: an open group collects nothing dated more than a year after its start', async () => {
    const t = await setup();
    const g = await t.newGroup({ startOn: '2025-10-01', endOn: undefined });
    const inside = await t.expense({ occurredOn: '2026-10-01' });
    await t.expense({ occurredOn: '2026-10-02' });
    expect(await t.members(g.id)).toEqual([inside.id]);
    expect((await t.summary(g.id)).seriesTo).toBe('2026-10-01');
  });

  it('22A: a left-out expense moved out of the window drops from the excluded list and count', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const e = await t.expense({});
    await t.mark(g.id, e.id, 'excluded');
    await t.app.request(`/v1/expenses/${e.id}`, json({ occurredOn: '2026-10-20' }, { ...t.as(), 'if-match': '1' }, 'PATCH'));
    expect(await t.members(g.id, 'excluded')).toEqual([]);
    expect((await read(await t.app.request(`/v1/expense-groups/${g.id}`, { headers: t.as() }))).excludedCount).toBe(0);
  });

  it('?expenseId= returns the groups an expense belongs to: in range, kept; not when left out', async () => {
    const t = await setup();
    const trip = await t.newGroup();
    const amman = await t.newGroup({ name: 'Amman', startOn: '2026-09-01', endOn: '2026-09-30' });
    const istanbul = await t.newGroup({ name: 'Istanbul', startOn: '2026-10-04', endOn: '2026-10-06' });
    const e = await t.expense({});
    await t.mark(amman.id, e.id, 'included');
    await t.mark(istanbul.id, e.id, 'excluded');
    const res = await read(await t.app.request(`/v1/expense-groups?expenseId=${e.id}`, { headers: t.as() }));
    expect(res.items.map((x: Loose) => x.id).sort()).toEqual([trip.id, amman.id].sort());
  });

  it('C4: an anchor on a non-member starts the page at its position without listing it', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const member = await t.expense({ occurredOn: '2026-10-04' });
    const outside = await t.expense({ occurredOn: '2026-10-05' });
    await t.mark(g.id, outside.id, 'excluded');
    const page = await read(await t.app.request(`/v1/expenses?groupId=${g.id}&anchor=${outside.id}`, { headers: t.as() }));
    expect(page.items.map((x: Loose) => x.id)).toEqual([member.id]);
  });
});

describe('access (MUT-267 AC8, A1)', () => {
  it('another profile’s group and expense are 404s; an unknown group in ?groupId is a 404', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const theirs = await t.expense({}, t.b.id);
    expect((await t.mark(g.id, theirs.id, 'included')).status).toBe(404);
    expect((await t.app.request(`/v1/expense-groups/${g.id}`, { headers: t.as(t.b.id) })).status).toBe(404);
    expect((await t.app.request(`/v1/expenses?groupId=${g.id}`, { headers: t.as(t.b.id) })).status).toBe(404);
    expect((await t.app.request(`/v1/expense-groups/${g.id}/summary`, { headers: t.as(t.b.id) })).status).toBe(404);
  });

  it('Malafat’s key is refused on every group operation', async () => {
    const t = await setup();
    const doc = (await read(await t.app.request('/openapi.json'))) as { paths: Record<string, Record<string, unknown>> };
    const ops = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith('/v1/expense-groups'))
      .flatMap(([path, item]) => ['get', 'post', 'put', 'patch', 'delete'].filter((m) => item[m]).map((m) => [m.toUpperCase(), path] as const));
    expect(ops).toHaveLength(8);
    for (const [method, path] of ops) {
      const res = await t.app.request(path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-0000000000aa'), { method, headers: { ...t.a.auth, 'content-type': 'application/json', ...idem(), 'if-match': '1' }, ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }) });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await read(res)).error.code, `${method} ${path}`).toBe('PRINCIPAL_NOT_ACCEPTED');
    }
  });
});

describe('pre-landing review fixes (MUT-267)', () => {
  const groupAudit = async (t: Awaited<ReturnType<typeof setup>>) =>
    (await t.store.audit.list(t.a.id, {}, { limit: 500, cursor: null })).items.filter((x) => x.entityType === 'expense_group');

  it('refuses group dates more than ten years ahead with 422 DATE_INVALID bound future', async () => {
    const t = await setup();
    const res = await t.group({ startOn: '9998-12-31', endOn: '9999-12-31' });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'DATE_INVALID', bound: 'future' });
  });

  it('groupMembership without groupId is a 422, never the whole ledger', async () => {
    const t = await setup();
    const res = await t.app.request('/v1/expenses?groupMembership=excluded', { headers: t.as() });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.reason).toBe('GROUP_ID_REQUIRED');
  });

  it('an unchanged PATCH keeps the version and writes no audit; a stale If-Match is a 409 before range checks', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const same = await t.app.request(`/v1/expense-groups/${g.id}`, json({ name: 'Jordan trip', startOn: '2026-10-03' }, { ...t.as(), 'if-match': '1' }, 'PATCH'));
    expect(same.status).toBe(200);
    expect((await read(same)).version).toBe(1);
    expect((await groupAudit(t)).map((x) => x.action)).toEqual(['expense_group.created']);
    await t.app.request(`/v1/expense-groups/${g.id}`, json({ name: 'Jordan', startOn: '2026-10-03', endOn: '2026-10-07' }, { ...t.as(), 'if-match': '1' }, 'PATCH'));
    const stale = await t.app.request(`/v1/expense-groups/${g.id}`, json({ endOn: '2026-10-01' }, { ...t.as(), 'if-match': '1' }, 'PATCH'));
    expect(stale.status).toBe(409);
    expect(((await groupAudit(t)).find((x) => x.action === 'expense_group.updated')?.metadata as { fields: string[] }).fields).toEqual(['name']);
  });

  it('audits every group write once as the person; a repeated mark, a repeat delete and clearing an absent mark write nothing', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const e = await t.expense({});
    await t.app.request(`/v1/expense-groups/${g.id}`, json({ name: 'y' }, { ...t.as(), 'if-match': '1' }, 'PATCH'));
    await t.mark(g.id, e.id, 'excluded');
    await t.mark(g.id, e.id, 'excluded');
    await t.reset(g.id, e.id);
    await t.reset(g.id, e.id);
    await t.app.request(`/v1/expense-groups/${g.id}`, { method: 'DELETE', headers: t.as() });
    await t.app.request(`/v1/expense-groups/${g.id}`, { method: 'DELETE', headers: t.as() });
    const rows = await groupAudit(t);
    expect(rows.map((x) => x.action).sort()).toEqual(['expense_group.created', 'expense_group.deleted', 'expense_group.expense_marked', 'expense_group.expense_unmarked', 'expense_group.updated']);
    for (const x of rows) expect(x).toMatchObject({ actorType: 'USER', actorId: t.userId });
  });

  it('every write on another profile’s or an unknown group is a 404 and changes nothing; ?expenseId= 404s for an unknown expense', async () => {
    const t = await setup();
    const g = await t.newGroup();
    const e = await t.expense({});
    const ghost = '00000000-0000-4000-8000-0000000000bb';
    for (const [profile, id] of [[t.b.id, g.id], [t.a.id, ghost]] as const) {
      const h = t.as(profile);
      expect((await t.app.request(`/v1/expense-groups/${id}`, json({ name: 'x' }, { ...h, 'if-match': '1' }, 'PATCH'))).status).toBe(404);
      expect((await t.app.request(`/v1/expense-groups/${id}`, { method: 'DELETE', headers: h })).status).toBe(404);
      expect((await t.app.request(`/v1/expense-groups/${id}/expenses/${e.id}`, json({ mode: 'included' }, h, 'PUT'))).status).toBe(404);
      expect((await t.app.request(`/v1/expense-groups/${id}/expenses/${e.id}`, { method: 'DELETE', headers: h })).status).toBe(404);
    }
    expect((await t.app.request(`/v1/expense-groups?expenseId=${ghost}`, { headers: t.as() })).status).toBe(404);
    expect(await read(await t.app.request(`/v1/expense-groups/${g.id}`, { headers: t.as() }))).toMatchObject({ name: 'Jordan trip', version: 1 });
  });

  it('lists every group across the 4-at-a-time totals chunks, in order, each with its own count', async () => {
    const t = await setup();
    const ids: string[] = [];
    for (let d = 1; d <= 6; d++) ids.unshift((await t.newGroup({ name: `g${d}`, startOn: `2026-10-0${d}`, endOn: `2026-10-0${d}` })).id);
    await t.expense({ occurredOn: '2026-10-05' });
    const list = await read(await t.app.request('/v1/expense-groups', { headers: t.as() }));
    expect(list.items.map((x: Loose) => x.id)).toEqual(ids);
    expect(list.items.map((x: Loose) => x.memberCount)).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('summarizes past one 200-row page: every member counted, buckets sum to the total', async () => {
    const t = await setup();
    const g = await t.newGroup();
    for (let i = 0; i < 205; i++) {
      await t.store.expenses.create({ organizationId: t.a.id, occurredOn: `2026-10-0${3 + (i % 5)}`, amountMinor: 1_000n, currency: 'JOD', title: null, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, createdByUserId: t.userId }, t.clock.now);
    }
    const jod = (await t.summary(g.id)).currencies[0];
    expect(jod).toMatchObject({ currency: 'JOD', count: 205, total: '205.000' });
    expect(jod.byDay.reduce((n: number, d: Loose) => n + d.count, 0)).toBe(205);
  });

  it('refuses a 201st live group with 422 GROUP_LIMIT; deleting one makes room', async () => {
    const t = await setup();
    let last = '';
    for (let i = 0; i < 200; i++) last = (await t.store.expenseGroups.create({ organizationId: t.a.id, name: `g${i}`, startOn: '2026-10-03', endOn: null, notes: null, createdByUserId: t.userId }, t.clock.now)).id;
    const over = await t.group();
    expect(over.status).toBe(422);
    expect((await read(over)).error.details).toMatchObject({ reason: 'GROUP_LIMIT', max: 200 });
    await t.app.request(`/v1/expense-groups/${last}`, { method: 'DELETE', headers: t.as() });
    expect((await t.group()).status).toBe(201);
  });
});
