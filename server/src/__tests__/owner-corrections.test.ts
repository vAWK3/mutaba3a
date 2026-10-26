import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { sessionAccessFor } from '../auth/writability.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-453 (ADR-206): a person reverses a payment and credits what is owed on a profile whose payments they may write.
 * The same two routes Malafat's key uses, now also for a session or device session: only on a profile the person owns
 * (its creator or a co-owner, `ownsProfile`; qa-reconcile D1 amendment), and only on rows a person recorded (CAPTURE
 * payments, ADJUSTMENT receivables, review D5). A firm's members, a disconnected Malafat firm's included, get 403.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const MISSING = '00000000-0000-4000-8000-0000000000aa';

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-26T09:00:00Z') };
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
type As = (profile: string) => Record<string, string>;

const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const idem = () => ({ 'idempotency-key': `key-${++seq}-${Math.random().toString(36).slice(2, 8)}` });

/** A Malafat-connected firm (with its key) and a disconnected one: once connected, now not. */
async function firms(h: Harness) {
  const firm = async (name: string) => {
    const org = (await read(await h.app.request('/admin/v1/organizations', json({ name: `${name} ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
    const key = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string; apiKey: { id: string } };
    const integration = await h.store.integrations.connect({ organizationId: org.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: name, connectedByApiKeyId: key.apiKey.id, at: h.clock.now });
    return { id: org.id, key: { authorization: `Bearer ${key.secret}` }, integration };
  };
  const m = await firm('Connected');
  const gone = await firm('Disconnected');
  return { m, gone };
}

async function person(h: Harness, firmIds: string[]) {
  const [first, ...rest] = firmIds;
  const email = `owner${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: first, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as: As = (profile) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN });
  const device = async (): Promise<As> => {
    const body = await read(await h.app.request('/v1/device-sessions', json({ email, password: created.password })));
    return (profile) => ({ authorization: `Bearer ${body.token as string}`, 'x-mutaba3a-profile': profile });
  };
  return { id: created.user.id as string, personal: created.personalProfile.id as string, as, device };
}

async function setup() {
  const h = harness();
  const f = await firms(h);
  const u = await person(h, [f.m.id, f.gone.id]);
  // Disconnected after the person joined: the firm now reads as writer-null, so their session there holds payments:write.
  await h.store.integrations.disconnect(f.gone.integration.id, h.clock.now);
  return { h, ...f, u };
}

/** An Owed entry on `profile`, settled in full (or by `paid`) by the person: one CAPTURE payment, one allocation. */
async function settledOwed(h: Harness, as: As, profile: string, amount = '500.00', paid?: string) {
  const customer = (await read(await h.app.request('/v1/customers', json({ name: 'Ben Jamil' }, { ...as(profile), ...idem() })))) as { id: string };
  const owed = await read(await h.app.request('/v1/income', json({ kind: 'owed', amount, currency: 'ILS', occurredOn: '2026-10-08', customerId: customer.id }, { ...as(profile), ...idem() })));
  const settled = await read(await h.app.request(`/v1/receivables/${owed.id}/settle`, json(paid ? { amount: paid } : {}, { ...as(profile), ...idem() })));
  return { customerId: customer.id, receivableId: owed.id as string, paymentId: settled.payment.id as string };
}

async function openOwed(h: Harness, as: As, profile: string, amount = '100.00') {
  const customer = (await read(await h.app.request('/v1/customers', json({ name: 'Kabir Energy' }, { ...as(profile), ...idem() })))) as { id: string };
  const owed = await read(await h.app.request('/v1/income', json({ kind: 'owed', amount, currency: 'ILS', occurredOn: '2026-10-08', customerId: customer.id }, { ...as(profile), ...idem() })));
  return owed.id as string;
}

const reverse = (h: Harness, headers: Record<string, string>, paymentId: string, reason = 'Applied to the wrong job') =>
  h.app.request(`/v1/payments/${paymentId}/reverse`, json({ reason }, { ...headers, ...idem() }));
const credit = (h: Harness, headers: Record<string, string>, receivableId: string, amount: string, reason = 'Agreed a lower fee') =>
  h.app.request(`/v1/receivables/${receivableId}/credits`, json({ amount, reason }, { ...headers, ...idem() }));

/** What Malafat put on the disconnected firm's ledger while it was connected: an installment, and a payment allocated to it. */
async function malafatRows(h: Harness, organizationId: string) {
  const at = h.clock.now;
  const customer = await h.store.customers.create({ organizationId, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at);
  const project = await h.store.projects.create({ organizationId, customerId: customer.id, name: 'Case', currency: 'ILS' }, at);
  const { installments } = await h.store.agreements.create(
    {
      organizationId, projectId: project.id, customerId: customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0,
      amountMinor: 50000n, netMinor: 50000n, vatMinor: 0n, grossMinor: 50000n, agreementDate: '2026-10-08', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null,
      installments: [{ position: 1, label: 'I1', amountMinor: 50000n, netMinor: 50000n, vatMinor: 0n, grossMinor: 50000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
    },
    at,
  );
  const receivable = (await h.store.agreements.postInstallment(organizationId, installments[0]!.id, { postingDate: '2026-10-08', dueDate: '2026-10-31', at }))!.receivable;
  const { payment } = await h.store.payments.create(
    { organizationId, customerId: customer.id, projectId: project.id, currency: 'ILS', amountMinor: 20000n, receivedOn: '2026-10-09', method: 'BANK', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: receivable.id, amountMinor: 20000n }] },
    at,
  );
  return { receivable, payment };
}

describe('MUT-453: a person reverses a payment on their own profile', () => {
  it('undoes the allocation, reopens the Owed and audits payment.reversed by USER', async () => {
    const { h, u } = await setup();
    const { receivableId, paymentId } = await settledOwed(h, u.as, u.personal);

    const res = await reverse(h, u.as(u.personal), paymentId);
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ id: paymentId, status: 'REVERSED', reversalReason: 'Applied to the wrong job' });
    expect(await h.store.receivables.getById(u.personal, receivableId)).toMatchObject({ status: 'OPEN', paidMinor: 0n });

    const audit = (await h.store.audit.listByOrganization(u.personal, 50)).filter((e) => e.action === 'payment.reversed');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'USER', actorId: u.id, entityId: paymentId, metadata: { reason: 'Applied to the wrong job', allocationsUndone: 1 } });
  });

  it('a device session (the phone) may reverse too', async () => {
    const { h, u } = await setup();
    const { paymentId } = await settledOwed(h, u.as, u.personal);
    const device = await u.device();
    expect((await reverse(h, device(u.personal), paymentId)).status).toBe(200);
  });

  it('a co-owner reverses a payment the creator recorded (any person-recorded row, D2)', async () => {
    const { h, u } = await setup();
    const created = await read(await h.app.request('/v1/profiles', json({ name: 'Studio', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, { ...u.as(u.personal), ...idem() })));
    const partner = await person(h, []);
    expect((await h.app.request(`/admin/v1/users/${partner.id}/memberships`, json({ organizationId: created.id, role: 'OWNER' }, admin))).status).toBe(201);
    const { paymentId } = await settledOwed(h, u.as, created.id as string);

    const res = await reverse(h, partner.as(created.id as string), paymentId);
    expect(res.status).toBe(200);
    const audit = (await h.store.audit.listByOrganization(created.id as string, 50)).find((e) => e.action === 'payment.reversed');
    expect(audit).toMatchObject({ actorType: 'USER', actorId: partner.id });
  });

  it('twice → 409 ALREADY_REVERSED; a replay of the same key → the same 200, one audit row', async () => {
    const { h, u } = await setup();
    const { paymentId } = await settledOwed(h, u.as, u.personal);
    const key = { ...u.as(u.personal), 'idempotency-key': 'reverse-key-01' };
    const first = await h.app.request(`/v1/payments/${paymentId}/reverse`, json({ reason: 'Typo' }, key));
    const replay = await h.app.request(`/v1/payments/${paymentId}/reverse`, json({ reason: 'Typo' }, key));
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(await read(replay)).toEqual(await read(first));

    const again = await reverse(h, u.as(u.personal), paymentId);
    expect(again.status).toBe(409);
    expect((await read(again)).error.details).toMatchObject({ reason: 'ALREADY_REVERSED' });
    expect((await h.store.audit.listByOrganization(u.personal, 50)).filter((e) => e.action === 'payment.reversed')).toHaveLength(1);
  });

  it('the reason a person’s own undo records is still reserved → 422 REASON_RESERVED', async () => {
    const { h, u } = await setup();
    const { paymentId } = await settledOwed(h, u.as, u.personal);
    const res = await reverse(h, u.as(u.personal), paymentId, 'capture_undo');
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'REASON_RESERVED' });
  });

  it('on a Malafat-connected profile → 403 READ_ONLY_PROFILE before any lookup', async () => {
    const { h, m, u } = await setup();
    const res = await reverse(h, u.as(m.id), MISSING);
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { domain: 'payments', writerOfRecord: 'MALAFAT' } });
  });

  it('on a firm the person does not own (a disconnected Malafat firm), even Malafat’s own payment → 403 NOT_OWNER, untouched', async () => {
    const { h, gone, u } = await setup();
    const { payment, receivable } = await malafatRows(h, gone.id);
    const res = await reverse(h, u.as(gone.id), payment.id);
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { reason: 'NOT_OWNER' } });
    expect(await h.store.payments.getById(gone.id, payment.id)).toMatchObject({ status: 'POSTED', allocatedMinor: 20000n });
    expect(await h.store.receivables.getById(gone.id, receivable.id)).toMatchObject({ paidMinor: 20000n });
  });

  it('the key keeps its reach: Malafat reverses its own payment, audited as API_KEY', async () => {
    const { h, gone } = await setup();
    const { payment } = await malafatRows(h, gone.id);
    const res = await reverse(h, gone.key, payment.id);
    expect(res.status).toBe(200);
    expect((await h.store.audit.listByOrganization(gone.id, 50)).find((e) => e.action === 'payment.reversed')).toMatchObject({ actorType: 'API_KEY' });
  });
});

