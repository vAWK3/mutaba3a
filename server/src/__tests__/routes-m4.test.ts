import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, API_VERSION } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };

interface Harness {
  app: ReturnType<typeof createApp>;
  store: MemoryLedgerStore;
  clock: { now: Date };
}

function harness(): Harness {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-08T10:00:00Z') };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.4.0-test', now: () => clock.now });
  return { app, store, clock };
}

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

interface Firm {
  org: { id: string };
  auth: Record<string, string>;
  customer: Loose;
  project: Loose;
}

async function firm(h: Harness, opts: { timezone?: string; scopes?: readonly string[]; currency?: string } = {}): Promise<Firm> {
  const org = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: opts.timezone ?? 'Asia/Jerusalem' }, admin)))) as { id: string };
  const key = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: opts.scopes ?? SCOPES }, admin)))) as { secret: string };
  const auth = { authorization: `Bearer ${key.secret}` };
  await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Case', currency: opts.currency ?? 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}

/** Ticks the injected clock so records created by successive calls have distinct createdAt (list order is (createdAt, id)). */
function tick(h: Harness): void {
  h.clock.now = new Date(h.clock.now.getTime() + 1000);
}

/** A fixed agreement with IMMEDIATE installments, one receivable per amount, due 2026-10-21, -22, … so oldest-first order is the amounts' order. */
async function receivables(h: Harness, f: Firm, amounts: string[], projectId = f.project.id, over: Record<string, unknown> = {}) {
  tick(h);
  const body = { projectId, amount: amounts.reduce((s, a) => s + Number(a), 0).toFixed(2), pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments: amounts.map((a, i) => ({ label: `I${i + 1}`, amount: a, trigger: { type: 'IMMEDIATE' }, dueDate: `2026-10-${21 + i}` })), ...over };
  const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
  const created = await read(await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() })));
  const list = await read(await h.app.request(`/v1/receivables?projectId=${projectId}`, { headers: f.auth }));
  const sorted = (list.items as Loose[]).filter((r) => r.agreementId === created.agreement.id).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return { agreement: created, receivables: sorted };
}

const previewBody = (f: Firm, amount: string, allocations?: Array<{ receivableId: string; amount: string }>, extra: Record<string, unknown> = {}) => ({ customerId: f.customer.id, currency: 'ILS', amount, ...(allocations ? { allocations } : {}), ...extra });

async function preview(h: Harness, f: Firm, body: Record<string, unknown>) {
  return read(await h.app.request('/v1/allocations/preview', json(body, f.auth)));
}

async function pay(h: Harness, f: Firm, amount: string, allocations: Array<{ receivableId: string; amount: string }>, over: Record<string, unknown> = {}, headers: Record<string, string> = idem()) {
  tick(h);
  const p = await preview(h, f, previewBody(f, amount, allocations));
  const res = await h.app.request('/v1/payments', json({ customerId: f.customer.id, currency: 'ILS', amount, receivedOn: '2026-10-08', method: 'BANK', reference: 'TRX-1', allocations, previewToken: p.previewToken, ...over }, { ...f.auth, ...headers }));
  return { res, body: await read(res), preview: p };
}

async function auditActions(h: Harness, orgId: string): Promise<string[]> {
  return ((await read(await h.app.request(`/admin/v1/organizations/${orgId}/audit`, { headers: admin }))).events as Loose[]).map((e) => e.action);
}

