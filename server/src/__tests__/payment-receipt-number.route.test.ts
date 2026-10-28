import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-481: the legal receipt's number on payments over HTTP. Today is 2026-10-28 in Asia/Jerusalem. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const reason = async (res: Response) => (await read(res)).error.details.reason;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };

function harness(now = '2026-10-28T10:00:00Z') {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date(now) };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.3.0-test', now: () => clock.now });
  return { app, store, clock };
}
type H = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function firm(h: H) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'))).status).toBe(201);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Lawsuit', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}
type F = Awaited<ReturnType<typeof firm>>;


async function pay(h: H, f: F, extra: Record<string, unknown> = {}, amount = '100.00') {
  const p = await read(await h.app.request('/v1/allocations/preview', json({ customerId: f.customer.id, currency: 'ILS', amount, allocations: [] }, f.auth)));
  return h.app.request('/v1/payments', json({ customerId: f.customer.id, currency: 'ILS', amount, receivedOn: '2026-10-27', method: 'BANK', reference: 'TR-1', allocations: [], previewToken: p.previewToken, ...extra }, { ...f.auth, ...idem() }));
}
const created = async (res: Response) => {
  expect(res.status).toBe(201);
  return read(res);
};
const reverse = async (h: H, f: F, id: string) => expect((await h.app.request(`/v1/payments/${id}/reverse`, json({ reason: 'Wrong amount' }, { ...f.auth, ...idem() }))).status).toBe(200);
const setNumber = (h: H, f: F, id: string, version: number | null, receiptNumber: string | null) =>
  h.app.request(`/v1/payments/${id}/receipt-number`, json({ receiptNumber }, { ...f.auth, ...(version === null ? {} : { 'if-match': String(version) }) }, 'PUT'));
const auditOf = async (h: H, f: F, id: string) => (await read(await h.app.request(`/v1/audit?entityType=payment&entityId=${id}`, { headers: f.auth }))).items;

describe('receiptNumber on POST /v1/payments (AC1, D3)', () => {
  it('records a payment with and without one, trimmed', async () => {
    const h = harness();
    const f = await firm(h);
    expect(await created(await pay(h, f, { receiptNumber: '  2041 ' }))).toMatchObject({ receiptNumber: '2041', reference: 'TR-1' });
    expect(await created(await pay(h, f))).toMatchObject({ receiptNumber: null });
    expect(await created(await pay(h, f, { receiptNumber: null }))).toMatchObject({ receiptNumber: null });
  });

  it('refuses a blank, too long or control-character number with 422 RECEIPT_NUMBER_INVALID', async () => {
    const h = harness();
    const f = await firm(h);
    for (const bad of ['', '   ', '9'.repeat(65), '20\n41']) {
      const res = await pay(h, f, { receiptNumber: bad });
      expect(res.status).toBe(422);
      expect(await reason(res)).toBe('RECEIPT_NUMBER_INVALID');
    }
  });
});

