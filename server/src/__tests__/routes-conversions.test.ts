import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-161: conversions on hosted profiles — session-only routes, create + read only. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-20T09:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    attachments: null,
    attachmentUrlTtlSeconds: 900,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, clock };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function firm(h: Harness) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  return { org: org as { id: string }, auth };
}

async function partner(h: Harness, organizationIds: string[]) {
  const [first, ...rest] = organizationIds;
  const email = `partner${++seq}@firm.ps`;
  const created = await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId: first, locale: 'en' }, admin)));
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.initialPassword }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
  const deviceRes = await read(await h.app.request('/v1/device-sessions', json({ email, password: created.initialPassword })));
  const asDevice = (profile: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${deviceRes.token}`, 'x-mutaba3a-profile': profile, ...extra });
  return { as, asDevice, userId: created.user.id as string };
}

async function setup() {
  const h = harness();
  const a = await firm(h);
  const b = await firm(h);
  const p = await partner(h, [a.org.id, b.org.id]);
  const create = async (body: Record<string, unknown>, profile = a.org.id) =>
    h.app.request('/v1/conversions', json({ occurredOn: '2026-10-05', amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS', ...body }, { ...p.as(profile), ...idem() }));
  return { h, a, b, p, create };
}

describe('POST /v1/conversions', () => {
  it('stores both legs and answers the full shape', async () => {
    const { p, create } = await setup();
    const res = await create({ notes: 'Transferred to ILS account' });
    expect(res.status).toBe(201);
    expect(await read(res)).toEqual({
      id: expect.any(String),
      occurredOn: '2026-10-05',
      amount: '100.00',
      currency: 'USD',
      toAmount: '365.00',
      toCurrency: 'ILS',
      notes: 'Transferred to ILS account',
      createdByUserId: p.userId,
      createdAt: '2026-10-20T09:00:00.000Z',
    });
  });

  it('a device-session token can create one too (MUT-64)', async () => {
    const { h, a, p } = await setup();
    const res = await h.app.request(
      '/v1/conversions',
      json({ occurredOn: '2026-10-05', amount: '50.00', currency: 'USD', toAmount: '182.50', toCurrency: 'ILS' }, { ...p.asDevice(a.org.id), ...idem() }),
    );
    expect(res.status).toBe(201);
  });

  it('respects JOD\'s 3-decimal precision on either leg', async () => {
    const { create } = await setup();
    const res = await create({ amount: '100.000', currency: 'JOD', toAmount: '365.00', toCurrency: 'ILS' });
    expect(res.status).toBe(201);
    expect((await read(res)).amount).toBe('100.000');
  });

  it.each([
    ['a zero source amount', { amount: '0.00' }, 'AMOUNT_INVALID', 'amount'],
    ['a negative source amount', { amount: '-5.00' }, 'AMOUNT_INVALID', 'amount'],
    ['a wrong-precision source amount', { amount: '1.234' }, 'AMOUNT_INVALID', 'amount'],
    ['a zero destination amount', { toAmount: '0.00' }, 'AMOUNT_INVALID', 'toAmount'],
    ['a negative destination amount', { toAmount: '-5.00' }, 'AMOUNT_INVALID', 'toAmount'],
    ['an impossible date', { occurredOn: '2026-02-30' }, 'DATE_INVALID', 'occurredOn'],
  ])('refuses %s with 422 %s on field %s', async (_label, body, reason, field) => {
    const { create } = await setup();
    const res = await create(body);
    expect(res.status).toBe(422);
    const err = (await read(res)).error;
    expect(err.details.reason).toBe(reason);
    expect(err.details.field).toBe(field);
  });

  it('refuses the same currency on both legs, on the toCurrency field (ports the local app\'s rule)', async () => {
    const { create } = await setup();
    const res = await create({ toCurrency: 'USD' });
    expect(res.status).toBe(422);
    const err = (await read(res)).error;
    expect(err.details.reason).toBe('SAME_CURRENCY');
    expect(err.details.field).toBe('toCurrency');
  });

  it('refuses a future-dated occurredOn; accepts a backdated one (ADR-038)', async () => {
    const { create } = await setup();
    const future = await create({ occurredOn: '2026-10-21' });
    expect(future.status).toBe(422);
    expect((await read(future)).error.details.reason).toBe('DATE_INVALID');
    const past = await create({ occurredOn: '2020-01-01' });
    expect(past.status).toBe(201);
    const today = await create({ occurredOn: '2026-10-20' });
    expect(today.status).toBe(201);
  });

  it('replays an Idempotency-Key and refuses it for a different body', async () => {
    const { h, a, p } = await setup();
    const key = { ...p.as(a.org.id), 'idempotency-key': 'conversion-key-0001' };
    const body = { occurredOn: '2026-10-05', amount: '10.00', currency: 'USD', toAmount: '36.50', toCurrency: 'ILS' };
    const first = await h.app.request('/v1/conversions', json(body, key));
    const again = await h.app.request('/v1/conversions', json(body, key));
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await read(again)).toEqual(await read(first));
    const other = await h.app.request('/v1/conversions', json({ ...body, amount: '11.00' }, key));
    expect((await read(other)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await read(await h.app.request('/v1/conversions', { headers: p.as(a.org.id) }))).items).toHaveLength(1);
  });
});

describe('writability: Malafat’s key is refused on every conversion operation', () => {
  it('refuses the key, session reads fine', async () => {
    const { h, a } = await setup();
    const doc = (await read(await h.app.request('/openapi.json'))) as { paths: Record<string, Record<string, unknown>> };
    const ops = Object.entries(doc.paths)
      .filter(([path]) => /^\/v1\/conversions/.test(path))
      .flatMap(([path, item]) => ['get', 'post'].filter((m) => item[m]).map((m) => [m.toUpperCase(), path] as const));
    expect(ops.length).toBeGreaterThan(0);
    for (const [method, path] of ops) {
      const res = await h.app.request(path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-0000000000aa'), {
        method,
        headers: { ...a.auth, 'content-type': 'application/json', ...idem() },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await read(res)).error.code, `${method} ${path}`).toBe('PRINCIPAL_NOT_ACCEPTED');
    }
  });
});

describe('GET /v1/conversions', () => {
  it('pages newest first, filters by currency on either leg, and stays within one organization', async () => {
    const { h, b, p, create } = await setup();
    for (const d of ['2026-10-01', '2026-10-09', '2026-10-04']) await create({ occurredOn: d }, b.org.id);
    await create({ occurredOn: '2026-10-06', currency: 'EUR', toCurrency: 'JOD' }, b.org.id);
    const dates: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Loose = await read(await h.app.request(`/v1/conversions?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { headers: p.as(b.org.id) }));
      dates.push(...page.items.map((x: Loose) => x.occurredOn));
      cursor = page.nextCursor;
    } while (cursor);
    expect(dates).toEqual(['2026-10-09', '2026-10-06', '2026-10-04', '2026-10-01']);
    const q = async (query: string) => (await read(await h.app.request(`/v1/conversions?${query}`, { headers: p.as(b.org.id) }))).items.map((x: Loose) => x.occurredOn);
    expect(await q('from=2026-10-04&to=2026-10-06')).toEqual(['2026-10-06', '2026-10-04']);
    expect(await q('currency=EUR')).toEqual(['2026-10-06']);
    expect(await q('currency=JOD')).toEqual(['2026-10-06']);
  });
});

describe('GET /v1/conversions/{id}', () => {
  it('reads it back on the owning profile; 404s on another profile or an unknown id', async () => {
    const { h, a, b, p, create } = await setup();
    const created = await read(await create({}));
    expect((await h.app.request(`/v1/conversions/${created.id}`, { headers: p.as(a.org.id) })).status).toBe(200);
    expect((await h.app.request(`/v1/conversions/${created.id}`, { headers: p.as(b.org.id) })).status).toBe(404);
    expect((await h.app.request('/v1/conversions/00000000-0000-4000-8000-0000000000dd', { headers: p.as(a.org.id) })).status).toBe(404);
  });
});