describe('allocation preview', () => {
  it('needs payments:read; lists eligible receivables, suggests by strategy, lets explicit allocations win, and writes nothing', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['300.00', '500.00']);
    const noScope = await firm(h, { scopes: ['agreements:read', 'agreements:write', 'customers:write', 'projects:write'] });
    expect((await h.app.request('/v1/allocations/preview', json(previewBody(noScope, '1.00'), noScope.auth))).status).toBe(403);

    const nothing = await preview(h, f, previewBody(f, '1000.00'));
    expect(nothing).toMatchObject({ amount: '1000.00', allocated: '0.00', unallocated: '1000.00', allocations: [], warnings: [] });
    expect(nothing.eligible.map((r: Loose) => [r.gross, r.outstanding, r.status])).toEqual([['300.00', '300.00', 'DUE'], ['500.00', '500.00', 'DUE']]);
    expect(nothing.previewToken).toMatch(/^[0-9a-f]{64}$/);

    const oldest = await preview(h, f, previewBody(f, '400.00', undefined, { strategy: 'OLDEST_FIRST' }));
    expect(oldest.allocations).toEqual([{ receivableId: recs[0].id, amount: '300.00' }, { receivableId: recs[1].id, amount: '100.00' }]);
    expect(oldest).toMatchObject({ allocated: '400.00', unallocated: '0.00' });
    expect(oldest.balances.receivables.map((b: Loose) => [b.outstandingAfter, b.statusAfter])).toEqual([['0.00', 'PAID'], ['400.00', 'PARTIALLY_PAID']]);
    expect(oldest.balances.customer).toEqual({ before: { outstanding: '800.00', overdue: '0.00' }, after: { outstanding: '400.00', overdue: '0.00' } });
    expect(oldest.balances.projects[0]).toMatchObject({ projectId: f.project.id, after: { outstanding: '400.00' } });

    const explicit = await preview(h, f, previewBody(f, '400.00', [{ receivableId: recs[1].id, amount: '400.00' }], { strategy: 'OLDEST_FIRST' }));
    expect(explicit.allocations).toEqual([{ receivableId: recs[1].id, amount: '400.00' }]);

    // nothing was written
    expect((await read(await h.app.request('/v1/payments', { headers: f.auth }))).items).toEqual([]);
    expect((await read(await h.app.request(`/v1/receivables/${recs[0].id}`, { headers: f.auth }))).paid).toBe('0.00');
  });

  it('SETTLE_MATTERS settles whole projects first; nothing eligible warns', async () => {
    const h = harness();
    const f = await firm(h);
    const other = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Other', currency: 'ILS' }, { ...f.auth, ...idem() })));
    const a = await receivables(h, f, ['3000.00'], f.project.id, { installments: [{ label: 'A', amount: '3000.00', trigger: { type: 'IMMEDIATE' }, dueDate: '2026-09-30' }] });
    const b = await receivables(h, f, ['2000.00', '3000.00'], other.id);
    const p = await preview(h, f, previewBody(f, '6000.00', undefined, { strategy: 'SETTLE_MATTERS' }));
    expect(p.allocations).toEqual([
      { receivableId: a.receivables[0].id, amount: '3000.00' },
      { receivableId: b.receivables[0].id, amount: '2000.00' },
      { receivableId: b.receivables[1].id, amount: '1000.00' },
    ]);
    const fresh = await firm(h);
    const empty = await preview(h, fresh, previewBody(fresh, '100.00', undefined, { strategy: 'OLDEST_FIRST' }));
    expect(empty).toMatchObject({ allocations: [], unallocated: '100.00', warnings: ['NO_ELIGIBLE_RECEIVABLES'], eligible: [] });
  });

  it('refuses invalid sets with the published reasons', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['300.00']);
    const usd = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'USD case', currency: 'USD' }, { ...f.auth, ...idem() })));
    const usdRecs = await receivables(h, f, ['50.00'], usd.id, { currency: 'USD' });
    const otherFirmCustomer = await firm(h);
    const otherCustomer = await read(await h.app.request('/v1/customers', json({ name: 'Beta' }, { ...f.auth, ...idem() })));
    const bad = async (body: Record<string, unknown>) => {
      const res = await h.app.request('/v1/allocations/preview', json(body, f.auth));
      expect(res.status, JSON.stringify(body)).toBe(422);
      return (await read(res)).error.details;
    };
    expect((await bad(previewBody(f, '100.00', [{ receivableId: recs[0].id, amount: '300.01' }]))).reason).toBe('ALLOCATION_EXCEEDS_OUTSTANDING');
    expect(await bad(previewBody(f, '100.00', [{ receivableId: recs[0].id, amount: '200.00' }]))).toMatchObject({ reason: 'ALLOCATION_EXCEEDS_PAYMENT', excess: '100.00' });
    expect((await bad(previewBody(f, '400.00', [{ receivableId: recs[0].id, amount: '100.00' }, { receivableId: recs[0].id, amount: '100.00' }]))).reason).toBe('ALLOCATION_DUPLICATE');
    expect((await bad(previewBody(f, '400.00', [{ receivableId: usdRecs.receivables[0].id, amount: '10.00' }]))).reason).toBe('CURRENCY_MISMATCH');
    expect((await bad({ customerId: otherCustomer.id, currency: 'ILS', amount: '400.00', allocations: [{ receivableId: recs[0].id, amount: '10.00' }] })).reason).toBe('RECEIVABLE_CUSTOMER_MISMATCH');
    expect((await bad(previewBody(f, '400.00', [{ receivableId: '00000000-0000-4000-8000-000000000000', amount: '10.00' }]))).reason).toBe('RECEIVABLE_NOT_FOUND');
    expect((await bad(previewBody(f, '0.00'))).reason).toBe('AMOUNT_INVALID');
    expect((await bad(previewBody(f, '10.005'))).reason).toBe('AMOUNT_INVALID');
    expect((await bad({ customerId: otherFirmCustomer.customer.id, currency: 'ILS', amount: '1.00' })).reason).toBe('CUSTOMER_NOT_FOUND');
    expect((await bad({ currency: 'ILS', amount: '1.00' })).reason).toBe('AMOUNT_INVALID');
    await h.app.request(`/v1/customers/${otherCustomer.id}/archive`, json({}, { ...f.auth, ...idem() }));
    expect((await bad({ customerId: otherCustomer.id, currency: 'ILS', amount: '1.00' })).reason).toBe('CUSTOMER_ARCHIVED');
    // a settled receivable is not eligible
    await pay(h, f, '300.00', [{ receivableId: recs[0].id, amount: '300.00' }]);
    expect((await bad(previewBody(f, '1.00', [{ receivableId: recs[0].id, amount: '1.00' }]))).reason).toBe('RECEIVABLE_NOT_OPEN');
  });
});

