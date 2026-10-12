import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { InsufficientCapacity, MemoryLedgerStore } from '../repositories/memory.js';
import type { LedgerStore } from '../repositories/ports.js';

/** MUT-65 (locked-in AC 11): POST /v1/receivables/{id}/settle — a personal profile's own receivable, no preview/allocation dance. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

/** `wrap` lets one test hand the app a stubbed store while the assertions keep reading the real one. */
function harness(wrap: (store: MemoryLedgerStore) => LedgerStore = (s) => s) {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-12T09:00:00Z') };
  const app = createApp({
    store: wrap(store),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
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

async function orgs(h: Harness) {
  const p = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Personal ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const m = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const mKey = (await read(await h.app.request(`/admin/v1/organizations/${m.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string; apiKey: { id: string } };
  await h.store.integrations.connect({ organizationId: m.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Firm', connectedByApiKeyId: mKey.apiKey.id, at: h.clock.now });
  return { p, m };
}

async function person(h: Harness, organizationIds: string[]) {
  const [first, ...rest] = organizationIds;
  const email = `partner${++seq}@firm.ps`;
  const created = (await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId: first }, admin)))) as { user: { id: string }; initialPassword: string };
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.initialPassword }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return (profile: string, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
}

async function owed(h: Harness, as: (p: string, e?: Record<string, string>) => Record<string, string>, profile: string, amount = '500.00') {
  const customer = (await read(await h.app.request('/v1/customers', json({ name: 'Nadia' }, { ...as(profile), ...idem() })))) as { id: string };
  const created = await read(await h.app.request('/v1/income', json({ kind: 'owed', amount, currency: 'ILS', occurredOn: '2026-10-08', customerId: customer.id }, { ...as(profile), ...idem() })));
  return { customer, receivableId: created.id as string };
}

/**
 * Arms the next `payments.create` to throw InsufficientCapacity — exactly what
 * applyAllocations' FOR UPDATE re-read raises when a concurrent settle drained
 * the receivable between this request's read and its write.
 */
function capacityLostOnce(store: MemoryLedgerStore): LedgerStore {
  let armed = true;
  return new Proxy(store, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value === 'function') return value.bind(target);
      if (prop !== 'payments' || typeof value !== 'object' || value === null) return value;
      return new Proxy(value, {
        get(repo, method) {
          const fn: unknown = Reflect.get(repo, method, repo);
          if (method !== 'create' || typeof fn !== 'function') return fn;
          return (...args: unknown[]) => {
            if (!armed) return (fn as (...a: unknown[]) => unknown).apply(repo, args);
            armed = false;
            throw new InsufficientCapacity('the-receivable-that-lost-the-race');
          };
        },
      });
    },
  }) as LedgerStore;
}

async function setup(wrap?: (store: MemoryLedgerStore) => LedgerStore) {
  const h = harness(wrap);
  const { p, m } = await orgs(h);
  const as = await person(h, [p.id, m.id]);
  return { h, p, m, as };
}

/**
 * A receivable the app did not capture: posted from a FIXED agreement's
 * installment, so `origin === 'INSTALLMENT'`. Written straight to the store,
 * the way routes-m4.test.ts / the M4 store contract seed their fixtures —
 * there is no session route that can produce one.
 */
async function installmentReceivable(h: Harness, organizationId: string) {
  const at = h.clock.now;
  const customer = await h.store.customers.create({ organizationId, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at);
  const project = await h.store.projects.create({ organizationId, customerId: customer.id, name: 'Case', currency: 'ILS' }, at);
  const { installments } = await h.store.agreements.create(
    {
      organizationId,
      projectId: project.id,
      customerId: customer.id,
      type: 'FIXED',
      currency: 'ILS',
      pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'EXEMPT',
      vatRateBasisPoints: 0,
      amountMinor: 50000n,
      netMinor: 50000n,
      vatMinor: 0n,
      grossMinor: 50000n,
      agreementDate: '2026-10-08',
      description: null,
      paymentTerms: 'EOM',
      startMonth: null,
      billingDay: null,
      endMonth: null,
      installments: [{ position: 1, label: 'I1', amountMinor: 50000n, netMinor: 50000n, vatMinor: 0n, grossMinor: 50000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
    },
    at,
  );
  const posted = await h.store.agreements.postInstallment(organizationId, installments[0]!.id, { postingDate: '2026-10-08', dueDate: '2026-10-31', at });
  return posted!.receivable;
}

const settle = (h: Harness, as: ReturnType<typeof person> extends Promise<infer T> ? T : never, profile: string, receivableId: string, body: Record<string, unknown> = {}) =>
  h.app.request(`/v1/receivables/${receivableId}/settle`, json(body, { ...as(profile), ...idem() }));

describe('POST /v1/receivables/{id}/settle', () => {
  it('full-amount settle (no amount given) → 201; receivable SETTLED; one Payment with one allocation', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id, '500.00');
    const res = await settle(h, as, p.id, receivableId);
    expect(res.status).toBe(201);
    const body = await read(res);
    // The wire `status` is the computed display status (ItemStatus: PENDING/DUE/OVERDUE/PARTIALLY_PAID/PAID/VOID), not the stored OPEN|SETTLED.
    expect(body.receivable).toMatchObject({ id: receivableId, status: 'PAID', outstanding: '0.00' });
    expect(body.payment).toMatchObject({ amount: '500.00', allocated: '500.00' });
    expect(body.payment.allocations).toHaveLength(1);
    expect(await h.store.receivables.getById(p.id, receivableId)).toMatchObject({ status: 'SETTLED', paidMinor: 50000n });
  });

  it('partial settle (amount less than outstanding) → stays OPEN; paid increases by exactly amount', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id, '500.00');
    const res = await settle(h, as, p.id, receivableId, { amount: '200.00' });
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body.receivable).toMatchObject({ status: 'PARTIALLY_PAID', paid: '200.00', outstanding: '300.00' });
    expect(await h.store.receivables.getById(p.id, receivableId)).toMatchObject({ status: 'OPEN', paidMinor: 20000n });
  });

  it('amount greater than outstanding → 422 ALLOCATION_EXCEEDS_OUTSTANDING; nothing written', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id, '500.00');
    const res = await settle(h, as, p.id, receivableId, { amount: '600.00' });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALLOCATION_EXCEEDS_OUTSTANDING' });
    const list = await read(await h.app.request('/v1/payments', { headers: as(p.id) }));
    expect(list.items).toEqual([]);
  });

  it('paidAt in the future → 422', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id);
    const res = await settle(h, as, p.id, receivableId, { paidAt: '2026-10-13' });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'DATE_INVALID', field: 'paidAt' });
  });

  it('paidAt omitted defaults to today; a backdated paidAt lands on the payment’s receivedOn', async () => {
    const { h, p, as } = await setup();
    const today = await owed(h, as, p.id);
    const todayRes = await read(await settle(h, as, p.id, today.receivableId));
    expect(todayRes.payment.receivedOn).toBe('2026-10-12');

    const backdated = await owed(h, as, p.id);
    const backdatedRes = await read(await settle(h, as, p.id, backdated.receivableId, { paidAt: '2026-09-01' }));
    expect(backdatedRes.payment.receivedOn).toBe('2026-09-01');
  });

  it('idempotency: replay with the same key → the same result, no second payment row', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id);
    const key = { ...as(p.id), 'idempotency-key': 'settle-key-01' };
    const first = await h.app.request(`/v1/receivables/${receivableId}/settle`, json({}, key));
    const again = await h.app.request(`/v1/receivables/${receivableId}/settle`, json({}, key));
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await read(again)).toEqual(await read(first));
    const list = await read(await h.app.request('/v1/payments', { headers: as(p.id) }));
    expect(list.items).toHaveLength(1);
  });

  it('on M (Malafat-fed) → 403 READ_ONLY_PROFILE { domain: payments }, before any receivable lookup', async () => {
    const { h, m, as } = await setup();
    const res = await h.app.request('/v1/receivables/00000000-0000-4000-8000-0000000000aa/settle', json({}, { ...as(m.id), ...idem() }));
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { domain: 'payments', writerOfRecord: 'MALAFAT' } });
  });

  it('a receivable from a different organization, authenticated on P → 404', async () => {
    const { h, p, as } = await setup();
    const other = harness();
    const otherOrgs = await orgs(other);
    const otherAs = await person(other, [otherOrgs.p.id]);
    const { receivableId } = await owed(other, otherAs, otherOrgs.p.id);
    const res = await settle(h, as, p.id, receivableId);
    expect(res.status).toBe(404);
  });

  it('a non-ADJUSTMENT receivable (an installment, Malafat’s to settle through the allocation engine) → 404, nothing written', async () => {
    const { h, p, as } = await setup();
    const receivable = await installmentReceivable(h, p.id);
    const res = await settle(h, as, p.id, receivable.id);
    expect(res.status).toBe(404);
    expect((await read(res)).error.code).toBe('NOT_FOUND');
    // Untouched: no payment, no allocation, no movement on the receivable.
    expect(await h.store.receivables.getById(p.id, receivable.id)).toMatchObject({ status: 'OPEN', paidMinor: 0n });
    const list = await read(await h.app.request('/v1/payments', { headers: as(p.id) }));
    expect(list.items).toEqual([]);
  });

  it('settling an already-SETTLED receivable → 422 RECEIVABLE_NOT_OPEN (reused from credit’s existing check)', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id, '100.00');
    await settle(h, as, p.id, receivableId);
    const res = await settle(h, as, p.id, receivableId);
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'RECEIVABLE_NOT_OPEN' });
  });

  it('a concurrent settle drains the receivable first (InsufficientCapacity) → 409 VERSION_MISMATCH, not 500', async () => {
    const { h, p, as } = await setup(capacityLostOnce);
    const { receivableId } = await owed(h, as, p.id, '500.00');
    const res = await settle(h, as, p.id, receivableId);
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'VERSION_MISMATCH' } });
  });

  it('missing Idempotency-Key → 422', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id);
    const res = await h.app.request(`/v1/receivables/${receivableId}/settle`, json({}, as(p.id)));
    expect(res.status).toBe(422);
  });

  it('method defaults CASH, can be set to BANK; captureSource lands on the audit metadata', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id);
    const res = await read(await settle(h, as, p.id, receivableId, { method: 'BANK', captureSource: 'widget' }));
    expect(res.payment.method).toBe('BANK');
    const events = (await h.store.audit.list(p.id, { action: 'payment.recorded' }, { limit: 10, cursor: null })).items;
    expect(events[0]!.metadata).toMatchObject({ captureSource: 'widget' });
  });

  it('audits payment.recorded and receivable.settled with actorType USER', async () => {
    const { h, p, as } = await setup();
    const { receivableId } = await owed(h, as, p.id);
    await settle(h, as, p.id, receivableId);
    const recorded = (await h.store.audit.list(p.id, { action: 'payment.recorded' }, { limit: 10, cursor: null })).items;
    const settled = (await h.store.audit.list(p.id, { action: 'receivable.settled' }, { limit: 10, cursor: null })).items;
    expect(recorded).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ actorType: 'USER' });
    expect(settled[0]).toMatchObject({ actorType: 'USER' });
  });
});
