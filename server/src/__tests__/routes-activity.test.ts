import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-175: GET /v1/summaries/activity — the per-profile figures behind portal Reports (plan §4.2, D1, D2, S1). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
let seq = 0;
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function setup(now = '2026-10-20T09:00:00Z') {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date(now) };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    receiptsLibrary: true,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  const org = await read(await app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const email = `owner${++seq}@firm.ps`;
  const created = await provisionUser(app, { email, displayName: 'Nour Haddad', organizationId: org.id });
  const res = await app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const personal = created.personalProfile.id as string;
  const as = (profile = personal) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN });
  const get = (query: string, headers: Record<string, string> = as()) => app.request(`/v1/summaries/activity?${query}`, { headers });
  const customer = async (name: string) => (await read(await app.request('/v1/customers', json({ name }, { ...as(), ...idem() })))).id as string;
  const income = async (body: Record<string, unknown>) => read(await app.request('/v1/income', json({ currency: 'ILS', ...body }, { ...as(), ...idem() })));
  const expense = async (body: Record<string, unknown>) => read(await app.request('/v1/expenses', json({ currency: 'ILS', ...body }, { ...as(), ...idem() })));
  const settle = async (receivableId: string, paidAt: string) => app.request(`/v1/receivables/${receivableId}/settle`, json({ paidAt }, { ...as(), ...idem() }));
  return { app, store, clock, org, keyAuth: { authorization: `Bearer ${key.secret}`, 'x-mutaba3a-profile': org.id }, as, get, customer, income, expense, settle };
}

describe('GET /v1/summaries/activity', () => {
  it('sums received and spent per day, per currency, with the period’s categories and clients', async () => {
    const s = await setup();
    const client = await s.customer('Haddad');
    await s.income({ kind: 'received', amount: '100.00', occurredOn: '2026-10-05', customerId: client });
    await s.income({ kind: 'received', amount: '40.00', currency: 'USD', occurredOn: '2026-10-06' });
    await s.expense({ amount: '25.00', occurredOn: '2026-10-05' });
    const res = await s.get('from=2026-10-05&to=2026-10-11');
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ from: '2026-10-05', to: '2026-10-11', bucket: 'day', asOf: '2026-10-20', dataSince: '2026-10-05', earlierData: false });
    expect(body.buckets).toHaveLength(7);
    expect(body.buckets[0].currencies).toEqual([
      { currency: 'ILS', received: '100.00', spent: '25.00' },
      { currency: 'USD', received: '0.00', spent: '0.00' },
    ]);
    expect(body.currencies[0]).toMatchObject({ currency: 'ILS', received: '100.00', spent: '25.00', byCustomer: [{ customerId: client, total: '100.00', count: 1 }] });
    expect(body.history).toHaveLength(12);
    expect(body.history.at(-1)).toMatchObject({ month: '2026-10' });
  });

  it('works out days to get paid from settled Owed entries (median, n ≥ 3)', async () => {
    const s = await setup();
    const client = await s.customer('Haddad');
    for (const [occurredOn, paidAt] of [
      ['2026-09-01', '2026-09-11'],
      ['2026-09-01', '2026-09-13'],
      ['2026-09-01', '2026-09-15'],
    ]) {
      const owed = await s.income({ kind: 'owed', amount: '50.00', occurredOn, customerId: client, title: 'Work' });
      expect((await s.settle(owed.id, paidAt!)).status).toBe(201);
    }
    const body = await read(await s.get('from=2026-10-01&to=2026-10-31'));
    expect(body.daysToPaid).toEqual({ overall: { median: 12, n: 3 }, byCustomer: [{ customerId: client, median: 12, n: 3 }] });
  });

  it('buckets by month and says when older records exist before the read window', async () => {
    const s = await setup();
    await s.expense({ amount: '10.00', occurredOn: '2024-02-03' });
    await s.expense({ amount: '20.00', occurredOn: '2026-03-04' });
    const body = await read(await s.get('from=2026-01-01&to=2026-12-31&bucket=month'));
    expect(body.buckets.map((b: Loose) => b.start)).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`));
    expect(body.buckets[2].currencies).toEqual([{ currency: 'ILS', received: '0.00', spent: '20.00' }]);
    expect(body).toMatchObject({ dataSince: '2026-03-04', earlierData: true });
  });

  it('reports a profile with nothing as no data since, and no earlier data', async () => {
    const s = await setup();
    expect(await read(await s.get('from=2026-10-01&to=2026-10-31'))).toMatchObject({ dataSince: null, earlierData: false, currencies: [] });
  });

  it('dates today in the organization’s timezone', async () => {
    // 22:30 UTC on the 20th is already the 21st in Jerusalem
    const s = await setup('2026-10-20T22:30:00Z');
    expect((await read(await s.get('from=2026-10-01&to=2026-10-31'))).asOf).toBe('2026-10-21');
  });

  it('refuses an end before the start, a range over 13 months and a bad bucket (422)', async () => {
    const s = await setup();
    const before = await s.get('from=2026-10-02&to=2026-10-01');
    expect(before.status).toBe(422);
    expect((await read(before)).error.details).toMatchObject({ reason: 'END_BEFORE_START' });
    const long = await s.get('from=2025-01-01&to=2026-02-01');
    expect(long.status).toBe(422);
    expect((await read(long)).error.details).toMatchObject({ reason: 'RANGE_TOO_LONG' });
    expect((await s.get('from=2025-01-01&to=2026-01-31')).status).toBe(200);
    expect((await s.get('from=2026-10-01&to=2026-10-31&bucket=week')).status).toBe(422);
  });

  it('is session-only: Malafat’s key is refused', async () => {
    const s = await setup();
    const res = await s.get('from=2026-10-01&to=2026-10-31', s.keyAuth);
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});
