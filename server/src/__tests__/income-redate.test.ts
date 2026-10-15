import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { OWED_REDATED, PAYMENT_REDATED } from '../routes/audit.js';

/**
 * MUT-223: PATCH /v1/income/{id} and PATCH /v1/payments/{id} change the date of a person's own Owed entry or
 * captured payment, on a profile they own, optimistically (If-Match). Plan: .claude/designs/mut-223-hosted-redate-api.md.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

function harness(start = '2026-10-12T09:00:00Z') {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date(start) };
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
  return { app, store, clock };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const idem = () => ({ 'idempotency-key': `key-${++seq}-${Math.random().toString(36).slice(2, 8)}` });
const patch = (body: unknown, headers: Record<string, string>, version: number | null) => json(body, version === null ? headers : { ...headers, 'if-match': String(version) }, 'PATCH');

/** A Malafat-connected firm, and a plain (non-Malafat, unowned) firm. */
async function firms(h: Harness) {
  const m = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const mKey = (await read(await h.app.request(`/admin/v1/organizations/${m.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string; apiKey: { id: string } };
  await h.store.integrations.connect({ organizationId: m.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Firm', connectedByApiKeyId: mKey.apiKey.id, at: h.clock.now });
  const plain = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Plain ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  return { m, plain, mAuth: { authorization: `Bearer ${mKey.secret}` } };
}

/** A person in `firmIds` with their own personal (owned) profile; `as(profile)` is their cookie session on it. */
async function person(h: Harness, firmIds: string[]) {
  const [first, ...rest] = firmIds;
  const email = `partner${++seq}@firm.ps`;
  const created = await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId: first, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.initialPassword }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN });
  const device = async () => {
    const body = await read(await h.app.request('/v1/device-sessions', json({ email, password: created.initialPassword })));
    return (profile: string) => ({ authorization: `Bearer ${body.token as string}`, 'x-mutaba3a-profile': profile });
  };
  return { id: created.user.id as string, personal: created.personalProfile.id as string, as, device };
}

async function setup(start?: string) {
  const h = harness(start);
  const f = await firms(h);
  const u = await person(h, [f.m.id, f.plain.id]);
  const customer = (await read(await h.app.request('/v1/customers', json({ name: 'Nadia' }, { ...u.as(u.personal), ...idem() })))) as { id: string };
  return { h, ...f, u, customer };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function income(s: Setup, body: Record<string, unknown>, profile = s.u.personal) {
  const res = await s.h.app.request('/v1/income', json({ amount: '300.00', currency: 'ILS', occurredOn: '2026-10-08', ...body }, { ...s.u.as(profile), ...idem() }));
  expect(res.status).toBe(201);
  return read(res);
}
const owedEntry = (s: Setup) => income(s, { kind: 'owed', customerId: s.customer.id, dueDate: '2026-11-15' });
const receivedEntry = (s: Setup) => income(s, { kind: 'received', customerId: s.customer.id });

async function settle(s: Setup, receivableId: string) {
  const res = await s.h.app.request(`/v1/receivables/${receivableId}/settle`, json({ paidAt: '2026-10-10' }, { ...s.u.as(s.u.personal), ...idem() }));
  expect(res.status).toBe(201);
  return read(res);
}

const errorOf = async (res: Response) => (await read(res)).error;

describe('PATCH /v1/income/{id} on an Owed entry (AC1)', () => {
  it('moves the date, keeps the due date, bumps the version and says so in the response', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    expect(owed.version).toBe(1);

    const res = await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-09-29' }, s.u.as(s.u.personal), 1));
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ id: owed.id, kind: 'owed', occurredOn: '2026-09-29', dueDate: '2026-11-15', version: 2 });
    expect(await s.h.store.receivables.getById(s.u.personal, owed.id)).toMatchObject({ postingDate: '2026-09-29', dueDate: '2026-11-15', version: 2 });
  });
});

describe('PATCH /v1/income/{id} on a Received entry (AC2)', () => {
  it('moves the payment receivedOn', async () => {
    const s = await setup();
    const received = await receivedEntry(s);

    const res = await s.h.app.request(`/v1/income/${received.id}`, patch({ occurredOn: '2026-10-01' }, s.u.as(s.u.personal), received.version));
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ id: received.id, kind: 'received', occurredOn: '2026-10-01', version: 2 });
    const got = await read(await s.h.app.request(`/v1/payments/${received.id}`, { headers: s.u.as(s.u.personal) }));
    expect(got).toMatchObject({ receivedOn: '2026-10-01', version: 2 });
  });

  it('refuses a settle payment with 409 ALREADY_ALLOCATED, and changes nothing (D3)', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const { payment } = await settle(s, owed.id);

    const res = await s.h.app.request(`/v1/income/${payment.id}`, patch({ occurredOn: '2026-10-09' }, s.u.as(s.u.personal), payment.version));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: 'CONFLICT', details: { reason: 'ALREADY_ALLOCATED' } });
    expect(await s.h.store.payments.getById(s.u.personal, payment.id)).toMatchObject({ receivedOn: '2026-10-10', version: payment.version });
  });
});

describe('PATCH /v1/payments/{id} on a settle payment (AC3)', () => {
  it('moves receivedOn; the allocations, the settled entry and its amounts are unchanged', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const { payment } = await settle(s, owed.id);
    const before = await s.h.store.receivables.getById(s.u.personal, owed.id);

    const res = await s.h.app.request(`/v1/payments/${payment.id}`, patch({ receivedOn: '2026-10-09' }, s.u.as(s.u.personal), payment.version));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ id: payment.id, receivedOn: '2026-10-09', version: payment.version + 1, allocated: payment.allocated });
    expect(body.allocations).toEqual(payment.allocations);
    const after = await s.h.store.receivables.getById(s.u.personal, owed.id);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ status: 'SETTLED' });
  });
});

describe('versions and dates (AC4)', () => {
  it('a stale version → 409 VERSION_MISMATCH with the current version, and nothing changes', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-01' }, s.u.as(s.u.personal), 1));

    const res = await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-09-01' }, s.u.as(s.u.personal), 1));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: 'CONFLICT', details: { reason: 'VERSION_MISMATCH', currentVersion: 2 } });
    expect(await s.h.store.receivables.getById(s.u.personal, owed.id)).toMatchObject({ postingDate: '2026-10-01' });
  });

  it('a stale version on a payment → 409 on both routes, nothing changes and only one audit row exists', async () => {
    const s = await setup();
    const received = await receivedEntry(s);
    const headers = s.u.as(s.u.personal);
    expect((await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2026-10-03' }, headers, 1))).status).toBe(200);

    for (const [path, body] of [[`/v1/payments/${received.id}`, { receivedOn: '2026-10-01' }], [`/v1/income/${received.id}`, { occurredOn: '2026-10-01' }]] as const) {
      const res = await s.h.app.request(path, patch(body, headers, 1));
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toMatchObject({ code: 'CONFLICT', details: { reason: 'VERSION_MISMATCH', currentVersion: 2 } });
    }
    expect(await s.h.store.payments.getById(s.u.personal, received.id)).toMatchObject({ receivedOn: '2026-10-03', version: 2 });
    expect((await s.h.store.audit.list(s.u.personal, { action: PAYMENT_REDATED }, { limit: 10, cursor: null })).items).toHaveLength(1);
  });

  it('an Owed entry edited with the version it had before a settle → 409 (settle bumps the version)', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    await settle(s, owed.id);

    const res = await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-01' }, s.u.as(s.u.personal), owed.version));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ details: { reason: 'VERSION_MISMATCH' } });
  });

  it("a date after the org's today → 422 (reason DATE_INVALID); the org's today is the limit, not UTC's", async () => {
    const s = await setup('2026-10-12T20:30:00Z');
    const received = await receivedEntry(s);
    // 21:30 UTC on the 12th is already the 13th in Jerusalem (UTC+3); the session is an hour old, well inside its limits.
    s.h.clock.now = new Date('2026-10-12T21:30:00Z');
    const future = await s.h.app.request(`/v1/income/${received.id}`, patch({ occurredOn: '2026-10-14' }, s.u.as(s.u.personal), 1));
    expect(future.status).toBe(422);
    expect(await errorOf(future)).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'DATE_INVALID', field: 'occurredOn' } });

    const today = await s.h.app.request(`/v1/income/${received.id}`, patch({ occurredOn: '2026-10-13' }, s.u.as(s.u.personal), 1));
    expect(today.status).toBe(200);
  });

  it('a malformed or future date, a missing If-Match or an extra field → 422', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const headers = s.u.as(s.u.personal);
    expect((await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-02-30' }, headers, 1))).status).toBe(422);
    expect((await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-01' }, headers, null))).status).toBe(422);
    expect((await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-01', amount: '1.00' }, headers, 1))).status).toBe(422);
    expect((await s.h.app.request(`/v1/payments/${owed.id}`, patch({ receivedOn: 'yesterday' }, headers, 1))).status).toBe(422);

    const received = await receivedEntry(s);
    expect((await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2026-10-01' }, headers, null))).status).toBe(422);
    const future = await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2026-10-13' }, headers, 1));
    expect(future.status).toBe(422);
    expect(await errorOf(future)).toMatchObject({ details: { reason: 'DATE_INVALID', field: 'receivedOn' } });
    expect(await s.h.store.payments.getById(s.u.personal, received.id)).toMatchObject({ receivedOn: '2026-10-08', version: 1 });
    expect(await s.h.store.receivables.getById(s.u.personal, owed.id)).toMatchObject({ postingDate: '2026-10-08', version: 1 });
  });

  it('a date more than ten years back → 422 bound past on both routes, nothing moved; the floor day is accepted (MUT-227)', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const received = await receivedEntry(s);
    const headers = s.u.as(s.u.personal);

    const oldOwed = await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '0001-01-01' }, headers, 1));
    expect(oldOwed.status).toBe(422);
    expect(await errorOf(oldOwed)).toMatchObject({ details: { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' } });
    const oldPayment = await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2016-10-03' }, headers, 1));
    expect(oldPayment.status).toBe(422);
    expect(await errorOf(oldPayment)).toMatchObject({ details: { reason: 'DATE_INVALID', field: 'receivedOn', bound: 'past' } });
    expect(await s.h.store.receivables.getById(s.u.personal, owed.id)).toMatchObject({ postingDate: '2026-10-08', version: 1 });
    expect(await s.h.store.payments.getById(s.u.personal, received.id)).toMatchObject({ receivedOn: '2026-10-08', version: 1 });

    expect((await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2016-10-04' }, headers, 1))).status).toBe(200);
    expect((await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2016-10-04' }, headers, 1))).status).toBe(200);
  });
});

describe('what may not be touched (AC5)', () => {
  it("another person's entry → 404 on both routes", async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const received = await receivedEntry(s);
    const other = await person(s.h, [s.m.id]);

    expect((await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-01' }, other.as(other.personal), 1))).status).toBe(404);
    expect((await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2026-10-01' }, other.as(other.personal), 1))).status).toBe(404);
    expect(await s.h.store.receivables.getById(s.u.personal, owed.id)).toMatchObject({ postingDate: '2026-10-08' });
  });

  it('an entry on a firm profile the person does not own → 404 (owned profiles only)', async () => {
    const s = await setup();
    const c = (await read(await s.h.app.request('/v1/customers', json({ name: 'Firm client' }, { ...s.u.as(s.plain.id), ...idem() })))) as { id: string };
    const owed = await income(s, { kind: 'owed', customerId: c.id }, s.plain.id);

    const res = await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-01' }, s.u.as(s.plain.id), 1));
    expect(res.status).toBe(404);
    expect(await s.h.store.receivables.getById(s.plain.id, owed.id)).toMatchObject({ postingDate: '2026-10-08' });
  });

  it('a capture on a firm profile the person does not own → 404 via /v1/payments too (the session holds payments:write there)', async () => {
    const s = await setup();
    const c = (await read(await s.h.app.request('/v1/customers', json({ name: 'Firm client' }, { ...s.u.as(s.plain.id), ...idem() })))) as { id: string };
    const received = await income(s, { kind: 'received', customerId: c.id }, s.plain.id);

    const res = await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2026-10-01' }, s.u.as(s.plain.id), received.version));
    expect(res.status).toBe(404);
    expect(await s.h.store.payments.getById(s.plain.id, received.id)).toMatchObject({ receivedOn: '2026-10-08', version: received.version });
  });

  it("a Malafat-fed profile's capture → 404 via /v1/income, 403 READ_ONLY_PROFILE via /v1/payments (D2)", async () => {
    const s = await setup();
    const capture = await s.h.store.payments.capture({ organizationId: s.m.id, customerId: null, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-08', method: 'CASH', notes: null, requestId: null, createdByUserId: s.u.id, captureSource: 'app' }, s.h.clock.now);

    expect((await s.h.app.request(`/v1/income/${capture.id}`, patch({ occurredOn: '2026-10-01' }, s.u.as(s.m.id), 1))).status).toBe(404);
    const viaPayments = await s.h.app.request(`/v1/payments/${capture.id}`, patch({ receivedOn: '2026-10-01' }, s.u.as(s.m.id), 1));
    expect(viaPayments.status).toBe(403);
    expect(await errorOf(viaPayments)).toMatchObject({ code: 'READ_ONLY_PROFILE' });
    expect(await s.h.store.payments.getById(s.m.id, capture.id)).toMatchObject({ receivedOn: '2026-10-08', version: 1 });
  });

  it('an INTEGRATION payment and an INSTALLMENT receivable on the person’s own profile → 404', async () => {
    const s = await setup();
    const p = s.u.personal;
    const project = await s.h.store.projects.create({ organizationId: p, customerId: s.customer.id, name: 'Matter', currency: 'ILS' }, s.h.clock.now);
    const { installments } = await s.h.store.agreements.create(
      {
        organizationId: p, projectId: project.id, customerId: s.customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0,
        amountMinor: 5000n, netMinor: 5000n, vatMinor: 0n, grossMinor: 5000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null,
        installments: [{ position: 1, label: 'I1', amountMinor: 5000n, netMinor: 5000n, vatMinor: 0n, grossMinor: 5000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
      },
      s.h.clock.now,
    );
    const posted = await s.h.store.agreements.postInstallment(p, installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-31', at: s.h.clock.now });
    const receivable = posted!.receivable;
    const { payment } = await s.h.store.payments.create({ organizationId: p, customerId: s.customer.id, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-05', method: 'BANK', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: receivable.id, amountMinor: 1000n }] }, s.h.clock.now);

    const headers = s.u.as(p);
    expect((await s.h.app.request(`/v1/income/${receivable.id}`, patch({ occurredOn: '2026-09-01' }, headers, receivable.version))).status).toBe(404);
    expect((await s.h.app.request(`/v1/income/${payment.id}`, patch({ occurredOn: '2026-09-01' }, headers, payment.version))).status).toBe(404);
    expect((await s.h.app.request(`/v1/payments/${payment.id}`, patch({ receivedOn: '2026-09-01' }, headers, payment.version))).status).toBe(404);
    expect(await s.h.store.payments.getById(p, payment.id)).toMatchObject({ receivedOn: '2026-10-05' });
  });

  it('a voided Owed entry and an undone Received entry → 404', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const received = await receivedEntry(s);
    const headers = s.u.as(s.u.personal);
    expect((await s.h.app.request(`/v1/income/${owed.id}`, { method: 'DELETE', headers })).status).toBe(204);
    expect((await s.h.app.request(`/v1/income/${received.id}`, { method: 'DELETE', headers })).status).toBe(204);

    expect((await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-01' }, headers, 1))).status).toBe(404);
    expect((await s.h.app.request(`/v1/income/${received.id}`, patch({ occurredOn: '2026-10-01' }, headers, 2))).status).toBe(404);
    expect((await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2026-10-01' }, headers, 2))).status).toBe(404);
  });
});

describe('who may call (AC6)', () => {
  it('a device session re-dates; an API key is refused', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const device = await s.u.device();
    expect((await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-02' }, device(s.u.personal), 1))).status).toBe(200);

    const received = await receivedEntry(s);
    expect((await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2026-10-02' }, device(s.u.personal), 1))).status).toBe(200);

    const capture = await s.h.store.payments.capture({ organizationId: s.m.id, customerId: null, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-08', method: 'CASH', notes: null, requestId: null, createdByUserId: s.u.id, captureSource: 'app' }, s.h.clock.now);
    for (const [path, body] of [[`/v1/income/${capture.id}`, { occurredOn: '2026-10-01' }], [`/v1/payments/${capture.id}`, { receivedOn: '2026-10-01' }]] as const) {
      const res = await s.h.app.request(path, patch(body, s.mAuth, 1));
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toMatchObject({ code: 'PRINCIPAL_NOT_ACCEPTED' });
    }
    expect(await s.h.store.payments.getById(s.m.id, capture.id)).toMatchObject({ receivedOn: '2026-10-08' });
  });
});

describe('the audit trail (AC7)', () => {
  it('records the old and new date for both kinds', async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const received = await receivedEntry(s);
    const headers = s.u.as(s.u.personal);
    await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-10-01' }, headers, 1));
    await s.h.app.request(`/v1/payments/${received.id}`, patch({ receivedOn: '2026-10-03' }, headers, 1));

    // Looked up by action, never by position: same-millisecond audit rows can tie (TODOS #8).
    const owedRows = (await s.h.store.audit.list(s.u.personal, { action: OWED_REDATED }, { limit: 10, cursor: null })).items;
    expect(owedRows).toHaveLength(1);
    expect(owedRows[0]).toMatchObject({ actorType: 'USER', actorId: s.u.id, entityType: 'receivable', entityId: owed.id, metadata: { from: '2026-10-08', to: '2026-10-01', version: 2 } });
    const paymentRows = (await s.h.store.audit.list(s.u.personal, { action: PAYMENT_REDATED }, { limit: 10, cursor: null })).items;
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]).toMatchObject({ entityType: 'payment', entityId: received.id, metadata: { from: '2026-10-08', to: '2026-10-03', version: 2 } });
  });

  it("Malafat's GET /v1/audit never lists re-date events, but still lists other payment events", async () => {
    const s = await setup();
    for (const action of [PAYMENT_REDATED, OWED_REDATED, 'payment.recorded']) {
      await s.h.store.audit.append({ organizationId: s.m.id, actorType: 'USER', actorId: s.u.id, action, entityType: action.startsWith('income') ? 'receivable' : 'payment', entityId: 'e1', requestId: null });
    }
    const res = await s.h.app.request('/v1/audit', { headers: s.mAuth });
    expect(res.status).toBe(200);
    const actions = ((await read(res)).items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('payment.recorded');
    expect(actions).not.toContain(PAYMENT_REDATED);
    expect(actions).not.toContain(OWED_REDATED);
  });
});

describe('derived reads follow the new date (AC8)', () => {
  it('a Received entry moved into last month leaves this month’s payment window and enters last month’s', async () => {
    const s = await setup();
    const received = await receivedEntry(s);
    const headers = s.u.as(s.u.personal);
    const window = async (from: string, to: string) =>
      ((await read(await s.h.app.request(`/v1/payments?receivedAfter=${from}&receivedBefore=${to}`, { headers }))).items as Array<{ id: string }>).map((p) => p.id);
    expect(await window('2026-10-01', '2026-10-31')).toContain(received.id);

    await s.h.app.request(`/v1/income/${received.id}`, patch({ occurredOn: '2026-09-20' }, headers, 1));
    expect(await window('2026-10-01', '2026-10-31')).not.toContain(received.id);
    expect(await window('2026-09-01', '2026-09-30')).toContain(received.id);
  });

  it("the client summary's lastPaymentOn and the receivable's postingDate follow", async () => {
    const s = await setup();
    const owed = await owedEntry(s);
    const { payment } = await settle(s, owed.id);
    const headers = s.u.as(s.u.personal);
    await s.h.app.request(`/v1/payments/${payment.id}`, patch({ receivedOn: '2026-10-09' }, headers, payment.version));
    await s.h.app.request(`/v1/income/${owed.id}`, patch({ occurredOn: '2026-09-30' }, headers, (await s.h.store.receivables.getById(s.u.personal, owed.id))!.version));

    const summary = await read(await s.h.app.request(`/v1/summaries/customers/${s.customer.id}`, { headers }));
    expect(summary.lastPaymentOn).toBe('2026-10-09');
    expect(await read(await s.h.app.request(`/v1/receivables/${owed.id}`, { headers }))).toMatchObject({ postingDate: '2026-09-30' });
  });
});
