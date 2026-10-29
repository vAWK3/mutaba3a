import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { API_VERSION, createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { LockConflict, MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-443 (ADR-225): POST /v1/payments/{id}/correct/preview and /correct over HTTP. Today is 2026-10-28 in
 * Asia/Jerusalem. The plan's acceptance criteria are named AC1–AC7 and its review items R1–R12.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const reason = async (res: Response) => (await read(res)).error.details.reason;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

function harness(now = '2026-10-28T10:00:00Z') {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date(now) };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.3.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, clock };
}
type H = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

function tick(h: H, ms = 1000): void {
  h.clock.now = new Date(h.clock.now.getTime() + ms);
}

async function firm(h: H) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2015-01-01' }, auth, 'PUT'))).status).toBe(201);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Lawsuit', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}
type F = Awaited<ReturnType<typeof firm>>;

/** Posted charges (exempt), one per amount, due 2026-11-01, -02, … so oldest-first is the amounts' order. */
async function charges(h: H, f: F, amounts: string[]): Promise<Loose[]> {
  tick(h);
  const body = { projectId: f.project.id, amount: amounts.reduce((s, a) => s + Number(a), 0).toFixed(2), pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments: amounts.map((a, i) => ({ label: `I${i + 1}`, amount: a, trigger: { type: 'IMMEDIATE' }, dueDate: `2026-11-${String(i + 1).padStart(2, '0')}` })) };
  const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
  const created = await read(await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() })));
  const list = await read(await h.app.request(`/v1/receivables?projectId=${f.project.id}`, { headers: f.auth }));
  return (list.items as Loose[]).filter((r) => r.agreementId === created.agreement.id).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}

type Alloc = Array<{ receivableId: string; amount: string }>;

/** Records a payment through the preview, as Malafat does. */
async function pay(h: H, f: F, amount: string, allocations: Alloc, extra: Record<string, unknown> = {}): Promise<Loose> {
  tick(h);
  const p = await read(await h.app.request('/v1/allocations/preview', json({ customerId: f.customer.id, currency: 'ILS', amount, allocations }, f.auth)));
  const res = await h.app.request('/v1/payments', json({ customerId: f.customer.id, currency: 'ILS', amount, receivedOn: '2026-10-20', method: 'BANK', reference: 'TR-1', notes: 'First transfer', receiptNumber: '3001', allocations, previewToken: p.previewToken, ...extra }, { ...f.auth, ...idem() }));
  expect(res.status).toBe(201);
  return read(res);
}

const preview = (h: H, f: F, id: string, body: Record<string, unknown>) => h.app.request(`/v1/payments/${id}/correct/preview`, json(body, f.auth));
const correctWith = (h: H, f: F, id: string, body: Record<string, unknown>, headers: Record<string, string> = idem()) => h.app.request(`/v1/payments/${id}/correct`, json(body, { ...f.auth, ...headers }));

/** Preview, then correct with its token; `sent` is the exact body, for a replay. */
async function correct(h: H, f: F, id: string, body: Record<string, unknown>, reasonBody: Record<string, unknown> = { reasonCode: 'ENTERED_BY_MISTAKE' }, headers: Record<string, string> = idem()) {
  tick(h);
  const p = await preview(h, f, id, body);
  expect(p.status, JSON.stringify(await p.clone().json())).toBe(200);
  const sent = { ...body, ...reasonBody, previewToken: (await read(p)).previewToken };
  return { res: await correctWith(h, f, id, sent, headers), sent };
}

const getPayment = async (h: H, f: F, id: string) => read(await h.app.request(`/v1/payments/${id}`, { headers: f.auth }));
const getReceivable = async (h: H, f: F, id: string) => read(await h.app.request(`/v1/receivables/${id}`, { headers: f.auth }));
const auditOf = async (h: H, f: F, entityType: string, id: string) => (await read(await h.app.request(`/v1/audit?entityType=${entityType}&entityId=${id}`, { headers: f.auth }))).items as Loose[];
const listPayments = async (h: H, f: F) => (await read(await h.app.request(`/v1/payments?customerId=${f.customer.id}`, { headers: f.auth }))).items as Loose[];

