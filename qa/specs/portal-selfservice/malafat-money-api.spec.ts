import { randomUUID } from 'node:crypto';
import { test, expect } from '../../support/qa';
import { liveState } from '../../support/selfService';
import { SCOPES } from '../../../server/src/auth/scopes';

/**
 * MUT-478: the customer statement Malafat's client ledger card reads (MAL-1425), against the live dev API
 * (support/selfservice-live.mjs). The spec plays Malafat: an organization and an integration key through the admin
 * routes, then the firm's ledger and the statement with that key. No browser screen shows it.
 */

type Json = Record<string, any>;
const minor = (amount: string) => Math.round(Number(amount) * 100);

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Json> {
  const res = await fetch(`${liveState().origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'idempotency-key': `qa-478-${randomUUID()}` }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  expect(res.ok, `${method} ${path} → ${res.status} ${text}`).toBe(true);
  return text ? (JSON.parse(text) as Json) : {};
}

test('Malafat reads a client\'s ledger card, with CHG numbers, a running balance and a reversed payment', { tag: '@portal-selfservice.malafat-money-api.statement' }, async ({ step }) => {
  const admin = { 'x-admin-token': liveState().adminToken };
  let key: Record<string, string> = {};
  let customerId = '';
  let projectId = '';
  let receivables: string[] = [];

  await step('Malafat sets up a firm with a client, a project and a two-stage fee agreed in March', async () => {
    const org = await call('POST', '/admin/v1/organizations', admin, { name: `QA firm ${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const apiKey = await call('POST', `/admin/v1/organizations/${org.id}/api-keys`, admin, { name: 'Malafat', scopes: SCOPES });
    key = { authorization: `Bearer ${apiKey.secret}` };
    await call('PUT', '/v1/settings/vat', key, { rateBasisPoints: 1800, effectiveFrom: '2025-01-01' });
    customerId = (await call('POST', '/v1/customers', key, { name: 'Haddad' })).id;
    projectId = (await call('POST', '/v1/projects', key, { customerId, name: 'Sale', currency: 'ILS' })).id;
    const body = { projectId, amount: '1500.00', pricingBasis: 'VAT_EXCLUSIVE', agreementDate: '2026-03-01', paymentTerms: 'EOM', installments: [{ label: 'Signing', amount: '1000.00', trigger: { type: 'DATE', date: '2026-03-01' } }, { label: 'Judgment', amount: '500.00', trigger: { type: 'DATE', date: '2026-03-01' } }] };
    const preview = await call('POST', '/v1/agreements/preview', key, body);
    const created = await call('POST', '/v1/agreements', key, { ...body, previewToken: preview.previewToken });
    receivables = created.installments.map((i: Json) => i.receivableId);
    expect(receivables.every(Boolean)).toBe(true);
  });

  let bouncedId = '';
  await step('Malafat credits part of the second stage, records a payment on the first, and records then reverses another', async () => {
    await call('POST', `/v1/receivables/${receivables[1]}/credits`, key, { amount: '90.00', reason: 'Goodwill', effectiveDate: '2026-05-01' });
    const pay = async (amount: string, receivedOn: string) => {
      const allocations = [{ receivableId: receivables[0], amount }];
      const preview = await call('POST', '/v1/allocations/preview', key, { customerId, currency: 'ILS', amount, allocations });
      return call('POST', '/v1/payments', key, { customerId, currency: 'ILS', amount, receivedOn, method: 'BANK', allocations, previewToken: preview.previewToken });
    };
    await pay('1000.00', '2026-05-10');
    bouncedId = (await pay('80.00', '2026-06-15')).id;
    await call('POST', `/v1/payments/${bouncedId}/reverse`, key, { reason: 'Cheque bounced' });
  });

  await step('Malafat reads the client\'s statement in ILS, then from May only', async () => {
    const whole = await call('GET', `/v1/customers/${customerId}/statement?currency=ILS`, key);
    const charges = whole.lines.filter((l: Json) => l.kind === 'CHARGE');
    expect(charges.map((l: Json) => l.number)).toEqual([expect.stringMatching(/^CHG-2026-\d{4}$/), expect.stringMatching(/^CHG-2026-\d{4}$/)]);
    expect(whole.lines.map((l: Json) => l.kind)).toEqual(['CHARGE', 'CHARGE', 'CREDIT', 'PAYMENT', 'PAYMENT', 'PAYMENT_REVERSAL']);
    let running = minor(whole.openingBalance);
    for (const l of whole.lines) {
      running += minor(l.debit) - minor(l.credit);
      expect(minor(l.runningBalance)).toBe(running);
    }
    expect(whole.lines.filter((l: Json) => l.paymentId === bouncedId).map((l: Json) => [l.kind, l.debit, l.credit])).toEqual([['PAYMENT', '0.00', '80.00'], ['PAYMENT_REVERSAL', '80.00', '0.00']]);
    const summary = await call('GET', `/v1/summaries/customers/${customerId}`, key);
    const ils = summary.currencies.find((c: Json) => c.currency === 'ILS');
    expect(minor(whole.closingBalance)).toBe(minor(ils.outstanding) - minor(ils.unallocated));

    const fromMay = await call('GET', `/v1/customers/${customerId}/statement?currency=ILS&from=2026-05-01`, key);
    expect(fromMay.openingBalance).toBe('1770.00');
    expect(minor(fromMay.openingBalance) + minor(fromMay.totals.debit) - minor(fromMay.totals.credit)).toBe(minor(fromMay.closingBalance));
    expect(fromMay.closingBalance).toBe(whole.closingBalance);
  });
});