describe('recording payments', () => {
  it('records atomically with a number, moves receivable and installment statuses, replays, and audits', async () => {
    const h = harness();
    const f = await firm(h);
    const { agreement, receivables: recs } = await receivables(h, f, ['300.00', '500.00']);
    const key = idem();
    const { res, body } = await pay(h, f, '400.00', [{ receivableId: recs[0].id, amount: '300.00' }, { receivableId: recs[1].id, amount: '100.00' }], {}, key);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ number: 'PAY-2026-0001', status: 'POSTED', amount: '400.00', allocated: '400.00', unallocated: '0.00', currency: 'ILS', method: 'BANK', reference: 'TRX-1', replacesPaymentId: null, replacedByPaymentId: null, version: 2 });
    expect(body.allocations.map((a: Loose) => [a.amount, a.receivableOutstanding, a.receivableStatus, a.projectId])).toEqual([['300.00', '0.00', 'PAID', f.project.id], ['100.00', '400.00', 'PARTIALLY_PAID', f.project.id]]);
    expect(await read(await h.app.request(`/v1/receivables/${recs[0].id}`, { headers: f.auth }))).toMatchObject({ paid: '300.00', credited: '0.00', outstanding: '0.00', status: 'PAID' });
    expect((await read(await h.app.request('/v1/receivables?status=SETTLED', { headers: f.auth }))).items.map((r: Loose) => r.id)).toEqual([recs[0].id]);
    const detail = await read(await h.app.request(`/v1/agreements/${agreement.agreement.id}`, { headers: f.auth }));
    expect(detail.installments.map((i: Loose) => i.status)).toEqual(['PAID', 'PARTIALLY_PAID']);

    const replay = await h.app.request('/v1/payments', json({ customerId: f.customer.id, currency: 'ILS', amount: '400.00', receivedOn: '2026-10-08', method: 'BANK', reference: 'TRX-1', allocations: [{ receivableId: recs[0].id, amount: '300.00' }, { receivableId: recs[1].id, amount: '100.00' }], previewToken: (await pay(h, f, '1.00', [], {}, idem())).preview.previewToken }, { ...f.auth, ...key }));
    // same key, different body → reused
    expect(replay.status).toBe(422);
    expect((await read(replay)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const second = await read(await h.app.request('/v1/payments', { headers: f.auth }));
    expect(second.items.map((p: Loose) => p.number)).toEqual(['PAY-2026-0001', 'PAY-2026-0002']);
    const actions = await auditActions(h, f.org.id);
    expect(actions.filter((a) => a === 'payment.recorded')).toHaveLength(2);
    expect(actions.filter((a) => a === 'receivable.settled')).toHaveLength(1);
  });

  it('a true replay returns the same payment and number', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['300.00']);
    const p = await preview(h, f, previewBody(f, '300.00', [{ receivableId: recs[0].id, amount: '300.00' }]));
    const key = idem();
    const body = { customerId: f.customer.id, currency: 'ILS', amount: '300.00', receivedOn: '2026-10-08', method: 'CASH', allocations: [{ receivableId: recs[0].id, amount: '300.00' }], previewToken: p.previewToken };
    const first = await read(await h.app.request('/v1/payments', json(body, { ...f.auth, ...key })));
    const replay = await h.app.request('/v1/payments', json(body, { ...f.auth, ...key }));
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect((await read(replay)).id).toBe(first.id);
    expect((await read(await h.app.request('/v1/payments', { headers: f.auth }))).items).toHaveLength(1);
  });

  it('refuses a stale token: changed set, a credit in between, another payment in between', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['300.00', '500.00']);
    const p = await preview(h, f, previewBody(f, '300.00', [{ receivableId: recs[0].id, amount: '300.00' }]));
    const post = (allocations: Loose, token: string) => h.app.request('/v1/payments', json({ customerId: f.customer.id, currency: 'ILS', amount: '300.00', receivedOn: '2026-10-08', method: 'BANK', allocations, previewToken: token }, { ...f.auth, ...idem() }));
    const changed = await post([{ receivableId: recs[1].id, amount: '300.00' }], p.previewToken);
    expect(changed.status).toBe(409);
    expect((await read(changed)).error.details.reason).toBe('PREVIEW_STALE');
    // a credit on an eligible receivable bumps its version
    await h.app.request(`/v1/receivables/${recs[1].id}/credits`, json({ amount: '1.00', reason: 'rounding' }, { ...f.auth, ...idem() }));
    const afterCredit = await post([{ receivableId: recs[0].id, amount: '300.00' }], p.previewToken);
    expect((await read(afterCredit)).error.details.reason).toBe('PREVIEW_STALE');
    const p2 = await preview(h, f, previewBody(f, '300.00', [{ receivableId: recs[0].id, amount: '300.00' }]));
    await pay(h, f, '10.00', [{ receivableId: recs[1].id, amount: '10.00' }]);
    const afterPayment = await post([{ receivableId: recs[0].id, amount: '300.00' }], p2.previewToken);
    expect((await read(afterPayment)).error.details.reason).toBe('PREVIEW_STALE');
    const p3 = await preview(h, f, previewBody(f, '300.00', [{ receivableId: recs[0].id, amount: '300.00' }]));
    expect((await post([{ receivableId: recs[0].id, amount: '300.00' }], p3.previewToken)).status).toBe(201);
  });

  it('validates the body: date, method, replacesPaymentId rules, scope', async () => {
    const h = harness();
    const f = await firm(h);
    const bad = async (over: Record<string, unknown>, status = 422) => {
      const { res, body } = await pay(h, f, '10.00', [], over);
      expect(res.status).toBe(status);
      return body.error?.details?.reason;
    };
    expect(await bad({ receivedOn: '2026-02-30' })).toBe('DATE_INVALID');
    expect(await bad({ receivedOn: '2099-01-01' })).toBe('DATE_INVALID');
    expect(await bad({ method: 'CARD' })).toBeUndefined(); // schema
    expect(await bad({ replacesPaymentId: '00000000-0000-4000-8000-000000000000' })).toBe('REPLACES_NOT_REVERSED');
    const posted = await pay(h, f, '5.00', []);
    expect(await bad({ replacesPaymentId: posted.body.id })).toBe('REPLACES_NOT_REVERSED');
    await h.app.request(`/v1/payments/${posted.body.id}/reverse`, json({ reason: 'wrong' }, { ...f.auth, ...idem() }));
    const other = await read(await h.app.request('/v1/customers', json({ name: 'Beta' }, { ...f.auth, ...idem() })));
    const p = await preview(h, f, { customerId: other.id, currency: 'ILS', amount: '5.00' });
    const mismatch = await h.app.request('/v1/payments', json({ customerId: other.id, currency: 'ILS', amount: '5.00', receivedOn: '2026-10-08', method: 'BANK', allocations: [], replacesPaymentId: posted.body.id, previewToken: p.previewToken }, { ...f.auth, ...idem() }));
    expect((await read(mismatch)).error.details.reason).toBe('REPLACES_CUSTOMER_MISMATCH');
    const corrected = await pay(h, f, '5.00', [], { replacesPaymentId: posted.body.id });
    expect(corrected.res.status).toBe(201);
    expect(corrected.body.replacesPaymentId).toBe(posted.body.id);
    expect((await read(await h.app.request(`/v1/payments/${posted.body.id}`, { headers: f.auth }))).replacedByPaymentId).toBe(corrected.body.id);
    expect((await pay(h, f, '1.00', [], {}, {})).res.status).toBe(422); // Idempotency-Key required
    const readOnly = await firm(h, { scopes: ['payments:read', 'customers:write', 'projects:write', 'agreements:write', 'agreements:read'] });
    expect((await pay(h, readOnly, '1.00', [])).res.status).toBe(403);
  });
});

