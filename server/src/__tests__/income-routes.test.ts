import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-65: POST /v1/income (Received or Owed) and DELETE /v1/income/{id}
 * (undo) — session-only, personal-profile writes. Mirrors
 * writability-routes.test.ts / routes-expenses.test.ts conventions.
 */
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
  const calls: Array<{ repo: string; method: string }> = [];
  /** `repo.method` → a one-shot side effect to run immediately before that store call, so a race can be staged deterministically. */
  const interleave = new Map<string, () => Promise<unknown>>();
  const recording = new Proxy(store, {
    get(target, repo) {
      const value: unknown = Reflect.get(target, repo, target);
      if (typeof value === 'function') return value.bind(target);
      if (typeof repo !== 'string' || typeof value !== 'object' || value === null) return value;
      return new Proxy(value, {
        get(r, method) {
          const fn: unknown = Reflect.get(r, method, r);
          if (typeof method !== 'string' || typeof fn !== 'function') return fn;
          return (...args: unknown[]) => {
            calls.push({ repo, method });
            const key = `${repo}.${method}`;
            const hook = interleave.get(key);
            if (!hook) return (fn as (...a: unknown[]) => unknown).apply(r, args);
            interleave.delete(key);
            return hook().then(() => (fn as (...a: unknown[]) => unknown).apply(r, args));
          };
        },
      });
    },
  });
  const clock = { now: new Date('2026-10-12T09:00:00Z') };
  const app = createApp({
    store: recording,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    // A generous idle/absolute expiry: the read-surface tests advance the clock days ahead to cross a due date; session-expiry behaviour itself is routes-sessions.test.ts's job, not this file's.
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, calls, clock, interleave };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

/** Organization P: personal, no Malafat integration. Organization M: Malafat-connected. */
async function orgs(h: Harness) {
  const p = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Personal ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const m = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const mKey = (await read(await h.app.request(`/admin/v1/organizations/${m.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string; apiKey: { id: string } };
  await h.store.integrations.connect({ organizationId: m.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Firm', connectedByApiKeyId: mKey.apiKey.id, at: h.clock.now });
  return { p, m, mAuth: { authorization: `Bearer ${mKey.secret}` } };
}

async function person(h: Harness, organizationIds: string[]) {
  const [first, ...rest] = organizationIds;
  const email = `partner${++seq}@firm.ps`;
  const created = (await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId: first }, admin)))) as { user: { id: string }; initialPassword: string };
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.initialPassword }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
  return { as, userId: created.user.id };
}

async function setup() {
  const h = harness();
  const { p, m, mAuth } = await orgs(h);
  const u = await person(h, [p.id, m.id]);
  const create = (body: Record<string, unknown>, profile = p.id) => h.app.request('/v1/income', json(body, { ...u.as(profile), ...idem() }));
  const del = (id: string, profile = p.id) => h.app.request(`/v1/income/${id}`, { method: 'DELETE', headers: u.as(profile) });
  return { h, p, m, mAuth, u, create, del };
}

const BASE_RECEIVED = { kind: 'received', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-08' };
const BASE_OWED = { kind: 'owed', amount: '500.00', currency: 'ILS', occurredOn: '2026-10-08' };

async function customer(h: Harness, u: Awaited<ReturnType<typeof person>>, profile: string, name = 'Nadia') {
  const res = await h.app.request('/v1/customers', json({ name }, { ...u.as(profile), ...idem() }));
  return (await read(res)) as { id: string };
}

async function project(h: Harness, u: Awaited<ReturnType<typeof person>>, profile: string, customerId: string, name = 'Logo') {
  const res = await h.app.request('/v1/projects', json({ customerId, name, currency: 'ILS' }, { ...u.as(profile), ...idem() }));
  return (await read(res)) as { id: string };
}

describe('POST /v1/income on a personal profile', () => {
  it('Received, no client → 201, Payment.customerId null, status unallocated', async () => {
    const { create } = await setup();
    const res = await create(BASE_RECEIVED);
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body).toMatchObject({ kind: 'received', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-08', customerId: null, projectId: null, dueDate: null, status: 'unallocated' });
  });

  it('Received, with client → 201, appears via GET /v1/payments?customerId=', async () => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    const res = await create({ ...BASE_RECEIVED, customerId: c.id });
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body.customerId).toBe(c.id);
    const list = await read(await h.app.request(`/v1/payments?customerId=${c.id}`, { headers: u.as(p.id) }));
    expect(list.items.map((x: Loose) => x.id)).toContain(body.id);
  });

  it('Received, with client + matter → 201, Payment.projectId set', async () => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    const proj = await project(h, u, p.id, c.id);
    const res = await create({ ...BASE_RECEIVED, customerId: c.id, projectId: proj.id });
    const body = await read(res);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ customerId: c.id, projectId: proj.id });
  });

  it('Owed, with client only → 201, origin ADJUSTMENT, agreementId null, projectId null', async () => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    const res = await create({ ...BASE_OWED, customerId: c.id, title: 'Logo design' });
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body).toMatchObject({ kind: 'owed', customerId: c.id, projectId: null, title: 'Logo design', status: 'open', dueDate: '2026-11-15' });
    const stored = await h.store.receivables.getById(p.id, body.id);
    expect(stored).toMatchObject({ origin: 'ADJUSTMENT', agreementId: null, projectId: null, title: 'Logo design' });
  });

  it('Owed, with client + matter → 201, Receivable.projectId set', async () => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    const proj = await project(h, u, p.id, c.id);
    const res = await create({ ...BASE_OWED, customerId: c.id, projectId: proj.id });
    const body = await read(res);
    expect(res.status).toBe(201);
    expect(body.projectId).toBe(proj.id);
  });

  it('Owed, no client → 422, field customerId, reason CUSTOMER_REQUIRED_FOR_OWED (AC 2)', async () => {
    const { create } = await setup();
    const res = await create(BASE_OWED);
    expect(res.status).toBe(422);
    const body = await read(res);
    expect(body.error.details).toMatchObject({ field: 'customerId', reason: 'CUSTOMER_REQUIRED_FOR_OWED' });
  });

  it.each([['received', BASE_RECEIVED], ['owed', BASE_OWED]])('%s: future occurredOn → 422 DATE_INVALID; backdated and today accepted (AC 7)', async (_label, base) => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    const future = await create({ ...(base as Loose), customerId: c.id, occurredOn: '2026-10-13' });
    expect(future.status).toBe(422);
    expect((await read(future)).error.details).toMatchObject({ reason: 'DATE_INVALID', field: 'occurredOn' });
    expect((await create({ ...(base as Loose), customerId: c.id, occurredOn: '2026-10-12' })).status).toBe(201);
    expect((await create({ ...(base as Loose), customerId: c.id, occurredOn: '2026-09-01' })).status).toBe(201);
  });

  it('Owed: dueDate defaults to EOM_15 of occurredOn, not occurredOn itself', async () => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    const res = await create({ ...BASE_OWED, customerId: c.id, occurredOn: '2026-01-31' });
    expect((await read(res)).dueDate).toBe('2026-02-15');
  });

  it('missing Idempotency-Key → 422', async () => {
    const { h, p, u } = await setup();
    const res = await h.app.request('/v1/income', json(BASE_RECEIVED, u.as(p.id)));
    expect(res.status).toBe(422);
  });

  it('replays the same Idempotency-Key + body → identical response, no second row created', async () => {
    const { h, p, u } = await setup();
    const key = { ...u.as(p.id), 'idempotency-key': 'income-key-01' };
    const first = await h.app.request('/v1/income', json(BASE_RECEIVED, key));
    const again = await h.app.request('/v1/income', json(BASE_RECEIVED, key));
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await read(again)).toEqual(await read(first));
    const list = await read(await h.app.request('/v1/payments', { headers: u.as(p.id) }));
    expect(list.items).toHaveLength(1);
  });

  it('replays the same key with a different body → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const { h, p, u } = await setup();
    const key = { ...u.as(p.id), 'idempotency-key': 'income-key-02' };
    await h.app.request('/v1/income', json(BASE_RECEIVED, key));
    const other = await h.app.request('/v1/income', json({ ...BASE_RECEIVED, amount: '999.00' }, key));
    expect((await read(other)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('captureSource lands on the audit row when present; absent when not given (AC 8)', async () => {
    const { h, p, create } = await setup();
    expect((await create({ ...BASE_RECEIVED, captureSource: 'siri' })).status).toBe(201);
    expect((await create({ ...BASE_RECEIVED, amount: '10.00' })).status).toBe(201);
    const events = (await h.store.audit.list(p.id, { action: 'income.received' }, { limit: 10, cursor: null })).items;
    expect(events).toHaveLength(2);
    const withSource = events.find((e) => (e.metadata as Loose)?.amount === '250.00')!;
    const withoutSource = events.find((e) => (e.metadata as Loose)?.amount === '10.00')!;
    expect(withSource.metadata).toMatchObject({ captureSource: 'siri' });
    expect(withoutSource.metadata).not.toHaveProperty('captureSource');
  });

  it('every write audits actorType USER, actorId the session user (never API_KEY/SYSTEM)', async () => {
    const { h, p, u, create } = await setup();
    await create(BASE_RECEIVED);
    const events = (await h.store.audit.list(p.id, { action: 'income.received' }, { limit: 10, cursor: null })).items;
    expect(events[0]).toMatchObject({ actorType: 'USER', actorId: u.userId });
  });
});

describe('POST /v1/income on a Malafat-fed profile (M)', () => {
  it.each([
    ['received, no client', BASE_RECEIVED],
    ['owed, with client', { ...BASE_OWED }],
  ])('%s → 403 READ_ONLY_PROFILE { domain: payments }; nothing written', async (_label, base) => {
    const { h, m, create } = await setup();
    h.calls.length = 0;
    const res = await create(base as Loose, m.id);
    expect(res.status).toBe(403);
    const body = await read(res);
    expect(body.error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { domain: 'payments', writerOfRecord: 'MALAFAT' } });
    expect(h.calls.filter((c) => (c.repo === 'payments' && c.method === 'create') || (c.repo === 'receivables' && c.method === 'createAdjustment'))).toEqual([]);
  });

  it('an API key belonging to M → 403 PRINCIPAL_NOT_ACCEPTED (session-only route)', async () => {
    const { h, mAuth } = await setup();
    const res = await h.app.request('/v1/income', json(BASE_RECEIVED, { ...mAuth, ...idem() }));
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});

describe('DELETE /v1/income/{id} — undo (AC 9)', () => {
  it('deletes a just-created Received entry (no allocations) → 204; payment REVERSED; idempotent', async () => {
    const { h, p, u, create, del } = await setup();
    const created = await read(await create(BASE_RECEIVED));
    const first = await del(created.id);
    expect(first.status).toBe(204);
    expect(await h.store.payments.getById(p.id, created.id)).toMatchObject({ status: 'REVERSED' });
    expect((await del(created.id)).status).toBe(204);
    void u;
  });

  it('deletes a just-created Owed entry (no payments against it) → 204; excluded from GET /v1/receivables; idempotent', async () => {
    const { h, p, u, create, del } = await setup();
    const c = await customer(h, u, p.id);
    const created = await read(await create({ ...BASE_OWED, customerId: c.id }));
    expect((await del(created.id)).status).toBe(204);
    const list = await read(await h.app.request('/v1/receivables', { headers: u.as(p.id) }));
    expect(list.items.map((x: Loose) => x.id)).not.toContain(created.id);
    expect((await del(created.id)).status).toBe(204);
  });

  it('an Owed entry partially settled (paidMinor > 0) → 409 ALREADY_SETTLED; the row is untouched', async () => {
    const { h, p, u, create, del } = await setup();
    const c = await customer(h, u, p.id);
    const created = await read(await create({ ...BASE_OWED, customerId: c.id }));
    await h.app.request(`/v1/receivables/${created.id}/settle`, json({ amount: '100.00' }, { ...u.as(p.id), ...idem() }));
    const res = await del(created.id);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALREADY_SETTLED' });
    expect(await h.store.receivables.getById(p.id, created.id)).toMatchObject({ deletedAt: null });
  });

  it('a Received entry since allocated → 409 ALREADY_ALLOCATED', async () => {
    const { h, p, u, create, del } = await setup();
    const c = await customer(h, u, p.id);
    const owed = await read(await create({ ...BASE_OWED, customerId: c.id, amount: '100.00' }));
    const received = await read(await create({ ...BASE_RECEIVED, customerId: c.id, amount: '500.00' }));
    // allocate the standalone received payment against the owed receivable, via settle on the receivable using a fresh payment — instead, directly mutate through the store to simulate "since allocated" without inventing a new route surface.
    await h.store.payments.allocate(p.id, received.id, [{ receivableId: owed.id, amountMinor: 10000n }], h.clock.now);
    const res = await del(received.id);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALREADY_ALLOCATED' });
  });

  it('a settle landing between the paid/credited check and the write → 409 ALREADY_SETTLED; the entry stays visible, money and all', async () => {
    const { h, p, u, create, del } = await setup();
    const c = await customer(h, u, p.id);
    const owed = await read(await create({ ...BASE_OWED, customerId: c.id, amount: '500.00' }));

    // The race, staged exactly: the settle fires inside the undo request, after its guard read and before its write.
    h.interleave.set('receivables.softDeleteAdjustment', async () => {
      const settled = await h.app.request(`/v1/receivables/${owed.id}/settle`, json({}, { ...u.as(p.id), ...idem() }));
      expect(settled.status).toBe(201);
    });

    const res = await del(owed.id);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALREADY_SETTLED' });
    // Not voided: a POSTED payment is allocated to this row, and every read path must keep showing it.
    expect(await h.store.receivables.getById(p.id, owed.id)).toMatchObject({ deletedAt: null, paidMinor: 50000n, status: 'SETTLED' });
    const list = await read(await h.app.request(`/v1/receivables?customerId=${c.id}`, { headers: u.as(p.id) }));
    expect(list.items.map((x: Loose) => x.id)).toContain(owed.id);
  });

  it('an id created by another user (second membership on the same personal profile) → 404', async () => {
    const { h, p, u, create } = await setup();
    const created = await read(await create(BASE_RECEIVED));
    const other = await person(h, [p.id]);
    const res = await h.app.request(`/v1/income/${created.id}`, { method: 'DELETE', headers: other.as(p.id) });
    expect(res.status).toBe(404);
    void u;
  });

  it('an id belonging to M (real installment-origin receivable), looked up while authenticated on P → 404 (cross-organization, existing convention)', async () => {
    const { h, p, mAuth, del } = await setup();
    // A real Malafat-fed installment-origin receivable on M.
    const customerM = (await read(await h.app.request('/v1/customers', json({ name: 'Firm client' }, { ...mAuth, ...idem() })))) as { id: string };
    const projectM = (await read(await h.app.request('/v1/projects', json({ customerId: customerM.id, name: 'Matter', currency: 'ILS' }, { ...mAuth, ...idem() })))) as { id: string };
    const preview = await read(
      await h.app.request(
        '/v1/agreements/preview',
        json({ projectId: projectM.id, amount: '1000.00', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', agreementDate: '2026-10-08', paymentTerms: 'EOM', installments: [{ label: 'I1', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] }, mAuth),
      ),
    );
    const agreement = (
      await read(
        await h.app.request(
          '/v1/agreements',
          json(
            { projectId: projectM.id, amount: '1000.00', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', agreementDate: '2026-10-08', paymentTerms: 'EOM', installments: [{ label: 'I1', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }], previewToken: preview.previewToken },
            { ...mAuth, ...idem() },
          ),
        ),
      )
    ).agreement;
    const receivablesM = await read(await h.app.request('/v1/receivables', { headers: mAuth }));
    const realReceivableId = receivablesM.items[0].id;
    expect(realReceivableId).toBeTruthy();
    void agreement;

    // Looked up while authenticated on P (a different, valid personal profile): the organization filter alone hides it, 404.
    const res = await del(realReceivableId, p.id);
    expect(res.status).toBe(404);
  });

  it('a session on M cannot void/reverse anything via this route, including a guessed P-created id — writability refuses before any lookup', async () => {
    const { m, create, del } = await setup();
    const created = await read(await create(BASE_RECEIVED));
    const res = await del(created.id, m.id);
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('READ_ONLY_PROFILE');
  });

  it('an unknown id → 404', async () => {
    const { del } = await setup();
    expect((await del('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('voiding Owed audits income.owed.voided; undoing Received audits payment.reversed — both actorType USER', async () => {
    const { h, p, u, create, del } = await setup();
    const c = await customer(h, u, p.id);
    const owed = await read(await create({ ...BASE_OWED, customerId: c.id }));
    const received = await read(await create(BASE_RECEIVED));
    await del(owed.id);
    await del(received.id);
    const voided = (await h.store.audit.list(p.id, { action: 'income.owed.voided' }, { limit: 10, cursor: null })).items;
    const reversed = (await h.store.audit.list(p.id, { action: 'payment.reversed' }, { limit: 10, cursor: null })).items;
    expect(voided).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(voided[0]).toMatchObject({ actorType: 'USER', actorId: u.userId, entityId: owed.id });
    expect(reversed[0]).toMatchObject({ actorType: 'USER', actorId: u.userId, entityId: received.id });
  });
});

describe('read-surface agreement (AC 3): captured income shows up where its money already lives', () => {
  it('Owed appears in Owed and, once overdue, in Overdue instead (GET /v1/summaries/organization — the design doc\'s named surface; the customer summary is project-keyed and does not carry a matterless receivable)', async () => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    await create({ ...BASE_RECEIVED, customerId: c.id, amount: '300.00' });
    const owed = await read(await create({ ...BASE_OWED, customerId: c.id, amount: '500.00', dueDate: '2026-10-15' }));

    const list = await read(await h.app.request(`/v1/receivables?customerId=${c.id}`, { headers: u.as(p.id) }));
    expect(list.items.map((x: Loose) => x.id)).toContain(owed.id);
    expect(list.items.find((x: Loose) => x.id === owed.id).status).toBe('DUE');

    const orgSummaryBefore = await read(await h.app.request('/v1/summaries/organization', { headers: u.as(p.id) }));
    const beforeBlock = orgSummaryBefore.currencies.find((x: Loose) => x.currency === 'ILS');
    expect(beforeBlock.outstanding).toBe('500.00');
    expect(beforeBlock.overdue).toBe('0.00');
    expect(beforeBlock.customers.find((x: Loose) => x.customerId === c.id).outstanding).toBe('500.00');

    // Advance the clock past the due date: the same figure moves from "not yet due" to overdue (ADR-022 bucketing).
    h.clock.now = new Date('2026-10-20T09:00:00Z');
    const orgSummaryAfter = await read(await h.app.request('/v1/summaries/organization', { headers: u.as(p.id) }));
    const afterBlock = orgSummaryAfter.currencies.find((x: Loose) => x.currency === 'ILS');
    expect(afterBlock.overdue).toBe('500.00');
    expect(afterBlock.outstanding).toBe('500.00');
  });

  it('two currencies captured on the same profile: each currency block is independent, never summed together', async () => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    await create({ ...BASE_RECEIVED, customerId: c.id, amount: '100.00', currency: 'ILS' });
    await create({ ...BASE_RECEIVED, customerId: c.id, amount: '50.00', currency: 'USD' });
    const summary = await read(await h.app.request('/v1/summaries/organization', { headers: u.as(p.id) }));
    const ils = summary.currencies.find((x: Loose) => x.currency === 'ILS');
    const usd = summary.currencies.find((x: Loose) => x.currency === 'USD');
    expect(ils.unallocated).toBe('100.00');
    expect(usd.unallocated).toBe('50.00');
  });

  it('settling a partial amount decreases the customer’s outstanding figure by exactly the settled amount, in that currency only', async () => {
    const { h, p, u, create } = await setup();
    const c = await customer(h, u, p.id);
    const owed = await read(await create({ ...BASE_OWED, customerId: c.id, amount: '500.00' }));
    await h.app.request(`/v1/receivables/${owed.id}/settle`, json({ amount: '150.00' }, { ...u.as(p.id), ...idem() }));
    const summary = await read(await h.app.request('/v1/summaries/organization', { headers: u.as(p.id) }));
    const ils = summary.currencies.find((x: Loose) => x.currency === 'ILS');
    expect(ils.customers.find((x: Loose) => x.customerId === c.id).outstanding).toBe('350.00');
  });
});

describe('a session creates a customer and a project under it, on its own personal profile (AC 4)', () => {
  it('POST /v1/customers → 201, audited as USER; POST /v1/projects under it → 201, audited as USER', async () => {
    const { h, p, u } = await setup();
    const customerRes = await h.app.request('/v1/customers', json({ name: 'Nadia' }, { ...u.as(p.id), ...idem() }));
    expect(customerRes.status).toBe(201);
    const c = await read(customerRes);
    expect(c).toMatchObject({ name: 'Nadia', status: 'ACTIVE' });

    const projectRes = await h.app.request('/v1/projects', json({ customerId: c.id, name: 'Logo redesign', currency: 'ILS' }, { ...u.as(p.id), ...idem() }));
    expect(projectRes.status).toBe(201);
    const proj = await read(projectRes);
    expect(proj).toMatchObject({ customerId: c.id, name: 'Logo redesign', currency: 'ILS', status: 'ACTIVE' });

    const customerEvents = (await h.store.audit.list(p.id, { action: 'customer.created' }, { limit: 10, cursor: null })).items;
    const projectEvents = (await h.store.audit.list(p.id, { action: 'project.created' }, { limit: 10, cursor: null })).items;
    expect(customerEvents[0]).toMatchObject({ actorType: 'USER', actorId: u.userId, entityId: c.id });
    expect(projectEvents[0]).toMatchObject({ actorType: 'USER', actorId: u.userId, entityId: proj.id });
  });

  it("a session's externalReference is refused (a session has no external system to reference)", async () => {
    const { h, p, u } = await setup();
    const res = await h.app.request(
      '/v1/customers',
      json({ name: 'Nadia', externalReference: { provider: 'MALAFAT', externalId: 'ext-1' } }, { ...u.as(p.id), ...idem() }),
    );
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ field: 'externalReference', reason: 'EXTERNAL_REFERENCE_NOT_ALLOWED' });
  });
});
