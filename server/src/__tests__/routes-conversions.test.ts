import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-161: conversions on hosted profiles — session-only routes. MUT-194 (ADR-075): PATCH and DELETE. */
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
      version: 1,
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
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
      .flatMap(([path, item]) => ['get', 'post', 'patch', 'delete'].filter((m) => item[m]).map((m) => [m.toUpperCase(), path] as const));
    // MUT-194: PATCH and DELETE are swept too.
    expect(ops.map(([m]) => m).sort()).toEqual(['DELETE', 'GET', 'GET', 'PATCH', 'POST']);
    for (const [method, path] of ops) {
      const res = await h.app.request(path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-0000000000aa'), {
        method,
        headers: { ...a.auth, 'content-type': 'application/json', ...idem(), 'if-match': '1' },
        ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
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

  it('MUT-91: anchor starts the page at that conversion, inclusive; nextCursor continues older; filters still apply', async () => {
    const { h, b, p, create } = await setup();
    const made: Loose[] = [];
    for (const d of ['2026-10-09', '2026-10-06', '2026-10-04', '2026-10-01']) made.push(await read(await create({ occurredOn: d }, b.org.id)));
    const anchor = made[1]; // 2026-10-06
    const page: Loose = await read(await h.app.request(`/v1/conversions?limit=2&anchor=${anchor.id}`, { headers: p.as(b.org.id) }));
    expect(page.items.map((x: Loose) => x.occurredOn)).toEqual(['2026-10-06', '2026-10-04']);
    expect(page.items[0].id).toBe(anchor.id);
    const rest: Loose = await read(await h.app.request(`/v1/conversions?limit=2&cursor=${page.nextCursor}`, { headers: p.as(b.org.id) }));
    expect(rest.items.map((x: Loose) => x.occurredOn)).toEqual(['2026-10-01']);
    const filtered: Loose = await read(await h.app.request(`/v1/conversions?anchor=${anchor.id}&from=2026-10-05`, { headers: p.as(b.org.id) }));
    expect(filtered.items.map((x: Loose) => x.occurredOn)).toEqual(['2026-10-06']);
  });

  it('MUT-91: anchor refuses a cursor alongside it, and 404s an unknown or other-profile conversion', async () => {
    const { h, a, b, p, create } = await setup();
    const mine = await read(await create({}, b.org.id));
    const theirs = await read(await create({}, a.org.id));
    const both = await h.app.request(`/v1/conversions?anchor=${mine.id}&cursor=abc`, { headers: p.as(b.org.id) });
    expect(both.status).toBe(422);
    const bothBody = await read(both);
    expect(bothBody.error.code).toBe('VALIDATION_FAILED');
    expect(bothBody.error.details.field).toBe('anchor');
    const unknown = await h.app.request('/v1/conversions?anchor=00000000-0000-4000-8000-0000000000ee', { headers: p.as(b.org.id) });
    expect(unknown.status).toBe(404);
    const unknownBody = await read(unknown);
    expect(unknownBody.error.code).toBe('NOT_FOUND');
    // Not the 'profile gone' 404: a client can tell a stale anchor apart and drop it.
    expect(unknownBody.error.details).toMatchObject({ field: 'anchor', reason: 'ANCHOR_NOT_FOUND' });
    expect((await h.app.request(`/v1/conversions?anchor=${theirs.id}`, { headers: p.as(b.org.id) })).status).toBe(404);
    expect((await h.app.request('/v1/conversions?anchor=not-a-uuid', { headers: p.as(b.org.id) })).status).toBe(422);
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

describe('regression: a conversion never appears in any /v1/summaries/* result (MUT-161 AC)', () => {
  it('leaves the organization summary byte-identical after logging a conversion', async () => {
    const { h, a, p, create } = await setup();
    await h.app.request('/v1/income', json({ kind: 'received', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-05' }, { ...p.as(a.org.id), ...idem() }));
    const before = await read(await h.app.request('/v1/summaries/organization', { headers: p.as(a.org.id) }));
    await create({});
    const after = await read(await h.app.request('/v1/summaries/organization', { headers: p.as(a.org.id) }));
    expect(after).toEqual(before);
  });

  it('leaves the expenses summary byte-identical after logging a conversion', async () => {
    const { h, a, p, create } = await setup();
    await h.app.request('/v1/expenses', json({ occurredOn: '2026-10-05', amount: '40.00', currency: 'ILS' }, { ...p.as(a.org.id), ...idem() }));
    const before = await read(await h.app.request('/v1/summaries/expenses', { headers: p.as(a.org.id) }));
    await create({});
    const after = await read(await h.app.request('/v1/summaries/expenses', { headers: p.as(a.org.id) }));
    expect(after).toEqual(before);
  });

  it('MUT-194: leaves both summaries byte-identical after editing and after deleting a conversion', async () => {
    const { h, a, p, create } = await setup();
    await h.app.request('/v1/income', json({ kind: 'received', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-05' }, { ...p.as(a.org.id), ...idem() }));
    await h.app.request('/v1/expenses', json({ occurredOn: '2026-10-05', amount: '40.00', currency: 'ILS' }, { ...p.as(a.org.id), ...idem() }));
    const created = await read(await create({}));
    const summaries = async () => ({
      organization: await read(await h.app.request('/v1/summaries/organization', { headers: p.as(a.org.id) })),
      expenses: await read(await h.app.request('/v1/summaries/expenses', { headers: p.as(a.org.id) })),
    });
    const before = await summaries();
    const edited = await h.app.request(`/v1/conversions/${created.id}`, json({ amount: '500.00', currency: 'EUR', toAmount: '2000.00', toCurrency: 'ILS', occurredOn: '2026-10-06' }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH'));
    expect(edited.status).toBe(200);
    expect(await summaries()).toEqual(before);
    expect((await h.app.request(`/v1/conversions/${created.id}`, { method: 'DELETE', headers: p.as(a.org.id) })).status).toBe(204);
    expect(await summaries()).toEqual(before);
  });
});

describe('PATCH /v1/conversions/{id} (MUT-194)', () => {
  const patch = (h: Harness, id: string, body: Record<string, unknown>, headers: Record<string, string>) => h.app.request(`/v1/conversions/${id}`, json(body, headers, 'PATCH'));

  it('changes both legs, the date and the notes at the current version, bumps it, and audits the fields', async () => {
    const { h, a, p, create } = await setup();
    const created = await read(await create({ notes: 'first' }));
    h.clock.now = new Date('2026-10-20T10:00:00Z');
    const res = await patch(h, created.id, { amount: '70.900', currency: 'JOD', toAmount: '365.00', toCurrency: 'ILS', occurredOn: '2026-10-04', notes: null }, { ...p.as(a.org.id), 'if-match': '1' });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ id: created.id, amount: '70.900', currency: 'JOD', toAmount: '365.00', toCurrency: 'ILS', occurredOn: '2026-10-04', notes: null, version: 2, createdAt: '2026-10-20T09:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z' });
    expect(await read(await h.app.request(`/v1/conversions/${created.id}`, { headers: p.as(a.org.id) }))).toMatchObject({ version: 2, currency: 'JOD', notes: null });
    const events = (await h.store.audit.list(a.org.id, { action: 'conversion.updated' }, { limit: 10, cursor: null })).items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: 'USER', actorId: p.userId, entityType: 'conversion', entityId: created.id });
    const metadata = events[0]!.metadata as { fields: string[]; version: number };
    expect(metadata.version).toBe(2);
    expect([...metadata.fields].sort()).toEqual(['amount', 'currency', 'notes', 'occurredOn', 'toAmount', 'toCurrency']);
  });

  it('works with a device-session token (MUT-64)', async () => {
    const { h, a, p, create } = await setup();
    const created = await read(await create({}));
    const res = await patch(h, created.id, { notes: 'from the phone' }, { ...p.asDevice(a.org.id), 'if-match': '1' });
    expect(res.status).toBe(200);
    expect((await read(res)).notes).toBe('from the phone');
  });

  it('refuses a stale If-Match with 409 VERSION_MISMATCH and the current version, changing nothing', async () => {
    const { h, a, p, create } = await setup();
    const created = await read(await create({}));
    expect((await patch(h, created.id, { notes: 'one' }, { ...p.as(a.org.id), 'if-match': '1' })).status).toBe(200);
    const stale = await patch(h, created.id, { notes: 'two' }, { ...p.as(a.org.id), 'if-match': '1' });
    expect(stale.status).toBe(409);
    expect((await read(stale)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'VERSION_MISMATCH', currentVersion: 2 } });
    expect((await read(await h.app.request(`/v1/conversions/${created.id}`, { headers: p.as(a.org.id) }))).notes).toBe('one');
  });

  it('refuses a missing If-Match with 422', async () => {
    const { h, a, p, create } = await setup();
    const created = await read(await create({}));
    const res = await patch(h, created.id, { notes: 'x' }, p.as(a.org.id));
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.field).toBe('If-Match');
  });

  it.each([
    ['a currency without its amount', { currency: 'EUR' }, 'AMOUNT_REQUIRED', 'amount'],
    ['a toCurrency without its toAmount', { toCurrency: 'EUR' }, 'AMOUNT_REQUIRED', 'toAmount'],
    ['a merged same-currency pair', { toAmount: '100.00', toCurrency: 'USD' }, 'SAME_CURRENCY', 'toCurrency'],
    ['a wrong-precision amount for the row\'s currency', { amount: '1.234' }, 'AMOUNT_INVALID', 'amount'],
    ['a future occurredOn', { occurredOn: '2026-10-21' }, 'DATE_INVALID', 'occurredOn'],
  ])('refuses %s with 422 %s on field %s', async (_label, body, reason, field) => {
    const { h, a, p, create } = await setup();
    const created = await read(await create({}));
    const res = await patch(h, created.id, body, { ...p.as(a.org.id), 'if-match': '1' });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason, field });
  });

  it('a notes-only edit of an old conversion is fine: the date is only checked when sent', async () => {
    const { h, a, p, create } = await setup();
    const created = await read(await create({ occurredOn: '2020-01-01' }));
    const res = await patch(h, created.id, { notes: 'still 2020' }, { ...p.as(a.org.id), 'if-match': '1' });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ occurredOn: '2020-01-01', notes: 'still 2020' });
  });

  it('404s an unknown id, another profile\'s conversion, and one deleted since', async () => {
    const { h, a, b, p, create } = await setup();
    const created = await read(await create({}));
    expect((await patch(h, '00000000-0000-4000-8000-0000000000dd', { notes: 'x' }, { ...p.as(a.org.id), 'if-match': '1' })).status).toBe(404);
    expect((await patch(h, created.id, { notes: 'x' }, { ...p.as(b.org.id), 'if-match': '1' })).status).toBe(404);
    await h.app.request(`/v1/conversions/${created.id}`, { method: 'DELETE', headers: p.as(a.org.id) });
    expect((await patch(h, created.id, { notes: 'x' }, { ...p.as(a.org.id), 'if-match': '1' })).status).toBe(404);
  });
});

describe('DELETE /v1/conversions/{id} (MUT-194)', () => {
  const del = (h: Harness, id: string, headers: Record<string, string>) => h.app.request(`/v1/conversions/${id}`, { method: 'DELETE', headers });

  it('soft-deletes: 204, 204 again, audited once; gone from get, list and anchor', async () => {
    const { h, a, p, create } = await setup();
    const kept = await read(await create({ occurredOn: '2026-10-01' }));
    const gone = await read(await create({ occurredOn: '2026-10-02' }));
    expect((await del(h, gone.id, p.as(a.org.id))).status).toBe(204);
    expect((await del(h, gone.id, p.as(a.org.id))).status).toBe(204);
    expect((await h.app.request(`/v1/conversions/${gone.id}`, { headers: p.as(a.org.id) })).status).toBe(404);
    const listed = await read(await h.app.request('/v1/conversions', { headers: p.as(a.org.id) }));
    expect(listed.items.map((x: Loose) => x.id)).toEqual([kept.id]);
    const anchored = await h.app.request(`/v1/conversions?anchor=${gone.id}`, { headers: p.as(a.org.id) });
    expect(anchored.status).toBe(404);
    expect((await read(anchored)).error.details).toMatchObject({ field: 'anchor', reason: 'ANCHOR_NOT_FOUND' });
    const deletions = (await h.store.audit.list(a.org.id, { action: 'conversion.deleted' }, { limit: 10, cursor: null })).items;
    expect(deletions).toHaveLength(1);
    expect(deletions[0]).toMatchObject({ actorType: 'USER', actorId: p.userId, entityType: 'conversion', entityId: gone.id });
  });

  it('works with a device-session token (MUT-64)', async () => {
    const { h, a, p, create } = await setup();
    const created = await read(await create({}));
    expect((await del(h, created.id, p.asDevice(a.org.id))).status).toBe(204);
  });

  it('404s an unknown id and another profile\'s conversion (G2)', async () => {
    const { h, a, b, p, create } = await setup();
    const created = await read(await create({}, a.org.id));
    expect((await del(h, '00000000-0000-4000-8000-0000000000de', p.as(a.org.id))).status).toBe(404);
    expect((await del(h, created.id, p.as(b.org.id))).status).toBe(404);
    expect((await h.app.request(`/v1/conversions/${created.id}`, { headers: p.as(a.org.id) })).status).toBe(200);
  });
});
