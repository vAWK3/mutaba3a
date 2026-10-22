import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-270: GET /v1/entries — one newest-first feed of a person's expenses, received payments, Owed entries
 * and conversions across their profiles. Session-only, organization-independent (no X-Mutaba3a-Profile).
 * Mirrors income-routes.test.ts conventions.
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
  const clock = { now: new Date('2026-10-12T09:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
  });
  /** Every write lands one second after the last, so createdAt order is the order the test wrote things in. */
  const tick = () => {
    clock.now = new Date(clock.now.getTime() + 1000);
  };
  return { app, store, clock, tick };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function organization(h: Harness, name: string) {
  return (await read(await h.app.request('/admin/v1/organizations', json({ name: `${name} ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
}

async function malafatKey(h: Harness, organizationId: string) {
  const key = (await read(await h.app.request(`/admin/v1/organizations/${organizationId}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string; apiKey: { id: string } };
  await h.store.integrations.connect({ organizationId, provider: 'MALAFAT', externalTenantId: `tenant-${++seq}`, displayName: 'Firm', connectedByApiKeyId: key.apiKey.id, at: h.clock.now });
  return { authorization: `Bearer ${key.secret}` };
}

async function person(h: Harness, organizationIds: string[]) {
  const [first, ...rest] = organizationIds;
  const email = `partner${++seq}@firm.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: first });
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const session = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  const as = (profile: string) => ({ ...session, 'x-mutaba3a-profile': profile });
  return { session, as, userId: created.user.id };
}

type Person = Awaited<ReturnType<typeof person>>;

/** Two profiles the person writes to: A and B (both personal, no Malafat). */
async function setup() {
  const h = harness();
  const a = await organization(h, 'Studio');
  const b = await organization(h, 'Side');
  const u = await person(h, [a.id, b.id]);
  const feed = (query = '', headers: Record<string, string> = u.session) => h.app.request(`/v1/entries${query}`, { headers });
  return { h, a, b, u, feed };
}

async function expense(h: Harness, u: Person, profile: string, amount = '40.00') {
  h.tick();
  const res = await h.app.request('/v1/expenses', json({ occurredOn: '2026-10-08', amount, currency: 'ILS', title: 'Paper' }, { ...u.as(profile), ...idem() }));
  expect(res.status).toBe(201);
  return (await read(res)) as { id: string };
}

async function conversion(h: Harness, u: Person, profile: string) {
  h.tick();
  const res = await h.app.request('/v1/conversions', json({ occurredOn: '2026-10-08', amount: '100.00', currency: 'USD', toAmount: '370.00', toCurrency: 'ILS' }, { ...u.as(profile), ...idem() }));
  expect(res.status).toBe(201);
  return (await read(res)) as { id: string };
}

async function income(h: Harness, u: Person, profile: string, body: Record<string, unknown>) {
  h.tick();
  const res = await h.app.request('/v1/income', json({ amount: '250.00', currency: 'ILS', occurredOn: '2026-10-08', ...body }, { ...u.as(profile), ...idem() }));
  expect(res.status).toBe(201);
  return (await read(res)) as { id: string };
}

async function customer(h: Harness, headers: Record<string, string>, name = 'Nadia') {
  const res = await h.app.request('/v1/customers', json({ name }, { ...headers, ...idem() }));
  return (await read(res)) as { id: string };
}

const ids = (body: Loose) => (body.items as Array<{ kind: string; expense?: { id: string }; income?: { id: string }; conversion?: { id: string } }>).map((i) => (i.expense ?? i.income ?? i.conversion)!.id);

describe('GET /v1/entries — order and shape', () => {
  it('returns every kind across profiles, newest logged first, each with its envelope', async () => {
    const { h, a, b, u, feed } = await setup();
    const e1 = await expense(h, u, a.id);
    const r1 = await income(h, u, b.id, { kind: 'received' });
    const c1 = await conversion(h, u, a.id);
    const customerB = await customer(h, u.as(b.id));
    const o1 = await income(h, u, b.id, { kind: 'owed', customerId: customerB.id, title: 'Logo' });

    const res = await feed();
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(ids(body)).toEqual([o1.id, c1.id, r1.id, e1.id]);
    expect(body.nextCursor).toBeNull();

    const [owed, conv, received, exp] = body.items;
    expect(owed).toMatchObject({ kind: 'owed', profileId: b.id, createdByUserId: u.userId, income: { id: o1.id, kind: 'owed', status: 'open', title: 'Logo' } });
    expect(conv).toMatchObject({ kind: 'conversion', profileId: a.id, createdByUserId: u.userId, conversion: { id: c1.id, currency: 'USD', toCurrency: 'ILS' } });
    expect(received).toMatchObject({ kind: 'received', profileId: b.id, origin: 'capture', createdByUserId: u.userId, income: { id: r1.id, status: 'unallocated' } });
    expect(exp).toMatchObject({ kind: 'expense', profileId: a.id, createdByUserId: u.userId, expense: { id: e1.id, amount: '40.00', receiptCount: 0 } });
    for (const item of body.items) expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
  });

  it('pages with a stable cursor: every row once, and a row logged between pages does not shift later pages', async () => {
    const { h, a, u, feed } = await setup();
    const made = [];
    for (let i = 0; i < 5; i++) made.push((await expense(h, u, a.id, `${10 + i}.00`)).id);
    const newestFirst = [...made].reverse();

    const first = await read(await feed('?limit=2'));
    expect(ids(first)).toEqual(newestFirst.slice(0, 2));
    expect(typeof first.nextCursor).toBe('string');

    await expense(h, u, a.id, '99.00'); // newer than everything: belongs before page one, not in page two

    const second = await read(await feed(`?limit=2&cursor=${first.nextCursor}`));
    expect(ids(second)).toEqual(newestFirst.slice(2, 4));
    const third = await read(await feed(`?limit=2&cursor=${second.nextCursor}`));
    expect(ids(third)).toEqual(newestFirst.slice(4));
    expect(third.nextCursor).toBeNull();
  });
});

describe('GET /v1/entries — which profiles', () => {
  it('spans every membership without a filter, narrows to the named profiles with one, and dedupes a repeated id', async () => {
    const { h, a, b, u, feed } = await setup();
    const ea = await expense(h, u, a.id);
    const eb = await expense(h, u, b.id);

    expect(ids(await read(await feed()))).toEqual([eb.id, ea.id]);
    expect(ids(await read(await feed(`?profileId=${a.id}`)))).toEqual([ea.id]);
    expect(ids(await read(await feed(`?profileId=${a.id}&profileId=${b.id}`)))).toEqual([eb.id, ea.id]);
    expect(ids(await read(await feed(`?profileId=${a.id}&profileId=${a.id}`)))).toEqual([ea.id]);
  });

  it('answers 404 alike for another person\'s profile, an unknown id and a malformed one', async () => {
    const { h, a, feed } = await setup();
    const elsewhere = await organization(h, 'Elsewhere');
    const stranger = await person(h, [elsewhere.id]);
    await expense(h, stranger, elsewhere.id);

    const foreign = await feed(`?profileId=${elsewhere.id}`);
    const unknown = await feed('?profileId=6f1c2d3e-4b5a-4c6d-8e7f-001122334455');
    const malformed = await feed('?profileId=not-a-uuid');
    const mixed = await feed(`?profileId=${a.id}&profileId=${elsewhere.id}`);

    for (const res of [foreign, unknown, malformed, mixed]) expect(res.status).toBe(404);
    const bodies = await Promise.all([foreign, unknown, malformed, mixed].map(read));
    for (const body of bodies) expect(body.error.code).toBe('NOT_FOUND');
    expect(new Set(bodies.map((b) => b.error.message)).size).toBe(1);
  });

  it('ignores an X-Mutaba3a-Profile header: the feed names no profile', async () => {
    const { h, a, b, u, feed } = await setup();
    const ea = await expense(h, u, a.id);
    const eb = await expense(h, u, b.id);
    expect(ids(await read(await feed('', u.as(a.id))))).toEqual([eb.id, ea.id]);
  });
});

describe('GET /v1/entries — what counts as an entry', () => {
  it('leaves out deleted and undone entries, keeps a Malafat-reversed payment', async () => {
    const { h, a, b, u, feed } = await setup();
    const keep = await expense(h, u, a.id);
    const gone = await expense(h, u, a.id);
    expect((await h.app.request(`/v1/expenses/${gone.id}`, { method: 'DELETE', headers: u.as(a.id) })).status).toBe(204);
    const conv = await conversion(h, u, a.id);
    expect((await h.app.request(`/v1/conversions/${conv.id}`, { method: 'DELETE', headers: u.as(a.id) })).status).toBe(204);
    const capture = await income(h, u, b.id, { kind: 'received' });
    expect((await h.app.request(`/v1/income/${capture.id}`, { method: 'DELETE', headers: u.as(b.id) })).status).toBe(204);
    const customerB = await customer(h, u.as(b.id));
    const owed = await income(h, u, b.id, { kind: 'owed', customerId: customerB.id, title: 'Logo' });
    expect((await h.app.request(`/v1/income/${owed.id}`, { method: 'DELETE', headers: u.as(b.id) })).status).toBe(204);

    const firm = await organization(h, 'Firm');
    const key = await malafatKey(h, firm.id);
    await h.app.request(`/admin/v1/users/${u.userId}/memberships`, json({ organizationId: firm.id }, admin));
    const client = await customer(h, key);
    h.tick();
    const { payment } = await h.store.payments.create(
      { organizationId: firm.id, customerId: client.id, projectId: null, currency: 'ILS', amountMinor: 30_000n, receivedOn: '2026-10-08', method: 'BANK', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [] },
      h.clock.now,
    );
    await h.store.payments.reverse(firm.id, payment.id, 'bounced', h.clock.now);

    const body = await read(await feed());
    expect(ids(body)).toEqual([payment.id, keep.id]);
    expect(body.items[0]).toMatchObject({ kind: 'received', profileId: firm.id, origin: 'integration', createdByUserId: null, income: { status: 'reversed' } });
  });

  it('reads how much Malafat has applied: partial, allocated; a fresh capture stays unallocated', async () => {
    const { h, u, feed } = await setup();
    const firm = await organization(h, 'Firm');
    const key = await malafatKey(h, firm.id);
    await h.app.request(`/admin/v1/users/${u.userId}/memberships`, json({ organizationId: firm.id }, admin));
    const client = await customer(h, key);
    const owed = (gross: bigint) =>
      h.store.receivables.createAdjustment(
        { organizationId: firm.id, customerId: client.id, projectId: null, currency: 'ILS', netMinor: gross, vatMinor: 0n, grossMinor: gross, vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, title: 'Fee', dueDate: '2026-10-31', postingDate: '2026-10-08', postedAt: h.clock.now, createdByUserId: u.userId, requestId: null },
        h.clock.now,
      );
    const pay = async (amountMinor: bigint, allocations: Array<{ receivableId: string; amountMinor: bigint }>) => {
      h.tick();
      return (await h.store.payments.create({ organizationId: firm.id, customerId: client.id, projectId: null, currency: 'ILS', amountMinor, receivedOn: '2026-10-08', method: 'BANK', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations }, h.clock.now)).payment;
    };
    const r1 = await owed(10_000n);
    const r2 = await owed(5_000n);
    const partial = await pay(10_000n, [{ receivableId: r1.id, amountMinor: 4_000n }]);
    const full = await pay(5_000n, [{ receivableId: r2.id, amountMinor: 5_000n }]);

    const body = await read(await feed(`?profileId=${firm.id}`));
    const byId = new Map((body.items as Loose[]).filter((i) => i.kind === 'received').map((i) => [i.income.id, i]));
    expect(byId.get(partial.id)).toMatchObject({ origin: 'integration', income: { status: 'partial' } });
    expect(byId.get(full.id)).toMatchObject({ origin: 'integration', income: { status: 'allocated' } });
  });

  it('links a settle payment to the Owed it paid, and a Malafat correction to the payment it replaces', async () => {
    const { h, b, u, feed } = await setup();
    const customerB = await customer(h, u.as(b.id));
    const owed = await income(h, u, b.id, { kind: 'owed', customerId: customerB.id, title: 'Logo' });
    h.tick();
    expect((await h.app.request(`/v1/receivables/${owed.id}/settle`, json({}, { ...u.as(b.id), ...idem() }))).status).toBe(201);
    const fresh = await income(h, u, b.id, { kind: 'received' });

    const firm = await organization(h, 'Firm');
    const key = await malafatKey(h, firm.id);
    await h.app.request(`/admin/v1/users/${u.userId}/memberships`, json({ organizationId: firm.id }, admin));
    const client = await customer(h, key);
    const malafatPayment = (replacesPaymentId: string | null) =>
      h.store.payments.create({ organizationId: firm.id, customerId: client.id, projectId: null, currency: 'ILS', amountMinor: 30_000n, receivedOn: '2026-10-08', method: 'BANK', reference: null, notes: null, replacesPaymentId, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [] }, h.clock.now);
    h.tick();
    const original = (await malafatPayment(null)).payment;
    await h.store.payments.reverse(firm.id, original.id, 'corrected', h.clock.now);
    h.tick();
    const replacement = (await malafatPayment(original.id)).payment;

    const items = (await read(await feed())).items as Loose[];
    const received = new Map(items.filter((i) => i.kind === 'received').map((i) => [i.income.id, i]));
    const settle = items.find((i) => i.kind === 'received' && i.settlesOwedId === owed.id);
    expect(settle).toMatchObject({ origin: 'capture', replacesPaymentId: null, income: { status: 'allocated' } });
    expect(items.find((i) => i.kind === 'owed' && i.income.id === owed.id)).toMatchObject({ income: { status: 'settled' } });
    expect(received.get(fresh.id)).toMatchObject({ settlesOwedId: null, replacesPaymentId: null, income: { status: 'unallocated' } });
    expect(received.get(replacement.id)).toMatchObject({ origin: 'integration', replacesPaymentId: original.id, settlesOwedId: null });
    expect(received.get(original.id)).toMatchObject({ replacesPaymentId: null, income: { status: 'reversed' } });
  });

  it('links a partial settle to its Owed, which still reads open', async () => {
    const { h, b, u, feed } = await setup();
    const customerB = await customer(h, u.as(b.id));
    const owed = await income(h, u, b.id, { kind: 'owed', customerId: customerB.id, title: 'Logo', amount: '500.00' });
    h.tick();
    expect((await h.app.request(`/v1/receivables/${owed.id}/settle`, json({ amount: '200.00' }, { ...u.as(b.id), ...idem() }))).status).toBe(201);

    const items = (await read(await feed())).items as Loose[];
    expect(items.find((i) => i.kind === 'received')).toMatchObject({ settlesOwedId: owed.id, income: { amount: '200.00', status: 'allocated' } });
    expect(items.find((i) => i.kind === 'owed')).toMatchObject({ income: { id: owed.id, status: 'open' } });
  });

  it('shows only Owed a person recorded: scheduled installments stay out', async () => {
    const { h, b, u, feed } = await setup();
    const customerB = await customer(h, u.as(b.id));
    const owed = await income(h, u, b.id, { kind: 'owed', customerId: customerB.id, title: 'Logo' });
    // A posted installment: the schedule's own receivable, through the store's public agreement API.
    const project = await h.store.projects.create({ organizationId: b.id, customerId: customerB.id, name: 'Case', currency: 'ILS' }, h.clock.now);
    const { installments } = await h.store.agreements.create(
      {
        organizationId: b.id, projectId: project.id, customerId: customerB.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0,
        amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, grossMinor: 1_000n, agreementDate: '2026-10-08', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null,
        installments: [{ position: 1, label: 'I1', amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, grossMinor: 1_000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
      },
      h.clock.now,
    );
    h.tick();
    const posted = await h.store.agreements.postInstallment(b.id, installments[0]!.id, { postingDate: '2026-10-08', dueDate: '2026-10-31', at: h.clock.now });
    expect(posted?.receivable.origin).toBe('INSTALLMENT');

    expect(ids(await read(await feed()))).toEqual([owed.id]);
  });

  it('counts READY, live receipts only', async () => {
    const { h, a, u, feed } = await setup();
    const bare = await expense(h, u, a.id);
    const withReceipts = await expense(h, u, a.id);
    const receipt = async (state: 'ready' | 'pending' | 'deleted') => {
      const r = await h.store.expenseReceipts.create({ organizationId: a.id, expenseId: withReceipts.id, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: '2026-10-11', uploadedByUserId: u.userId, requestId: null }, h.clock.now);
      if (state !== 'pending') await h.store.expenseReceipts.complete(a.id, r.id, h.clock.now);
      if (state === 'deleted') await h.store.expenseReceipts.softDelete(a.id, r.id, h.clock.now);
    };
    await receipt('ready');
    await receipt('ready');
    await receipt('pending');
    await receipt('deleted');

    const body = await read(await feed());
    const counts = new Map((body.items as Loose[]).map((i) => [i.expense.id, i.expense.receiptCount]));
    expect(counts.get(withReceipts.id)).toBe(2);
    expect(counts.get(bare.id)).toBe(0);
  });
});

describe('GET /v1/entries — who may call it, and what it accepts', () => {
  it('refuses Malafat\'s key and an anonymous caller', async () => {
    const { h, feed } = await setup();
    const firm = await organization(h, 'Firm');
    const key = await malafatKey(h, firm.id);

    const byKey = await feed('', key);
    expect(byKey.status).toBe(403);
    expect((await read(byKey)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
    expect((await feed('', {})).status).toBe(401);
  });

  it('pages 20 at a time when no limit is given', async () => {
    const { h, a, u, feed } = await setup();
    for (let i = 0; i < 21; i++) await expense(h, u, a.id);

    const body = await read(await feed());
    expect(body.items).toHaveLength(20);
    expect(typeof body.nextCursor).toBe('string');
    expect((await read(await feed(`?cursor=${body.nextCursor}`))).items).toHaveLength(1);
  });

  it('rejects a cursor it did not issue and a limit outside 1..100', async () => {
    const { feed } = await setup();
    for (const query of ['?cursor=garbage', '?limit=0', '?limit=101', '?limit=two']) {
      const res = await feed(query);
      expect(res.status).toBe(422);
      expect((await read(res)).error.code).toBe('VALIDATION_FAILED');
    }
    expect((await feed('?limit=100')).status).toBe(200);
  });
});