describe('MUT-453: a person credits what is owed on their own profile', () => {
  it('reduces an Owed by part of what is left; audits receivable.credited by USER', async () => {
    const { h, u } = await setup();
    const receivableId = await openOwed(h, u.as, u.personal, '100.00');
    const res = await credit(h, u.as(u.personal), receivableId, '40.00');
    expect(res.status).toBe(201);
    expect((await read(res)).receivable).toMatchObject({ outstanding: '60.00', credited: '40.00' });
    const audit = (await h.store.audit.listByOrganization(u.personal, 50)).find((e) => e.action === 'receivable.credited');
    expect(audit).toMatchObject({ actorType: 'USER', actorId: u.id, metadata: { amount: '40.00', reason: 'Agreed a lower fee', settled: false } });
  });

  it('more than is left → 422 CREDIT_EXCEEDS_OUTSTANDING with the outstanding', async () => {
    const { h, u } = await setup();
    const receivableId = await openOwed(h, u.as, u.personal, '100.00');
    await credit(h, u.as(u.personal), receivableId, '40.00');
    const res = await credit(h, u.as(u.personal), receivableId, '61.00');
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'CREDIT_EXCEEDS_OUTSTANDING', outstanding: '60.00' });
  });

  it('Cancel: crediting everything left settles it; nothing left → 422 RECEIVABLE_NOT_OPEN', async () => {
    const { h, u } = await setup();
    const { receivableId } = await settledOwed(h, u.as, u.personal, '500.00', '200.00');
    expect((await credit(h, u.as(u.personal), receivableId, '300.00')).status).toBe(201);
    expect(await h.store.receivables.getById(u.personal, receivableId)).toMatchObject({ status: 'SETTLED', creditedMinor: 30000n, paidMinor: 20000n });
    const res = await credit(h, u.as(u.personal), receivableId, '1.00');
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'RECEIVABLE_NOT_OPEN' });
  });

  it('a device session may credit too', async () => {
    const { h, u } = await setup();
    const receivableId = await openOwed(h, u.as, u.personal);
    const device = await u.device();
    expect((await credit(h, device(u.personal), receivableId, '10.00')).status).toBe(201);
  });

  it('on a Malafat-connected profile → 403 READ_ONLY_PROFILE before any lookup', async () => {
    const { h, m, u } = await setup();
    const res = await credit(h, u.as(m.id), MISSING, '1.00');
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { domain: 'payments', writerOfRecord: 'MALAFAT' } });
  });

  it('on a firm the person does not own, an installment → 403 NOT_OWNER, no credit', async () => {
    const { h, gone, u } = await setup();
    const { receivable } = await malafatRows(h, gone.id);
    const res = await credit(h, u.as(gone.id), receivable.id, '10.00');
    expect(res.status).toBe(403);
    expect((await read(res)).error.details).toMatchObject({ reason: 'NOT_OWNER' });
    expect(await h.store.receivables.listCredits(gone.id, receivable.id)).toEqual([]);
  });
});

