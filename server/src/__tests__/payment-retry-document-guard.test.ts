import { describe, expect, it } from 'vitest';
import { SCOPES } from '../auth/scopes.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, type AccountantHarness, type Loose, type Person } from './helpers/accountants.js';

/**
 * MUT-709: (1) a retry after a 5xx never records a payment twice: the 5xx releases the Idempotency-Key, so the route
 * finds the payment the first attempt committed by its clientRequestKey; (2) a payment an issued receipt or
 * invoice-receipt stands on is never reversed, corrected or undone (409 HAS_DOCUMENT).
 */

/** The store, except that the first audit row with this action throws: a failure after the payment committed. */
function failsAfterCommit(store: MemoryLedgerStore, action: string): LedgerStore {
  let armed = true;
  return new Proxy(store, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value === 'function') return value.bind(target);
      if (prop !== 'audit' || typeof value !== 'object' || value === null) return value;
      return new Proxy(value, {
        get(repo, method) {
          const fn: unknown = Reflect.get(repo, method, repo);
          if (method !== 'append' || typeof fn !== 'function') return fn;
          return (...args: unknown[]) => {
            if (armed && (args[0] as { action?: string }).action === action) {
              armed = false;
              throw new Error('the database went away after the payment committed');
            }
            return (fn as (...a: unknown[]) => unknown).apply(repo, args);
          };
        },
      });
    },
  }) as LedgerStore;
}

function harnessFailingOn(action: string) {
  const store = new MemoryLedgerStore();
  return { h: accountantHarness({ store: failsAfterCommit(store, action) }), store };
}

async function owner(h: AccountantHarness) {
  const p = await person(h);
  const profileId = await businessOf(h, p);
  const on = p.on(profileId);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Horizon Ltd' }, { ...on, ...idem() })));
  return { p, profileId, on, customerId: customer.id as string };
}

const postedPayments = async (store: MemoryLedgerStore, profileId: string) => (await store.payments.list(profileId, { status: 'POSTED' }, { limit: 50, cursor: null })).items;

describe('MUT-709: a retry after a 5xx records the payment once (AC1)', () => {
  it('settle: the first attempt commits then fails; the retry answers 201 with that payment, and there is one', async () => {
    const { h, store } = harnessFailingOn('payment.recorded');
    const w = await owner(h);
    const owed = await read(await h.app.request('/v1/income', json({ kind: 'owed', amount: '6000.00', currency: 'ILS', occurredOn: '2026-11-01', customerId: w.customerId }, { ...w.on, ...idem() })));
    const key = idem();
    const body = json({ amount: '1000.00' }, { ...w.on, ...key });
    expect((await h.app.request(`/v1/receivables/${owed.id}/settle`, body)).status).toBe(500);
    const retry = await h.app.request(`/v1/receivables/${owed.id}/settle`, json({ amount: '1000.00' }, { ...w.on, ...key }));
    expect(retry.status, await retry.clone().text()).toBe(201);
    const answer = await read(retry);
    const payments = await postedPayments(store, w.profileId);
    expect(payments).toHaveLength(1);
    expect(answer.payment.id).toBe(payments[0]!.id);
    expect(answer.receivable).toMatchObject({ paid: '1000.00', outstanding: '5000.00' });
    expect(await store.receivables.getById(w.profileId, owed.id)).toMatchObject({ paidMinor: 100_000n });
  });

  it('settle in full: the retry is not refused as "nothing outstanding"', async () => {
    const { h, store } = harnessFailingOn('payment.recorded');
    const w = await owner(h);
    const owed = await read(await h.app.request('/v1/income', json({ kind: 'owed', amount: '500.00', currency: 'ILS', occurredOn: '2026-11-01', customerId: w.customerId }, { ...w.on, ...idem() })));
    const key = idem();
    expect((await h.app.request(`/v1/receivables/${owed.id}/settle`, json({}, { ...w.on, ...key }))).status).toBe(500);
    expect((await h.app.request(`/v1/receivables/${owed.id}/settle`, json({}, { ...w.on, ...key }))).status).toBe(201);
    expect(await postedPayments(store, w.profileId)).toHaveLength(1);
  });

  it('a Received capture: the retry answers with the first payment, once', async () => {
    const { h, store } = harnessFailingOn('income.received');
    const w = await owner(h);
    const key = idem();
    const body = { kind: 'received', amount: '850.00', currency: 'ILS', occurredOn: '2026-11-05', customerId: w.customerId };
    expect((await h.app.request('/v1/income', json(body, { ...w.on, ...key }))).status).toBe(500);
    const retry = await h.app.request('/v1/income', json(body, { ...w.on, ...key }));
    expect(retry.status).toBe(201);
    const payments = await postedPayments(store, w.profileId);
    expect(payments).toHaveLength(1);
    expect((await read(retry)).id).toBe(payments[0]!.id);
    // A different key is a different payment, as before.
    expect((await h.app.request('/v1/income', json(body, { ...w.on, ...idem() }))).status).toBe(201);
    expect(await postedPayments(store, w.profileId)).toHaveLength(2);
  });

  it('POST /v1/payments (API key): the retry answers with the first payment, before the now-stale preview token', async () => {
    const { h, store } = harnessFailingOn('payment.recorded');
    const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    const apiKey = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, ADMIN)));
    const auth = { authorization: `Bearer ${apiKey.secret}` };
    const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
    const preview = await read(await h.app.request('/v1/allocations/preview', json({ customerId: customer.id, currency: 'ILS', amount: '100.00', allocations: [] }, auth)));
    const key = idem();
    const body = { customerId: customer.id, currency: 'ILS', amount: '100.00', receivedOn: '2026-11-05', method: 'BANK', reference: 'TR-1', allocations: [], previewToken: preview.previewToken };
    expect((await h.app.request('/v1/payments', json(body, { ...auth, ...key }))).status).toBe(500);
    const retry = await h.app.request('/v1/payments', json(body, { ...auth, ...key }));
    expect(retry.status, await retry.clone().text()).toBe(201);
    const payments = await postedPayments(store, org.id);
    expect(payments).toHaveLength(1);
    expect((await read(retry)).id).toBe(payments[0]!.id);
  });

  it('the store refuses a second payment with the same clientRequestKey in one profile, not across profiles', async () => {
    const store = new MemoryLedgerStore();
    const h = accountantHarness({ store });
    const w = await owner(h);
    const other = await owner(h);
    const user = w.p.userId;
    const capture = (organizationId: string, customerId: string) =>
      store.payments.capture({ organizationId, customerId, projectId: null, currency: 'ILS', amountMinor: 100n, receivedOn: '2026-11-05', method: 'CASH', notes: null, requestId: null, createdByUserId: user, captureSource: null, clientRequestKey: 'k'.repeat(64) }, h.now());
    const first = await capture(w.profileId, w.customerId);
    await expect(capture(w.profileId, w.customerId)).rejects.toThrow(/clientRequestKey/);
    expect((await store.payments.findByClientRequestKey(w.profileId, 'k'.repeat(64)))!.id).toBe(first.payment.id);
    await expect(capture(other.profileId, other.customerId)).resolves.toBeTruthy();
  });
});