describe('allocating later', () => {
  it('allocates unallocated funds from a { paymentId } preview; refuses beyond the remainder, when nothing is left, and on a reversed payment', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['300.00', '500.00']);
    const { body: payment } = await pay(h, f, '600.00', []);
    expect(payment.unallocated).toBe('600.00');
    const p = await preview(h, f, { paymentId: payment.id, strategy: 'OLDEST_FIRST' });
    expect(p).toMatchObject({ amount: '600.00', allocated: '600.00', unallocated: '0.00' });
    expect(p.allocations).toEqual([{ receivableId: recs[0].id, amount: '300.00' }, { receivableId: recs[1].id, amount: '300.00' }]);
    const partial = [{ receivableId: recs[0].id, amount: '300.00' }];
    const pp = await preview(h, f, { paymentId: payment.id, allocations: partial });
    const res = await h.app.request(`/v1/payments/${payment.id}/allocations`, json({ allocations: partial, previewToken: pp.previewToken }, { ...f.auth, ...idem() }));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ allocated: '300.00', unallocated: '300.00' });
    expect(body.allocations).toHaveLength(1);
    expect((await auditActions(h, f.org.id)).filter((a) => a === 'payment.allocated')).toHaveLength(1);

    const tooMuch = await h.app.request('/v1/allocations/preview', json({ paymentId: payment.id, allocations: [{ receivableId: recs[1].id, amount: '300.01' }] }, f.auth));
    expect((await read(tooMuch)).error.details.reason).toBe('ALLOCATION_EXCEEDS_PAYMENT');
    const rest = [{ receivableId: recs[1].id, amount: '300.00' }];
    const pr = await preview(h, f, { paymentId: payment.id, allocations: rest });
    expect((await h.app.request(`/v1/payments/${payment.id}/allocations`, json({ allocations: rest, previewToken: pr.previewToken }, { ...f.auth, ...idem() }))).status).toBe(200);
    const none = await h.app.request('/v1/allocations/preview', json({ paymentId: payment.id }, f.auth));
    expect((await read(none)).error.details.reason).toBe('NO_UNALLOCATED_FUNDS');
    const stale = await h.app.request(`/v1/payments/${payment.id}/allocations`, json({ allocations: rest, previewToken: pr.previewToken }, { ...f.auth, ...idem() }));
    expect((await read(stale)).error.details.reason).toBe('NO_UNALLOCATED_FUNDS');

    const { body: other } = await pay(h, f, '50.00', []);
    await h.app.request(`/v1/payments/${other.id}/reverse`, json({ reason: 'x' }, { ...f.auth, ...idem() }));
    const reversed = await h.app.request('/v1/allocations/preview', json({ paymentId: other.id }, f.auth));
    expect((await read(reversed)).error.details.reason).toBe('PAYMENT_NOT_POSTED');
    expect((await h.app.request('/v1/allocations/preview', json({ paymentId: '00000000-0000-4000-8000-000000000000' }, f.auth))).status).toBe(404);
  });
});