describe('MUT-453: /v1/me tells the truth about corrections (D1, owner-only)', () => {
  it('a person may correct exactly where /v1/me says the profile is owned and its payments read-write', async () => {
    const { h, m, gone, u } = await setup();
    const me = await read(await h.app.request('/v1/me', { headers: u.as(u.personal) }));
    const may = new Map((me.profiles as Loose[]).map((p) => [p.id as string, p.owned === true && p.access.payments === 'read-write']));
    expect(may.get(u.personal)).toBe(true);
    expect(may.get(gone.id)).toBe(false);
    expect(may.get(m.id)).toBe(false);
    expect(sessionAccessFor('payments', 'MALAFAT')).not.toBe('read-write');

    const own = await settledOwed(h, u.as, u.personal);
    expect((await reverse(h, u.as(u.personal), own.paymentId)).status).toBe(200);
    const firm = await settledOwed(h, u.as, gone.id);
    expect((await reverse(h, u.as(gone.id), firm.paymentId)).status).toBe(403);
    expect((await credit(h, u.as(gone.id), firm.receivableId, '1.00')).status).toBe(403);
    expect((await reverse(h, u.as(m.id), MISSING)).status).toBe(403);
  });
});

describe('MUT-453: a person reverses only what a person put on the books (review fix)', () => {
  it('a captured payment applied to an entry Malafat posted → 404, nothing undone', async () => {
    const { h, u } = await setup();
    const { receivable } = await malafatRows(h, u.personal);
    const { payment } = await h.store.payments.create(
      { organizationId: u.personal, customerId: receivable.customerId, projectId: receivable.projectId, currency: 'ILS', amountMinor: 10000n, receivedOn: '2026-10-20', method: 'CASH', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: u.id, origin: 'CAPTURE', captureSource: null, allocations: [{ receivableId: receivable.id, amountMinor: 10000n }] },
      h.clock.now,
    );
    const res = await reverse(h, u.as(u.personal), payment.id);
    expect(res.status).toBe(404);
    expect(await h.store.payments.getById(u.personal, payment.id)).toMatchObject({ status: 'POSTED', allocatedMinor: 10000n });
  });
});