/**
 * MUT-480: lowering a fixed fee (MAL-1424's "Lower the fee"), against the same live dev API. ₪3,540 VAT-inclusive in
 * three ₪1,180 stages; the first is billed on signing and ₪500 of it is paid.
 */
test('Malafat lowers a fixed fee past what is unbilled, and the rest becomes a credit with its reason', { tag: '@portal-selfservice.malafat-money-api.reduce' }, async ({ step }) => {
  const admin = { 'x-admin-token': liveState().adminToken };
  let key: Record<string, string> = {};
  let customerId = '';
  let agreementId = '';
  let billed = '';
  let plan: Json = {};

  await step('Malafat sets up a firm with a ₪3,540 fee in three stages; the first is billed on signing and partly paid', async () => {
    const org = await call('POST', '/admin/v1/organizations', admin, { name: `QA firm ${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const apiKey = await call('POST', `/admin/v1/organizations/${org.id}/api-keys`, admin, { name: 'Malafat', scopes: SCOPES });
    key = { authorization: `Bearer ${apiKey.secret}` };
    await call('PUT', '/v1/settings/vat', key, { rateBasisPoints: 1800, effectiveFrom: '2025-01-01' });
    customerId = (await call('POST', '/v1/customers', key, { name: 'Haddad' })).id;
    const projectId = (await call('POST', '/v1/projects', key, { customerId, name: 'Lawsuit', currency: 'ILS' })).id;
    const stage = (label: string, type: string) => ({ label, amount: '1180.00', trigger: { type } });
    const body = { projectId, amount: '3540.00', pricingBasis: 'VAT_INCLUSIVE', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments: [stage('Signing', 'IMMEDIATE'), stage('Hearing', 'MANUAL'), stage('Judgment', 'MANUAL')] };
    const preview = await call('POST', '/v1/agreements/preview', key, body);
    const created = await call('POST', '/v1/agreements', key, { ...body, previewToken: preview.previewToken });
    agreementId = created.agreement.id;
    billed = created.installments[0].receivableId;
    const allocations = [{ receivableId: billed, amount: '500.00' }];
    const paid = await call('POST', '/v1/allocations/preview', key, { customerId, currency: 'ILS', amount: '500.00', allocations });
    await call('POST', '/v1/payments', key, { customerId, currency: 'ILS', amount: '500.00', receivedOn: '2026-10-15', method: 'BANK', allocations, previewToken: paid.previewToken });
  });

  await step('Malafat previews lowering the fee by ₪3,000', async () => {
    plan = await call('POST', `/v1/agreements/${agreementId}/reduce/preview`, key, { by: '3000.00' });
    expect(plan.installments.map((i: Json) => [i.label, i.after])).toEqual([['Judgment', null], ['Hearing', null]]);
    expect(plan.credits).toEqual([expect.objectContaining({ receivableId: billed, receivableNumber: expect.stringMatching(/^CHG-\d{4}-\d{4}$/), amount: '640.00' })]);
    expect(plan.outstanding).toEqual({ before: '680.00', after: '40.00' });
    expect(plan.effectiveTotal).toEqual({ before: '3540.00', after: '540.00' });
  });

  await step('Malafat confirms it with the reason Discount', async () => {
    const done = await call('POST', `/v1/agreements/${agreementId}/reduce`, key, { by: '3000.00', reasonCode: 'DISCOUNT', note: 'Agreed at the meeting', previewToken: plan.previewToken });
    expect(done.credits).toEqual([expect.objectContaining({ amount: '640.00', reasonCode: 'DISCOUNT', reason: 'Agreed at the meeting' })]);
  });

  await step("Malafat reads the agreement and the client's statement", async () => {
    const detail = await call('GET', `/v1/agreements/${agreementId}`, key);
    expect(detail).toMatchObject({ effectiveTotal: '540.00', credited: '640.00' });
    expect(detail.installments.map((i: Json) => i.status)).toEqual([expect.not.stringMatching(/^VOID$/), 'VOID', 'VOID']);
    expect(detail.supplements).toEqual([expect.objectContaining({ distribution: 'REDUCTION', reasonCode: 'DISCOUNT', appliedGross: '3000.00', credited: '640.00' })]);
    const statement = await call('GET', `/v1/customers/${customerId}/statement?currency=ILS`, key);
    expect(statement.lines.find((l: Json) => l.kind === 'CREDIT')).toMatchObject({ credit: '640.00', reasonCode: 'DISCOUNT' });
    expect(statement.closingBalance).toBe('40.00');
  });
});

/** MUT-481: the legal receipt's number on payments (MAL-1420's field, MAL-1422's sheet), against the same live dev API. */
test("Malafat keeps the legal receipt's number on a payment, through a correction, and sets one later", { tag: '@portal-selfservice.malafat-money-api.receipt-number' }, async ({ step }) => {
  const admin = { 'x-admin-token': liveState().adminToken };
  let key: Record<string, string> = {};
  let customerId = '';
  let firstId = '';
  const pay = async (extra: Json, amount = '100.00') => {
    const preview = await call('POST', '/v1/allocations/preview', key, { customerId, currency: 'ILS', amount, allocations: [] });
    return call('POST', '/v1/payments', key, { customerId, currency: 'ILS', amount, receivedOn: '2026-10-27', method: 'BANK', reference: 'TR-9', allocations: [], previewToken: preview.previewToken, ...extra });
  };

  await step("Malafat records a client's payment with receipt 2041", async () => {
    const org = await call('POST', '/admin/v1/organizations', admin, { name: `QA firm ${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const apiKey = await call('POST', `/admin/v1/organizations/${org.id}/api-keys`, admin, { name: 'Malafat', scopes: SCOPES });
    key = { authorization: `Bearer ${apiKey.secret}` };
    customerId = (await call('POST', '/v1/customers', key, { name: 'Haddad' })).id;
    const first = await pay({ receiptNumber: '2041' });
    firstId = first.id;
    expect(first.receiptNumber).toBe('2041');
  });

  await step('Malafat finds it by its receipt number', async () => {
    await pay({ receiptNumber: '20410' });
    const found = await call('GET', '/v1/payments?receiptNumber=2041', key);
    expect(found.items.map((p: Json) => p.id)).toEqual([firstId]);
  });

  let replacementId = '';
  await step('Malafat corrects it (reverses it and records the replacement without a number)', async () => {
    await call('POST', `/v1/payments/${firstId}/reverse`, key, { reason: 'Wrong amount' });
    const replacement = await pay({ replacesPaymentId: firstId }, '90.00');
    replacementId = replacement.id;
    expect(replacement.receiptNumber).toBe('2041');
  });

  await step('Malafat records another payment without a number and sets 2050 once the receipt is issued', async () => {
    const later = await pay({}, '50.00');
    expect(later.receiptNumber).toBeNull();
    const res = await fetch(`${liveState().origin}/v1/payments/${later.id}/receipt-number`, { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': String(later.version), ...key }, body: JSON.stringify({ receiptNumber: '2050' }) });
    expect(res.status).toBe(200);
    expect((await res.json()).receiptNumber).toBe('2050');
  });

  await step("Malafat reads the client's statement", async () => {
    const statement = await call('GET', `/v1/customers/${customerId}/statement?currency=ILS`, key);
    expect(statement.lines.filter((l: Json) => l.paymentId === firstId).map((l: Json) => [l.kind, l.receiptNumber])).toEqual([['PAYMENT', '2041'], ['PAYMENT_REVERSAL', '2041']]);
    expect(statement.lines.find((l: Json) => l.paymentId === replacementId)).toMatchObject({ kind: 'PAYMENT', receiptNumber: '2041' });
  });
});