describe('reversal', () => {
  it('undoes allocations, reopens receivables and installments, is final, and is refused twice', async () => {
    const h = harness();
    const f = await firm(h);
    const { agreement, receivables: recs } = await receivables(h, f, ['300.00']);
    const { body: payment } = await pay(h, f, '300.00', [{ receivableId: recs[0].id, amount: '300.00' }]);
    expect((await read(await h.app.request(`/v1/receivables/${recs[0].id}`, { headers: f.auth }))).status).toBe('PAID');
    const refused = await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: '' }, { ...f.auth, ...idem() }));
    expect(refused.status).toBe(422);
    const key = idem();
    const res = await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'entered against the wrong client' }, { ...f.auth, ...key }));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ status: 'REVERSED', reversalReason: 'entered against the wrong client', allocated: '0.00', unallocated: '0.00' });
    expect(body.reversedAt).toBe(h.clock.now.toISOString());
    expect(body.allocations).toHaveLength(1); // history kept
    expect(body.allocations[0]).toMatchObject({ receivableOutstanding: '300.00', receivableStatus: 'DUE' });
    expect(await read(await h.app.request(`/v1/receivables/${recs[0].id}`, { headers: f.auth }))).toMatchObject({ paid: '0.00', outstanding: '300.00', status: 'DUE' });
    expect((await read(await h.app.request(`/v1/agreements/${agreement.agreement.id}`, { headers: f.auth }))).installments[0].status).toBe('DUE');
    const replay = await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'entered against the wrong client' }, { ...f.auth, ...key }));
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    const again = await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'again' }, { ...f.auth, ...idem() }));
    expect(again.status).toBe(409);
    expect((await read(again)).error.details.reason).toBe('ALREADY_REVERSED');
    expect((await read(await h.app.request('/v1/payments?status=REVERSED', { headers: f.auth }))).items).toHaveLength(1);
    expect((await auditActions(h, f.org.id)).filter((a) => a === 'payment.reversed')).toHaveLength(1);
    const other = await firm(h);
    expect((await h.app.request(`/v1/payments/${payment.id}`, { headers: other.auth })).status).toBe(404);
    expect((await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'x' }, { ...other.auth, ...idem() }))).status).toBe(404);
  });

  it('reversing an unallocated payment touches no receivable', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['300.00']);
    const { body: payment } = await pay(h, f, '100.00', []);
    const res = await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'duplicate' }, { ...f.auth, ...idem() }));
    expect((await read(res)).allocations).toEqual([]);
    expect((await read(await h.app.request(`/v1/receivables/${recs[0].id}`, { headers: f.auth }))).outstanding).toBe('300.00');
  });
});