const ISSUER = { legalName: 'Nour Design Studio', vatId: '301234567', dealerType: 'LICENSED', city: 'Haifa' };

async function invoicingOwner(h: AccountantHarness): Promise<Awaited<ReturnType<typeof owner>> & { p: Person }> {
  const w = await owner(h);
  expect((await h.app.request(`/admin/v1/users/${w.p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  expect((await h.app.request('/v1/issuer', json(ISSUER, w.on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, w.on, 'PUT'))).status).toBe(200);
  return w;
}

const received = async (h: AccountantHarness, w: { on: Record<string, string>; customerId: string }, amount = '500.00') =>
  (await read(await h.app.request('/v1/income', json({ kind: 'received', amount, currency: 'ILS', occurredOn: '2026-11-05', customerId: w.customerId }, { ...w.on, ...idem() })))) as Loose;

/**
 * Issuing from a captured Received makes the payment the document's (origin ISSUED_DOCUMENT), which the person's routes
 * already answer 404 for. MUT-660's payment-linked issuing links a document to a payment and leaves it the person's own
 * (origin CAPTURE): the case these routes must refuse. This puts the payment in that state.
 */
function linkedOnly(h: AccountantHarness, paymentId: string): void {
  const pays = (h.store as unknown as { pays: Map<string, { origin: string }> }).pays;
  pays.get(paymentId)!.origin = 'CAPTURE';
}

const receiptFor = (h: AccountantHarness, w: { on: Record<string, string>; customerId: string }, paymentId: string, docType = 'RECEIPT') =>
  h.app.request(
    '/v1/issued-documents',
    json({ docType, documentDate: '2026-11-05', currency: 'ILS', language: 'ar', customerId: w.customerId, fromEntry: { kind: 'received', id: paymentId }, lines: [{ description: 'دفعة', kind: 'SERVICE', quantity: '1', unitPrice: '500.00' }] }, { ...w.on, ...idem() }),
  );

describe('MUT-709: the money behind an issued receipt is never undone (AC2)', () => {
  it('undo (DELETE /v1/income) and reverse are refused with 409 HAS_DOCUMENT; the payment stays POSTED', async () => {
    const h = accountantHarness();
    const w = await invoicingOwner(h);
    const payment = await received(h, w);
    const receipt = await receiptFor(h, w, payment.id);
    expect(receipt.status, await receipt.clone().text()).toBe(201);
    const doc = await read(receipt);
    linkedOnly(h, payment.id);

    const undo = await h.app.request(`/v1/income/${payment.id}`, { method: 'DELETE', headers: w.on });
    expect(undo.status).toBe(409);
    expect((await read(undo)).error.details).toMatchObject({ reason: 'HAS_DOCUMENT', documentId: doc.id, docType: 'RECEIPT', number: doc.number });

    const reverse = await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'Wrong amount' }, { ...w.on, ...idem() }));
    expect(reverse.status).toBe(409);
    expect((await read(reverse)).error.details.reason).toBe('HAS_DOCUMENT');

    expect(await h.store.payments.getById(w.profileId, payment.id)).toMatchObject({ status: 'POSTED' });
  });

  it('a payment with no document still undoes and reverses as before', async () => {
    const h = accountantHarness();
    const w = await invoicingOwner(h);
    const undone = await received(h, w);
    expect((await h.app.request(`/v1/income/${undone.id}`, { method: 'DELETE', headers: w.on })).status).toBe(204);
    const reversed = await received(h, w);
    expect((await h.app.request(`/v1/payments/${reversed.id}/reverse`, json({ reason: 'Wrong amount' }, { ...w.on, ...idem() }))).status).toBe(200);
  });

  it('someone else’s payment stays a 404 on undo, never a HAS_DOCUMENT that would reveal it', async () => {
    const h = accountantHarness();
    const w = await invoicingOwner(h);
    const payment = await received(h, w);
    expect((await receiptFor(h, w, payment.id)).status).toBe(201);
    linkedOnly(h, payment.id);
    const stranger = await person(h);
    const strangerProfile = await businessOf(h, stranger, 'Elsewhere');
    expect((await h.app.request(`/v1/income/${payment.id}`, { method: 'DELETE', headers: stranger.on(strangerProfile) })).status).toBe(404);
  });
});