describe('MUT-453: a person’s credit is dated like any money they record (review fix)', () => {
  it('after today or more than ten years back → 422 DATE_INVALID; a past date inside the window is kept', async () => {
    const { h, u } = await setup();
    const receivableId = await openOwed(h, u.as, u.personal, '100.00');
    const dated = (effectiveDate: string) => h.app.request(`/v1/receivables/${receivableId}/credits`, json({ amount: '1.00', reason: 'Typo', effectiveDate }, { ...u.as(u.personal), ...idem() }));
    for (const bad of ['2026-10-27', '2010-01-01']) {
      const res = await dated(bad);
      expect(res.status).toBe(422);
      expect((await read(res)).error.details).toMatchObject({ reason: 'DATE_INVALID', field: 'effectiveDate' });
    }
    const ok = await dated('2026-10-20');
    expect(ok.status).toBe(201);
    expect((await read(ok)).credit).toMatchObject({ effectiveDate: '2026-10-20' });
  });
});

describe('MUT-453: what the summaries say after a correction (plan test 13)', () => {
  it('a reversed settle payment owes the entry again and applies nothing; a credit lowers what is outstanding', async () => {
    const { h, u } = await setup();
    const { customerId, paymentId } = await settledOwed(h, u.as, u.personal, '500.00');
    expect((await reverse(h, u.as(u.personal), paymentId)).status).toBe(200);
    const after = (await read(await h.app.request('/v1/summaries/organization', { headers: u.as(u.personal) }))).currencies.find((x: Loose) => x.currency === 'ILS');
    expect(after.outstanding).toBe('500.00');
    expect(after.customers.find((x: Loose) => x.customerId === customerId)).toMatchObject({ outstanding: '500.00', unallocated: '0.00', lastPaymentOn: null });

    const owedId = (await read(await h.app.request('/v1/receivables', { headers: u.as(u.personal) }))).items[0].id as string;
    expect((await credit(h, u.as(u.personal), owedId, '200.00')).status).toBe(201);
    const credited = (await read(await h.app.request('/v1/summaries/organization', { headers: u.as(u.personal) }))).currencies.find((x: Loose) => x.currency === 'ILS');
    expect(credited.outstanding).toBe('300.00');
  });
});