describe('credits', () => {
  it('credits within outstanding with the VAT split at the frozen rate; settles at zero; refuses beyond; archive then succeeds', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['1000.00'], f.project.id, { vatTreatment: 'STANDARD_RATED' });
    const r = recs[0];
    expect(r).toMatchObject({ gross: '1180.00', outstanding: '1180.00' });
    const res = await h.app.request(`/v1/receivables/${r.id}/credits`, json({ amount: '118.00', reason: 'scope reduced' }, { ...f.auth, ...idem() }));
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body.credit).toMatchObject({ amount: '118.00', net: '100.00', vat: '18.00', reason: 'scope reduced', effectiveDate: '2026-10-08' });
    expect(body.receivable).toMatchObject({ credited: '118.00', outstanding: '1062.00', status: 'DUE', gross: '1180.00' });
    const tooMuch = await h.app.request(`/v1/receivables/${r.id}/credits`, json({ amount: '1062.01', reason: 'x', effectiveDate: '2026-10-09' }, { ...f.auth, ...idem() }));
    expect(tooMuch.status).toBe(422);
    expect((await read(tooMuch)).error.details).toMatchObject({ reason: 'CREDIT_EXCEEDS_OUTSTANDING', outstanding: '1062.00' });
    await pay(h, f, '1000.00', [{ receivableId: r.id, amount: '1000.00' }]);
    const last = await read(await h.app.request(`/v1/receivables/${r.id}/credits`, json({ amount: '62.00', reason: 'waived' }, { ...f.auth, ...idem() })));
    expect(last.receivable).toMatchObject({ paid: '1000.00', credited: '180.00', outstanding: '0.00', status: 'PAID' });
    const settled = await h.app.request(`/v1/receivables/${r.id}/credits`, json({ amount: '1.00', reason: 'x' }, { ...f.auth, ...idem() }));
    expect((await read(settled)).error.details.reason).toBe('RECEIVABLE_NOT_OPEN');
    const list = await read(await h.app.request(`/v1/receivables/${r.id}/credits`, { headers: f.auth }));
    expect(list.credits.map((c: Loose) => c.amount)).toEqual(['62.00', '118.00']);
    expect((await h.app.request(`/v1/projects/${f.project.id}/archive`, json({}, { ...f.auth, ...idem() }))).status).toBe(200);
    expect((await auditActions(h, f.org.id)).filter((a) => a === 'receivable.credited')).toHaveLength(2);
    expect((await h.app.request(`/v1/receivables/${r.id}/credits`, json({ amount: '0.00', reason: 'x' }, { ...f.auth, ...idem() }))).status).toBe(422);
    expect((await h.app.request(`/v1/receivables/${r.id}/credits`, json({ amount: '1.00', reason: 'x', effectiveDate: 'soon' }, { ...f.auth, ...idem() }))).status).toBe(422);
  });

  it('a reversal after a credit reopens only what the credit did not cover', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['1000.00']);
    const r = recs[0];
    await h.app.request(`/v1/receivables/${r.id}/credits`, json({ amount: '400.00', reason: 'x' }, { ...f.auth, ...idem() }));
    const { body: payment } = await pay(h, f, '600.00', [{ receivableId: r.id, amount: '600.00' }]);
    expect((await read(await h.app.request(`/v1/receivables/${r.id}`, { headers: f.auth }))).status).toBe('PAID');
    await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'bounced' }, { ...f.auth, ...idem() }));
    expect(await read(await h.app.request(`/v1/receivables/${r.id}`, { headers: f.auth }))).toMatchObject({ paid: '0.00', credited: '400.00', outstanding: '600.00', status: 'DUE' });
  });
});