describe('receiptNumber on reads (AC2)', () => {
  it('shows on the payment, the list, the ?receiptNumber= filter, and both statement lines', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await created(await pay(h, f, { receiptNumber: 'קבלה 2041' }));
    await created(await pay(h, f, { receiptNumber: '2042' }));
    expect(await read(await h.app.request(`/v1/payments/${p.id}`, { headers: f.auth }))).toMatchObject({ receiptNumber: 'קבלה 2041' });
    const found = await read(await h.app.request(`/v1/payments?receiptNumber=${encodeURIComponent(' קבלה 2041 ')}`, { headers: f.auth }));
    expect(found.items.map((x: Loose) => x.id)).toEqual([p.id]);
    expect((await read(await h.app.request('/v1/payments?receiptNumber=', { headers: f.auth }))).items).toHaveLength(2);
    await reverse(h, f, p.id);
    const statement = await read(await h.app.request(`/v1/customers/${f.customer.id}/statement?currency=ILS`, { headers: f.auth }));
    expect(statement.lines.filter((l: Loose) => l.paymentId === p.id).map((l: Loose) => [l.kind, l.receiptNumber])).toEqual([['PAYMENT', 'קבלה 2041'], ['PAYMENT_REVERSAL', 'קבלה 2041']]);
  });

  it('a person-made payment never carries one (D6)', async () => {
    const h = harness();
    const f = await firm(h);
    const { payment } = await h.store.payments.capture({ organizationId: f.org.id, customerId: f.customer.id, projectId: null, currency: 'ILS', amountMinor: 500n, receivedOn: '2026-10-27', method: 'CASH', notes: null, requestId: null, createdByUserId: (await h.store.users.create({ email: `p-${Date.now()}@studio.ps`, displayName: 'Nour', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: `p-${Date.now()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: h.clock.now })).user.id, captureSource: null }, h.clock.now);
    expect(await read(await h.app.request(`/v1/payments/${payment.id}`, { headers: f.auth }))).toMatchObject({ receiptNumber: null });
  });
});

describe('a correction keeps the receipt number unless it changes it (AC3, D1)', () => {
  it('left out: carried over, and audited as carried; a value: changed; null: cleared', async () => {
    const h = harness();
    const f = await firm(h);
    const original = await created(await pay(h, f, { receiptNumber: '2041' }));
    await reverse(h, f, original.id);
    const kept = await created(await pay(h, f, { replacesPaymentId: original.id }, '90.00'));
    expect(kept).toMatchObject({ receiptNumber: '2041', replacesPaymentId: original.id });
    expect((await auditOf(h, f, kept.id)).find((e: Loose) => e.action === 'payment.recorded').metadata).toMatchObject({ receiptNumber: '2041', receiptNumberCarried: true });
    expect(await created(await pay(h, f, { replacesPaymentId: original.id, receiptNumber: '2042' }, '90.00'))).toMatchObject({ receiptNumber: '2042' });
    expect(await created(await pay(h, f, { replacesPaymentId: original.id, receiptNumber: null }, '90.00'))).toMatchObject({ receiptNumber: null });
  });
});

describe('PUT /v1/payments/{id}/receipt-number (D5)', () => {
  it('sets and clears it on the version read, audits it, and a repeat of the same value is a no-op', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await created(await pay(h, f));
    const set = await setNumber(h, f, p.id, p.version, ' 2041 ');
    expect(set.status).toBe(200);
    const after = await read(set);
    expect(after).toMatchObject({ receiptNumber: '2041', version: p.version + 1 });
    const again = await setNumber(h, f, p.id, after.version, '2041');
    expect(again.status).toBe(200);
    expect((await read(again)).version).toBe(after.version);
    expect((await auditOf(h, f, p.id)).filter((e: Loose) => e.action === 'payment.receipt_number_set').map((e: Loose) => e.metadata)).toEqual([{ from: null, to: '2041', version: p.version + 1 }]);
    expect(await read(await setNumber(h, f, p.id, after.version, null))).toMatchObject({ receiptNumber: null });
  });

  it('a stale version is 409 VERSION_MISMATCH; no If-Match is 422; a bad value is RECEIPT_NUMBER_INVALID', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await created(await pay(h, f));
    const stale = await setNumber(h, f, p.id, p.version + 5, '2041');
    expect(stale.status).toBe(409);
    expect(await reason(stale)).toBe('VERSION_MISMATCH');
    expect((await setNumber(h, f, p.id, null, '2041')).status).toBe(422);
    expect(await reason(await setNumber(h, f, p.id, p.version, '   '))).toBe('RECEIPT_NUMBER_INVALID');
  });

  it('a reversed payment is 409 ALREADY_REVERSED; another firm’s is 404', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await created(await pay(h, f, { receiptNumber: '2041' }));
    await reverse(h, f, p.id);
    const current = await read(await h.app.request(`/v1/payments/${p.id}`, { headers: f.auth }));
    const res = await setNumber(h, f, p.id, current.version, '2042');
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('ALREADY_REVERSED');
    const other = await firm(h);
    expect((await setNumber(h, other, p.id, current.version, '2042')).status).toBe(404);
  });
});