describe('MUT-453: undo after a reversal says who reversed it (D6)', () => {
  it('a person reversed it → 409 ALREADY_REVERSED', async () => {
    const { h, u } = await setup();
    const customer = (await read(await h.app.request('/v1/customers', json({ name: 'Nadia' }, { ...u.as(u.personal), ...idem() })))) as { id: string };
    const received = await read(await h.app.request('/v1/income', json({ kind: 'received', amount: '80.00', currency: 'ILS', occurredOn: '2026-10-20', customerId: customer.id }, { ...u.as(u.personal), ...idem() })));
    expect((await reverse(h, u.as(u.personal), received.id as string)).status).toBe(200);
    const undo = await h.app.request(`/v1/income/${received.id as string}`, { method: 'DELETE', headers: { ...u.as(u.personal), ...idem() } });
    expect(undo.status).toBe(409);
    expect((await read(undo)).error.details).toMatchObject({ reason: 'ALREADY_REVERSED' });
  });

  it('Malafat reversed it on a disconnected firm → still 409 REVERSED_BY_MALAFAT', async () => {
    const h = harness();
    const { gone } = await firms(h);
    const u = await person(h, [gone.id]);
    const customer = await h.store.customers.create({ organizationId: gone.id, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, h.clock.now);
    await h.store.externalReferences.link({ organizationId: gone.id, provider: 'MALAFAT', entityType: 'CUSTOMER', entityId: customer.id, externalId: `c-${++seq}` }, h.clock.now);
    const received = await read(await h.app.request('/v1/income', json({ kind: 'received', amount: '80.00', currency: 'ILS', occurredOn: '2026-10-20', customerId: customer.id }, { ...u.as(gone.id), ...idem() })));
    expect((await reverse(h, gone.key, received.id as string, 'Duplicate in Malafat')).status).toBe(200);
    await h.store.integrations.disconnect(gone.integration.id, h.clock.now);

    const undo = await h.app.request(`/v1/income/${received.id as string}`, { method: 'DELETE', headers: { ...u.as(gone.id), ...idem() } });
    expect(undo.status).toBe(409);
    expect((await read(undo)).error.details).toMatchObject({ reason: 'REVERSED_BY_MALAFAT' });
  });
});