describe('operations lookup and statuses', () => {
  it('reports COMPLETED with the stored body, a stored 422, PENDING, and 404 for unknown or released keys', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['300.00']);
    const key = idem();
    const { body } = await pay(h, f, '300.00', [{ receivableId: recs[0].id, amount: '300.00' }], {}, key);
    const op = await read(await h.app.request(`/v1/operations/${key['idempotency-key']}`, { headers: f.auth }));
    expect(op).toMatchObject({ key: key['idempotency-key'], operation: 'payments.create', status: 'COMPLETED', responseStatus: 201 });
    expect(op.response.id).toBe(body.id);
    const badKey = idem();
    await pay(h, f, '1.00', [], { receivedOn: '2026-02-30' }, badKey);
    const stored = await read(await h.app.request(`/v1/operations/${badKey['idempotency-key']}`, { headers: f.auth }));
    expect(stored).toMatchObject({ status: 'COMPLETED', responseStatus: 422 });
    expect(stored.response.error.details.reason).toBe('DATE_INVALID');
    await h.store.idempotency.claim({ organizationId: f.org.id, key: 'pending-key-123', operation: 'payments.create', fingerprint: 'x', at: h.clock.now });
    expect(await read(await h.app.request('/v1/operations/pending-key-123', { headers: f.auth }))).toMatchObject({ status: 'PENDING', response: null });
    expect((await h.app.request('/v1/operations/never-used-key', { headers: f.auth })).status).toBe(404);
    await h.store.idempotency.claim({ organizationId: f.org.id, key: 'released-key-1', operation: 'payments.create', fingerprint: 'x', at: h.clock.now });
    await h.store.idempotency.fail({ organizationId: f.org.id, key: 'released-key-1', at: h.clock.now });
    expect((await h.app.request('/v1/operations/released-key-1', { headers: f.auth })).status).toBe(404);
    const other = await firm(h);
    expect((await h.app.request(`/v1/operations/${key['idempotency-key']}`, { headers: other.auth })).status).toBe(404);
    const noScope = await firm(h, { scopes: ['agreements:read', 'customers:write', 'projects:write'] });
    expect((await h.app.request('/v1/operations/anything-here', { headers: noScope.auth })).status).toBe(403);
  });

  it('half-paid is PARTIALLY_PAID before the due date and OVERDUE after; PAID wins over overdue; lists filter and page', async () => {
    const h = harness();
    const f = await firm(h);
    const { receivables: recs } = await receivables(h, f, ['300.00', '500.00']);
    await pay(h, f, '150.00', [{ receivableId: recs[0].id, amount: '150.00' }], { receivedOn: '2026-10-05' });
    await pay(h, f, '500.00', [{ receivableId: recs[1].id, amount: '500.00' }], { receivedOn: '2026-10-07' });
    expect((await read(await h.app.request(`/v1/receivables/${recs[0].id}`, { headers: f.auth }))).status).toBe('PARTIALLY_PAID');
    h.clock.now = new Date('2026-11-02T10:00:00Z');
    expect((await read(await h.app.request(`/v1/receivables/${recs[0].id}`, { headers: f.auth }))).status).toBe('OVERDUE');
    expect((await read(await h.app.request(`/v1/receivables/${recs[1].id}`, { headers: f.auth }))).status).toBe('PAID');
    const q = async (s: string) => ((await read(await h.app.request(`/v1/payments${s}`, { headers: f.auth }))).items as Loose[]).map((p) => p.amount);
    expect(await q('')).toEqual(['150.00', '500.00']);
    expect(await q(`?customerId=${f.customer.id}&projectId=${f.project.id}`)).toEqual(['150.00', '500.00']);
    expect(await q('?receivedBefore=2026-10-06')).toEqual(['150.00']);
    expect(await q('?receivedAfter=2026-10-06')).toEqual(['500.00']);
    expect(await q('?status=REVERSED')).toEqual([]);
    const page1 = await read(await h.app.request('/v1/payments?limit=1', { headers: f.auth }));
    expect(page1.items).toHaveLength(1);
    const page2 = await read(await h.app.request(`/v1/payments?limit=1&cursor=${page1.nextCursor}`, { headers: f.auth }));
    expect(page2.items[0].amount).toBe('500.00');
    expect(page2.nextCursor).toBeNull();
  });
});