/** The QA scenario's ledger: a ₪1,000 charge paid in full by a payment with receipt 3001. */
async function settledCharge(h: H) {
  const f = await firm(h);
  const [charge] = await charges(h, f, ['1000.00']);
  const original = await pay(h, f, '1000.00', [{ receivableId: charge.id, amount: '1000.00' }]);
  return { f, charge, original };
}

const toSix = (charge: Loose) => ({ amount: '600.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '600.00' }] });

describe('the correction preview', () => {
  it('shows the reversal, the new allocations and the balances from the ledger now to after (R2)', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const res = await preview(h, f, original.id, toSix(charge));
    expect(res.status).toBe(200);
    const p = await read(res);
    expect(p).toMatchObject({ customerId: f.customer.id, currency: 'ILS', amount: '600.00', allocated: '600.00', unallocated: '0.00', receiptNumber: '3001', warnings: [] });
    expect(p.reversal).toEqual({ paymentId: original.id, number: original.number, amount: '1000.00', receivedOn: '2026-10-20', receiptNumber: '3001', released: [{ receivableId: charge.id, amount: '1000.00' }] });
    expect(p.allocations).toEqual([{ receivableId: charge.id, amount: '600.00' }]);
    expect(p.balances.receivables).toEqual([{ receivableId: charge.id, projectId: f.project.id, outstandingBefore: '0.00', outstandingAfter: '400.00', statusBefore: 'PAID', statusAfter: 'PARTIALLY_PAID' }]);
    expect(p.balances.customer).toEqual({ before: { outstanding: '0.00', overdue: '0.00' }, after: { outstanding: '400.00', overdue: '0.00' } });
    expect(p.eligible.map((r: Loose) => [r.receivableId, r.outstanding])).toEqual([[charge.id, '1000.00']]);
    expect(p.previewToken).toMatch(/^[0-9a-f]{64}$/);
    // Writes nothing.
    expect(await getPayment(h, f, original.id)).toMatchObject({ status: 'POSTED', version: original.version });
    expect((await getReceivable(h, f, charge.id)).paid).toBe('1000.00');
  });

  it('a receivable only released still shows, going from ₪0 to what it owes again (R2)', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const p = await read(await preview(h, f, original.id, { amount: '1000.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [] }));
    expect(p).toMatchObject({ allocated: '0.00', unallocated: '1000.00' });
    expect(p.balances.receivables).toEqual([{ receivableId: charge.id, projectId: f.project.id, outstandingBefore: '0.00', outstandingAfter: '1000.00', statusBefore: 'PAID', statusAfter: 'DUE' }]);
  });

  it('the reason is optional on the preview and outside its token (R5)', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const without = await read(await preview(h, f, original.id, toSix(charge)));
    const withReason = await read(await preview(h, f, original.id, { ...toSix(charge), reasonCode: 'GOODWILL', note: 'x' }));
    expect(withReason.previewToken).toBe(without.previewToken);
    const res = await correctWith(h, f, original.id, { ...toSix(charge), reasonCode: 'CLIENT_DISPUTE', previewToken: without.previewToken });
    expect(res.status).toBe(200);
  });

  it('needs allocations (may be empty) or a strategy, so a date-only correction never unallocates silently (R6)', async () => {
    const h = harness();
    const { f, original } = await settledCharge(h);
    const res = await preview(h, f, original.id, { amount: '1000.00', receivedOn: '2026-10-27', method: 'BANK' });
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /v1/payments/{id}/correct', () => {
  it('AC1: reverses the original and records the correction together, linked both ways', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const { res } = await correct(h, f, original.id, toSix(charge));
    expect(res.status).toBe(200);
    const { reversed, payment } = await read(res);
    expect(reversed).toMatchObject({ id: original.id, status: 'REVERSED', reversalReason: 'ENTERED_BY_MISTAKE', reversalReasonCode: 'ENTERED_BY_MISTAKE', replacedByPaymentId: payment.id, allocated: '0.00' });
    expect(payment).toMatchObject({ status: 'POSTED', replacesPaymentId: original.id, amount: '600.00', allocated: '600.00', unallocated: '0.00', receivedOn: '2026-10-27', receiptNumber: '3001', reference: 'TR-1', notes: 'First transfer', origin: 'integration', reversalReasonCode: null });
    expect(payment.number).not.toBe(original.number);
    expect(await getReceivable(h, f, charge.id)).toMatchObject({ paid: '600.00', outstanding: '400.00' });
  });

  it('AC1: a failure in the write leaves the original POSTED and untouched', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const [other] = await charges(h, f, ['500.00']);
    tick(h);
    const p = await read(await preview(h, f, original.id, { amount: '1500.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '1000.00' }, { receivableId: other.id, amount: '500.00' }] }));
    // Another payment takes `other` between the token check and the write: the store refuses, and nothing moves.
    const real = h.store.payments.correct.bind(h.store.payments);
    h.store.payments.correct = async (...args) => {
      await h.store.payments.create({ organizationId: f.org.id, customerId: f.customer.id, projectId: null, currency: 'ILS', amountMinor: 50_000n, receivedOn: '2026-10-28', method: 'CASH', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: other.id, amountMinor: 50_000n }] }, h.clock.now);
      return real(...args);
    };
    const res = await correctWith(h, f, original.id, { amount: '1500.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '1000.00' }, { receivableId: other.id, amount: '500.00' }], reasonCode: 'ENTERED_BY_MISTAKE', previewToken: p.previewToken });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
    expect(await getPayment(h, f, original.id)).toMatchObject({ status: 'POSTED', version: original.version, allocated: '1000.00', reversedAt: null, reversalReasonCode: null, replacedByPaymentId: null });
    expect(await getReceivable(h, f, charge.id)).toMatchObject({ paid: '1000.00', outstanding: '0.00' });
    expect((await auditOf(h, f, 'payment', original.id)).map((e) => e.action)).not.toContain('payment.corrected');
  });

  it('AC2: replaying the same Idempotency-Key returns the stored answer and never corrects twice', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const key = idem();
    const { res: first, sent } = await correct(h, f, original.id, toSix(charge), { reasonCode: 'ENTERED_BY_MISTAKE' }, key);
    expect(first.status).toBe(200);
    const body = await read(first);
    tick(h);
    const again = await correctWith(h, f, original.id, sent, key);
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await read(again)).toEqual(body);
    expect((await listPayments(h, f)).filter((x) => x.replacesPaymentId === original.id)).toHaveLength(1);
    expect((await auditOf(h, f, 'payment', original.id)).filter((e) => e.action === 'payment.corrected')).toHaveLength(1);
  });

  it('AC3: a stale previewToken is 409 PREVIEW_STALE: a credit landed on a receivable in its pool', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const [other] = await charges(h, f, ['500.00']);
    tick(h);
    const p = await read(await preview(h, f, original.id, toSix(charge)));
    expect((await h.app.request(`/v1/receivables/${other.id}/credits`, json({ amount: '10.00', reason: 'Goodwill' }, { ...f.auth, ...idem() }))).status).toBe(201);
    const res = await correctWith(h, f, original.id, { ...toSix(charge), reasonCode: 'ENTERED_BY_MISTAKE', previewToken: p.previewToken });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
    expect((await getPayment(h, f, original.id)).status).toBe('POSTED');
  });

  it('AC3: the original changed since the preview (a receipt number set) is 409 PREVIEW_STALE', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const p = await read(await preview(h, f, original.id, toSix(charge)));
    expect((await h.app.request(`/v1/payments/${original.id}/receipt-number`, json({ receiptNumber: '3002' }, { ...f.auth, 'if-match': String(original.version) }, 'PUT'))).status).toBe(200);
    const res = await correctWith(h, f, original.id, { ...toSix(charge), reasonCode: 'ENTERED_BY_MISTAKE', previewToken: p.previewToken });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
  });

  it('AC4: correcting a reversed payment is 409 PAYMENT_NOT_POSTED, naming when and what replaced it (R3)', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const { res: done } = await correct(h, f, original.id, toSix(charge));
    const { payment } = await read(done);
    // The response was lost: the caller tries again under a new key, and learns where the money went.
    const res = await correctWith(h, f, original.id, { ...toSix(charge), reasonCode: 'ENTERED_BY_MISTAKE', previewToken: 'f'.repeat(64) });
    expect(res.status).toBe(409);
    const details = (await read(res)).error.details;
    expect(details).toMatchObject({ reason: 'PAYMENT_NOT_POSTED', replacedByPaymentId: payment.id });
    expect(details.reversedAt).toEqual(expect.any(String));
    expect((await preview(h, f, original.id, toSix(charge))).status).toBe(409);

    // A plain reversal has no replacement.
    const plain = await pay(h, f, '10.00', []);
    expect((await h.app.request(`/v1/payments/${plain.id}/reverse`, json({ reason: 'Bounced' }, { ...f.auth, ...idem() }))).status).toBe(200);
    const again = await correctWith(h, f, plain.id, { amount: '9.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [], reasonCode: 'OTHER', note: 'x', previewToken: 'f'.repeat(64) });
    expect((await read(again)).error.details).toMatchObject({ reason: 'PAYMENT_NOT_POSTED', replacedByPaymentId: null });
  });

  it('R3: a refusal is stored under its key, so the same key replays it; a new key is needed', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const key = idem();
    const body = { ...toSix(charge), reasonCode: 'ENTERED_BY_MISTAKE', previewToken: 'a'.repeat(64) };
    const first = await correctWith(h, f, original.id, body, key);
    expect(first.status).toBe(409);
    const again = await correctWith(h, f, original.id, body, key);
    expect(again.status).toBe(409);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
  });

  it('R4: lost to a reversal inside the write is PAYMENT_NOT_POSTED; lost to another version is PREVIEW_STALE', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const real = h.store.payments.correct.bind(h.store.payments);
    const p = await read(await preview(h, f, original.id, toSix(charge)));
    h.store.payments.correct = async (...args) => {
      await h.store.payments.setReceiptNumber(f.org.id, original.id, original.version, '3009', h.clock.now);
      return real(...args);
    };
    const versioned = await correctWith(h, f, original.id, { ...toSix(charge), reasonCode: 'ENTERED_BY_MISTAKE', previewToken: p.previewToken });
    expect(versioned.status).toBe(409);
    expect(await reason(versioned)).toBe('PREVIEW_STALE');

    const now = await getPayment(h, f, original.id);
    const p2 = await read(await preview(h, f, original.id, toSix(charge)));
    h.store.payments.correct = async (...args) => {
      await h.store.payments.reverse(f.org.id, original.id, 'Bounced', h.clock.now);
      return real(...args);
    };
    const reversed = await correctWith(h, f, original.id, { ...toSix(charge), reasonCode: 'ENTERED_BY_MISTAKE', previewToken: p2.previewToken });
    expect(reversed.status).toBe(409);
    expect((await read(reversed)).error.details).toMatchObject({ reason: 'PAYMENT_NOT_POSTED', replacedByPaymentId: null });
    expect(now.version).toBe(original.version + 1);
  });

  it('AC5: no reasonCode, or OTHER without a note, is 422 REASON_REQUIRED', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const p = await read(await preview(h, f, original.id, toSix(charge)));
    for (const why of [{}, { reasonCode: 'OTHER' }, { reasonCode: 'OTHER', note: '   ' }]) {
      const res = await correctWith(h, f, original.id, { ...toSix(charge), ...why, previewToken: p.previewToken });
      expect(res.status).toBe(422);
      expect(await reason(res)).toBe('REASON_REQUIRED');
    }
    expect((await getPayment(h, f, original.id)).status).toBe('POSTED');
    const { res } = await correct(h, f, original.id, toSix(charge), { reasonCode: 'OTHER', note: ' Client paid by card, not transfer ' });
    expect((await read(res)).reversed).toMatchObject({ reversalReason: 'Client paid by card, not transfer', reversalReasonCode: 'OTHER' });
  });

  it('a note may not be the reason reserved for a person undoing their own capture: 422 REASON_RESERVED (review 2)', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const p = await read(await preview(h, f, original.id, toSix(charge)));
    const res = await correctWith(h, f, original.id, { ...toSix(charge), reasonCode: 'OTHER', note: ' capture_undo ', previewToken: p.previewToken });
    expect(res.status).toBe(422);
    expect(await reason(res)).toBe('REASON_RESERVED');
    expect((await getPayment(h, f, original.id)).status).toBe('POSTED');
  });

  it('a receivable locked by another write at the same moment is 409 PREVIEW_STALE, and nothing is written (review 4)', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const p = await read(await preview(h, f, original.id, toSix(charge)));
    h.store.payments.correct = async () => {
      throw new LockConflict();
    };
    const res = await correctWith(h, f, original.id, { ...toSix(charge), reasonCode: 'ENTERED_BY_MISTAKE', previewToken: p.previewToken });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
    expect(await getPayment(h, f, original.id)).toMatchObject({ status: 'POSTED', version: original.version });
  });

  it('AC6: money not allocated stays on the corrected payment as credit', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const { res } = await correct(h, f, original.id, { amount: '1200.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '1000.00' }] });
    expect((await read(res)).payment).toMatchObject({ amount: '1200.00', allocated: '1000.00', unallocated: '200.00', allocationState: 'partial' });
  });

  it('AC6: over-allocation is refused with the receivable named', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const res = await preview(h, f, original.id, { amount: '1500.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '1500.00' }] });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALLOCATION_EXCEEDS_OUTSTANDING', receivableId: charge.id, outstanding: '1000.00', excess: '500.00' });
    const tooMuch = await preview(h, f, original.id, { amount: '100.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '200.00' }] });
    expect(await reason(tooMuch)).toBe('ALLOCATION_EXCEEDS_PAYMENT');
  });

  it('AC7: the contract version is bumped and both routes are published', async () => {
    const h = harness();
    expect(API_VERSION).toBe('1.90.0-mut483');
    const doc = await read(await h.app.request('/openapi.json'));
    expect(doc.info.version).toBe('1.90.0-mut483');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/v1/payments/{paymentId}/correct', '/v1/payments/{paymentId}/correct/preview']));
  });

  it('re-pays a receivable another payment settled since, up to what the reversal releases', async () => {
    const h = harness();
    const f = await firm(h);
    const [charge] = await charges(h, f, ['1000.00']);
    const original = await pay(h, f, '600.00', [{ receivableId: charge.id, amount: '600.00' }]);
    await pay(h, f, '400.00', [{ receivableId: charge.id, amount: '400.00' }], { receiptNumber: null });
    const over = await preview(h, f, original.id, { amount: '700.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '700.00' }] });
    expect((await read(over)).error.details).toMatchObject({ reason: 'ALLOCATION_EXCEEDS_OUTSTANDING', outstanding: '600.00' });
    const { res } = await correct(h, f, original.id, { amount: '600.00', receivedOn: '2026-10-27', method: 'CASH', allocations: [{ receivableId: charge.id, amount: '600.00' }] });
    expect(res.status).toBe(200);
    expect(await getReceivable(h, f, charge.id)).toMatchObject({ paid: '1000.00', outstanding: '0.00' });
  });

  it('strategy allocates as the preview does; explicit allocations win (D7)', async () => {
    const h = harness();
    const f = await firm(h);
    const [a, b] = await charges(h, f, ['300.00', '500.00']);
    const original = await pay(h, f, '300.00', [{ receivableId: a.id, amount: '300.00' }]);
    const { res } = await correct(h, f, original.id, { amount: '500.00', receivedOn: '2026-10-27', method: 'BANK', strategy: 'OLDEST_FIRST' });
    expect(res.status).toBe(200);
    expect((await read(res)).payment.allocations.map((x: Loose) => [x.receivableId, x.amount])).toEqual([[a.id, '300.00'], [b.id, '200.00']]);
  });

  it('the receipt number, reference and notes are kept when left out, cleared with null, replaced with a value (MUT-481, R10)', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const { res: kept } = await correct(h, f, original.id, toSix(charge));
    const k = await read(kept);
    expect(k.payment).toMatchObject({ receiptNumber: '3001', reference: 'TR-1', notes: 'First transfer' });
    expect((await auditOf(h, f, 'payment', original.id)).find((e) => e.action === 'payment.corrected').metadata).toMatchObject({ receiptNumber: '3001', receiptNumberCarried: true });

    const { res: changed } = await correct(h, f, k.payment.id, { ...toSix(charge), amount: '650.00', allocations: [{ receivableId: charge.id, amount: '650.00' }], receiptNumber: ' 3002 ', reference: 'TR-2', notes: null });
    const c = await read(changed);
    expect(c.payment).toMatchObject({ receiptNumber: '3002', reference: 'TR-2', notes: null });

    const { res: cleared } = await correct(h, f, c.payment.id, { ...toSix(charge), receiptNumber: null, reference: null });
    expect((await read(cleared)).payment).toMatchObject({ receiptNumber: null, reference: null, notes: null });

  });

  it('a bad receipt number is 422 RECEIPT_NUMBER_INVALID', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const res = await preview(h, f, original.id, { ...toSix(charge), receiptNumber: '20\n41' });
    expect(res.status).toBe(422);
    expect(await reason(res)).toBe('RECEIPT_NUMBER_INVALID');
  });

  it('D3: below the ten-year floor the original date or a later one is kept; an earlier one is refused', async () => {
    const h = harness('2026-01-10T10:00:00Z');
    const f = await firm(h);
    const old = await pay(h, f, '100.00', [], { receivedOn: '2016-03-01' });
    h.clock.now = new Date('2026-10-28T10:00:00Z');
    const earlier = await preview(h, f, old.id, { amount: '90.00', receivedOn: '2016-02-01', method: 'BANK', allocations: [] });
    expect(earlier.status).toBe(422);
    expect((await read(earlier)).error.details).toMatchObject({ reason: 'DATE_INVALID', bound: 'past' });
    const { res: same } = await correct(h, f, old.id, { amount: '90.00', receivedOn: '2016-03-01', method: 'BANK', allocations: [] });
    expect(same.status).toBe(200);
    const moved = await read(same);
    const { res: later } = await correct(h, f, moved.payment.id, { amount: '90.00', receivedOn: '2016-04-01', method: 'BANK', allocations: [] });
    expect(later.status).toBe(200);
    const future = await preview(h, f, (await read(later)).payment.id, { amount: '90.00', receivedOn: '2037-01-01', method: 'BANK', allocations: [] });
    expect((await read(future)).error.details).toMatchObject({ reason: 'DATE_INVALID', bound: 'future' });
  });

  it('D4: a payment a person recorded is 422 PAYMENT_NOT_CORRECTABLE', async () => {
    const h = harness();
    const f = await firm(h);
    const { user } = await h.store.users.create({ email: `p-${++seq}@studio.ps`, displayName: 'Nour', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: `p-${seq}-${Date.now()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: h.clock.now });
    const { payment } = await h.store.payments.capture({ organizationId: f.org.id, customerId: f.customer.id, projectId: null, currency: 'ILS', amountMinor: 500n, receivedOn: '2026-10-27', method: 'CASH', notes: null, requestId: null, createdByUserId: user.id, captureSource: null }, h.clock.now);
    const res = await preview(h, f, payment.id, { amount: '4.00', receivedOn: '2026-10-27', method: 'CASH', allocations: [] });
    expect(res.status).toBe(422);
    expect(await reason(res)).toBe('PAYMENT_NOT_CORRECTABLE');
  });

  it('R10: an archived customer is 422 CUSTOMER_ARCHIVED; a correction that changes nothing is 422 NOTHING_TO_CORRECT', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const same = await preview(h, f, original.id, { amount: '1000.00', receivedOn: '2026-10-20', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '1000.00' }] });
    expect(same.status).toBe(422);
    expect(await reason(same)).toBe('NOTHING_TO_CORRECT');
    // One field differs: a correction.
    expect((await preview(h, f, original.id, { amount: '1000.00', receivedOn: '2026-10-20', method: 'CASH', allocations: [{ receivableId: charge.id, amount: '1000.00' }] })).status).toBe(200);

    const loose = await pay(h, f, '50.00', []);
    await h.store.customers.archive(f.org.id, f.customer.id, h.clock.now);
    const archived = await preview(h, f, loose.id, { amount: '40.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [] });
    expect(archived.status).toBe(422);
    expect(await reason(archived)).toBe('CUSTOMER_ARCHIVED');
  });

  it('audits payment.corrected on the original, payment.recorded on the new one, and receivable.settled only when a status changes (D5, R9)', async () => {
    const h = harness();
    const f = await firm(h);
    const [a, b] = await charges(h, f, ['1000.00', '500.00']);
    const original = await pay(h, f, '1000.00', [{ receivableId: a.id, amount: '1000.00' }]);
    const { res } = await correct(h, f, original.id, { amount: '1500.00', receivedOn: '2026-10-27', method: 'CASH', allocations: [{ receivableId: a.id, amount: '1000.00' }, { receivableId: b.id, amount: '500.00' }] }, { reasonCode: 'CLIENT_DISPUTE', note: 'Paid both at once' });
    const { payment } = await read(res);
    const corrected = (await auditOf(h, f, 'payment', original.id)).filter((e) => e.action === 'payment.corrected');
    expect(corrected).toHaveLength(1);
    expect(corrected[0].actorType).toBe('API_KEY');
    expect(corrected[0].metadata).toEqual({
      replacementPaymentId: payment.id,
      number: original.number,
      replacementNumber: payment.number,
      reasonCode: 'CLIENT_DISPUTE',
      note: 'Paid both at once',
      amount: { from: '1000.00', to: '1500.00' },
      receivedOn: { from: '2026-10-20', to: '2026-10-27' },
      method: { from: 'BANK', to: 'CASH' },
      receiptNumber: '3001',
      receiptNumberCarried: true,
      allocationsReleased: 1,
      allocations: 2,
      unallocated: '0.00',
    });
    expect((await auditOf(h, f, 'payment', original.id)).map((e) => e.action)).not.toContain('payment.reversed');
    expect((await auditOf(h, f, 'payment', payment.id)).find((e) => e.action === 'payment.recorded').metadata).toMatchObject({ replacesPaymentId: original.id, amount: '1500.00', allocations: 2 });
    // `a` was settled by the original and is settled again: no new row. `b` is newly settled.
    expect((await auditOf(h, f, 'receivable', a.id)).filter((e) => e.action === 'receivable.settled')).toHaveLength(1);
    expect((await auditOf(h, f, 'receivable', b.id)).filter((e) => e.action === 'receivable.settled').map((e) => e.metadata)).toEqual([{ paymentId: payment.id }]);
  });

  it('R8: on the statement the reversal (dated the correction day, with its reason) sorts before the corrected payment', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const { res } = await correct(h, f, original.id, { amount: '600.00', receivedOn: '2026-10-28', method: 'BANK', allocations: [{ receivableId: charge.id, amount: '600.00' }] }, { reasonCode: 'ENTERED_BY_MISTAKE' });
    const { payment } = await read(res);
    const statement = await read(await h.app.request(`/v1/customers/${f.customer.id}/statement?currency=ILS`, { headers: f.auth }));
    const lines = (statement.lines as Loose[]).filter((l) => l.kind !== 'CHARGE');
    expect(lines.map((l) => [l.kind, l.paymentId, l.date])).toEqual([
      ['PAYMENT', original.id, '2026-10-20'],
      ['PAYMENT_REVERSAL', original.id, '2026-10-28'],
      ['PAYMENT', payment.id, '2026-10-28'],
    ]);
    expect(lines[1]).toMatchObject({ reason: 'ENTERED_BY_MISTAKE', reasonCode: 'ENTERED_BY_MISTAKE', receiptNumber: '3001' });
    expect(statement.closingBalance).toBe('400.00');
  });

  it('API key only: a signed-in person is 403', async () => {
    const h = harness();
    const { f, charge, original } = await settledCharge(h);
    const email = `owner${++seq}@studio.ps`;
    const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: f.org.id, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const session = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
    const token = new RegExp(`${COOKIE}=([^;]*)`).exec(session.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const as = { cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': f.org.id, ...SAME_ORIGIN };
    expect((await h.app.request(`/v1/payments/${original.id}/correct/preview`, json(toSix(charge), as))).status).toBe(403);
    expect((await h.app.request(`/v1/payments/${original.id}/correct`, json({ ...toSix(charge), reasonCode: 'GOODWILL', previewToken: 'a'.repeat(64) }, { ...as, ...idem() }))).status).toBe(403);
  });

  it('another organization’s payment is 404', async () => {
    const h = harness();
    const { charge, original } = await settledCharge(h);
    const other = await firm(h);
    expect((await preview(h, other, original.id, toSix(charge))).status).toBe(404);
  });
});