describe('contract', () => {
  it('publishes every M4 path, the reason vocabularies and the version', async () => {
    const h = harness();
    const doc = await read(await h.app.request('/openapi.json'));
    expect(doc.info.version).toBe('1.10.0-mut39');
    expect(API_VERSION).toBe('1.10.0-mut39');
    for (const path of ['/v1/allocations/preview', '/v1/payments', '/v1/payments/{paymentId}', '/v1/payments/{paymentId}/allocations', '/v1/payments/{paymentId}/reverse', '/v1/receivables/{receivableId}/credits', '/v1/operations/{idempotencyKey}']) {
      expect(doc.paths[path], path).toBeDefined();
    }
    for (const reason of ['ALLOCATION_EXCEEDS_PAYMENT', 'ALLOCATION_EXCEEDS_OUTSTANDING', 'RECEIVABLE_CUSTOMER_MISMATCH', 'CREDIT_EXCEEDS_OUTSTANDING', 'ALREADY_REVERSED', 'NO_UNALLOCATED_FUNDS', 'REPLACES_NOT_REVERSED']) {
      expect(doc.info.description).toContain(reason);
    }
    expect(doc.components.schemas.Receivable.properties.credited).toBeDefined();
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(['Payment', 'Allocation', 'AllocationPreviewRequest', 'AllocationPreviewResponse', 'CreatePaymentRequest', 'Credit', 'Operation']));
  });
});
