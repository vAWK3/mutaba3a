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

test('Malafat proposes a 30/70 split and a retainer, previews each approval and approves it into exactly that agreement', { tag: '@portal-selfservice.malafat-money-api.proposal-any-schedule' }, async ({ step }) => {
  const admin = { 'x-admin-token': liveState().adminToken };
  let key: Record<string, string> = {};
  let customerId = '';
  let splitId = '';
  const split = {
    kind: 'FIXED',
    amount: '10000.00',
    pricingBasis: 'VAT_EXCLUSIVE',
    installments: [
      { label: 'On signing', percentBasisPoints: 3000, trigger: { type: 'IMMEDIATE' } },
      { label: 'On judgment', percentBasisPoints: 7000, trigger: { type: 'MANUAL' } },
    ],
  };
  const project = async (name: string) => (await call('POST', '/v1/projects', key, { customerId, name, currency: 'ILS' })).id as string;
  const approve = async (id: string, agreement: Json) => {
    const preview = await call('POST', `/v1/fee-proposals/${id}/approve/preview`, key, { agreement });
    return { preview, approved: await call('POST', `/v1/fee-proposals/${id}/approve`, key, { agreement, previewToken: preview.previewToken }) };
  };

  await step('Malafat proposes a 30/70 fee to a client, the second stage due when the judgment comes', async () => {
    const org = await call('POST', '/admin/v1/organizations', admin, { name: `QA firm ${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const apiKey = await call('POST', `/admin/v1/organizations/${org.id}/api-keys`, admin, { name: 'Malafat', scopes: SCOPES });
    key = { authorization: `Bearer ${apiKey.secret}` };
    await call('PUT', '/v1/settings/vat', key, { rateBasisPoints: 1800, effectiveFrom: '2025-01-01' });
    customerId = (await call('POST', '/v1/customers', key, { name: 'Haddad' })).id;
    const proposal = await call('POST', '/v1/fee-proposals', key, { projectId: await project('Lawsuit'), draft: split });
    splitId = proposal.id;
    expect(proposal).toMatchObject({ status: 'PROPOSED', agreementType: 'FIXED', proposedAmount: '10000.00', draft: { schemaVersion: 1, kind: 'FIXED' } });
  });

  await step("Malafat previews the approval, then approves with the preview's token", async () => {
    const { preview, approved } = await approve(splitId, split);
    expect(preview.installments.map((i: Json) => [i.amount, i.trigger.type])).toEqual([['3000.00', 'IMMEDIATE'], ['7000.00', 'MANUAL']]);
    expect(approved.proposal).toMatchObject({ status: 'APPROVED', agreedAmount: '10000.00', agreementId: approved.agreement.agreement.id });
    const [first, second] = approved.agreement.installments;
    expect(first).toMatchObject({ amount: '3000.00', receivableId: expect.any(String) });
    expect(second).toMatchObject({ amount: '7000.00', trigger: { type: 'MANUAL' }, receivableId: null, status: 'PENDING' });
  });

  const now = new Date();
  const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const retainer = { kind: 'RETAINER', monthlyAmount: '1500.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth, billingDay: 1 };
  let retainerId = '';
  await step('Malafat proposes a monthly retainer on another matter and reads the organization summary', async () => {
    retainerId = (await call('POST', '/v1/fee-proposals', key, { projectId: await project('Monthly advice'), draft: retainer })).id;
    const summary = await call('GET', '/v1/summaries/organization?currency=ILS', key);
    const block = summary.currencies[0];
    expect(block.proposed).toBe('0.00');
    expect(block.counts.openProposals).toBe(1);
    expect(block.customers[0].proposals).toEqual([expect.objectContaining({ proposalId: retainerId, amount: '1500.00', agreementType: 'RECURRING' })]);
  });

  await step("Malafat previews the retainer's approval and approves it", async () => {
    const { preview, approved } = await approve(retainerId, retainer);
    expect(approved.proposal).toMatchObject({ status: 'APPROVED', agreedAmount: '1500.00', agreementType: 'RECURRING' });
    expect(approved.agreement.agreement).toMatchObject({ type: 'RECURRING', retainer: { startMonth } });
    expect(approved.charges.map((c: Json) => c.serviceMonth)).toEqual(preview.chargesDueNow.map((c: Json) => c.serviceMonth));
    expect(approved.charges.length).toBeGreaterThan(0);
  });

  await step('Malafat approves with a preview taken before the fee changed, then approves a proposal already approved', async () => {
    const refusal = async (path: string, body: Json) => {
      const res = await fetch(`${liveState().origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `qa-479-${randomUUID()}`, ...key }, body: JSON.stringify(body) });
      return { status: res.status, reason: ((await res.json()) as Json).error?.details?.reason };
    };
    const staleId = (await call('POST', '/v1/fee-proposals', key, { projectId: await project('Appeal'), draft: split })).id as string;
    const preview = await call('POST', `/v1/fee-proposals/${staleId}/approve/preview`, key, { agreement: split });
    const edited = { ...split, amount: '12000.00' };
    expect(await refusal(`/v1/fee-proposals/${staleId}/approve`, { agreement: edited, previewToken: preview.previewToken })).toEqual({ status: 409, reason: 'PREVIEW_STALE' });
    expect((await call('GET', `/v1/fee-proposals/${staleId}`, key)).status).toBe('PROPOSED');
    expect(await refusal(`/v1/fee-proposals/${splitId}/approve`, { agreement: split, previewToken: preview.previewToken })).toEqual({ status: 409, reason: 'PROPOSAL_NOT_OPEN' });
  });
});

/** MUT-443: correcting a recorded payment in one call (MAL-1367), against the same live dev API. */
test('Malafat corrects a recorded payment in one call, from a preview, and a replay never corrects twice', { tag: '@portal-selfservice.malafat-money-api.payment-correct' }, async ({ step }) => {
  const admin = { 'x-admin-token': liveState().adminToken };
  let key: Record<string, string> = {};
  let customerId = '';
  let chargeId = '';
  let originalId = '';
  /** A request whose answer is checked by the caller (a refusal, or a replay), under the Idempotency-Key given. */
  const send = async (path: string, body: Json, idempotencyKey = `qa-443-${randomUUID()}`) => {
    const res = await fetch(`${liveState().origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey, ...key }, body: JSON.stringify(body) });
    const json = (await res.json()) as Json;
    return { status: res.status, replayed: res.headers.get('idempotent-replayed'), body: json, reason: json.error?.details?.reason as string | undefined };
  };

  await step('Malafat records a ₪1,000 payment with receipt 3001 against a ₪1,000 charge, which settles it', async () => {
    const org = await call('POST', '/admin/v1/organizations', admin, { name: `QA firm ${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const apiKey = await call('POST', `/admin/v1/organizations/${org.id}/api-keys`, admin, { name: 'Malafat', scopes: SCOPES });
    key = { authorization: `Bearer ${apiKey.secret}` };
    await call('PUT', '/v1/settings/vat', key, { rateBasisPoints: 1800, effectiveFrom: '2025-01-01' });
    customerId = (await call('POST', '/v1/customers', key, { name: 'Haddad' })).id;
    const projectId = (await call('POST', '/v1/projects', key, { customerId, name: 'Lawsuit', currency: 'ILS' })).id;
    const body = { projectId, amount: '1000.00', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments: [{ label: 'Signing', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] };
    const agreement = await call('POST', '/v1/agreements', key, { ...body, previewToken: (await call('POST', '/v1/agreements/preview', key, body)).previewToken });
    chargeId = agreement.installments[0].receivableId;
    const allocations = [{ receivableId: chargeId, amount: '1000.00' }];
    const preview = await call('POST', '/v1/allocations/preview', key, { customerId, currency: 'ILS', amount: '1000.00', allocations });
    const original = await call('POST', '/v1/payments', key, { customerId, currency: 'ILS', amount: '1000.00', receivedOn: '2026-10-20', method: 'BANK', receiptNumber: '3001', allocations, previewToken: preview.previewToken });
    originalId = original.id;
    expect(original).toMatchObject({ status: 'POSTED', receiptNumber: '3001', allocated: '1000.00' });
    expect((await call('GET', `/v1/receivables/${chargeId}`, key)).outstanding).toBe('0.00');
  });

  const correction = { amount: '600.00', receivedOn: '2026-10-27', method: 'BANK', allocations: [] as Json[] };
  let request: Json = {};
  await step('Malafat previews correcting it to ₪600 on a later date, reason ENTERED_BY_MISTAKE', async () => {
    correction.allocations = [{ receivableId: chargeId, amount: '600.00' }];
    const preview = await call('POST', `/v1/payments/${originalId}/correct/preview`, key, { ...correction, reasonCode: 'ENTERED_BY_MISTAKE' });
    expect(preview.reversal).toMatchObject({ paymentId: originalId, amount: '1000.00', receiptNumber: '3001', released: [{ receivableId: chargeId, amount: '1000.00' }] });
    expect(preview).toMatchObject({ amount: '600.00', allocated: '600.00', unallocated: '0.00', receiptNumber: '3001' });
    expect(preview.balances.receivables).toEqual([expect.objectContaining({ receivableId: chargeId, outstandingBefore: '0.00', outstandingAfter: '400.00' })]);
    request = { ...correction, reasonCode: 'ENTERED_BY_MISTAKE', previewToken: preview.previewToken };
    // AC6: had the client paid ₪700, the ₪100 not allocated would stay on the payment as credit.
    const more = await call('POST', `/v1/payments/${originalId}/correct/preview`, key, { ...correction, amount: '700.00' });
    expect(more).toMatchObject({ amount: '700.00', allocated: '600.00', unallocated: '100.00' });
  });

  const replayKey = `qa-443-${randomUUID()}`;
  let first: Json = {};
  await step('Malafat confirms the correction', async () => {
    const done = await send(`/v1/payments/${originalId}/correct`, request, replayKey);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    first = done.body;
    expect(first.reversed).toMatchObject({ id: originalId, status: 'REVERSED', reversalReason: 'ENTERED_BY_MISTAKE', reversalReasonCode: 'ENTERED_BY_MISTAKE', replacedByPaymentId: first.payment.id });
    expect(first.payment).toMatchObject({ status: 'POSTED', receiptNumber: '3001', amount: '600.00', allocated: '600.00', receivedOn: '2026-10-27', replacesPaymentId: originalId });
  });

  await step('Malafat sends the same request again with the same key', async () => {
    const again = await send(`/v1/payments/${originalId}/correct`, request, replayKey);
    expect(again.status).toBe(200);
    expect(again.replayed).toBe('true');
    expect(again.body).toEqual(first);
    const payments = await call('GET', `/v1/payments?customerId=${customerId}`, key);
    expect(payments.items.filter((p: Json) => p.replacesPaymentId === originalId)).toHaveLength(1);
  });

  await step('Malafat tries again with an old preview, on the reversed original, with OTHER and no note, and with more than is outstanding', async () => {
    const replacementId = first.payment.id as string;
    const changed = { ...correction, amount: '650.00', allocations: [{ receivableId: chargeId, amount: '650.00' }] };
    const old = await call('POST', `/v1/payments/${replacementId}/correct/preview`, key, changed);
    // The replacement moves on (its receipt number is set) after the preview was taken.
    const set = await fetch(`${liveState().origin}/v1/payments/${replacementId}/receipt-number`, { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': String(first.payment.version), ...key }, body: JSON.stringify({ receiptNumber: '3001/1' }) });
    expect(set.status).toBe(200);
    const stale = await send(`/v1/payments/${replacementId}/correct`, { ...changed, reasonCode: 'GOODWILL', previewToken: old.previewToken });
    expect([stale.status, stale.reason]).toEqual([409, 'PREVIEW_STALE']);

    const reversed = await send(`/v1/payments/${originalId}/correct`, request);
    expect([reversed.status, reversed.reason]).toEqual([409, 'PAYMENT_NOT_POSTED']);
    expect(reversed.body.error.details.replacedByPaymentId).toBe(replacementId);

    const fresh = await call('POST', `/v1/payments/${replacementId}/correct/preview`, key, changed);
    const noNote = await send(`/v1/payments/${replacementId}/correct`, { ...changed, reasonCode: 'OTHER', previewToken: fresh.previewToken });
    expect([noNote.status, noNote.reason]).toEqual([422, 'REASON_REQUIRED']);

    const tooMuch = await send(`/v1/payments/${replacementId}/correct/preview`, { ...correction, amount: '1500.00', allocations: [{ receivableId: chargeId, amount: '1500.00' }] });
    expect([tooMuch.status, tooMuch.reason]).toEqual([422, 'ALLOCATION_EXCEEDS_OUTSTANDING']);
    expect(tooMuch.body.error.details.receivableId).toBe(chargeId);

    // AC1: none of these refusals wrote anything; the replacement is as the receipt-number change left it.
    const kept = await call('GET', `/v1/payments/${replacementId}`, key);
    expect(kept).toMatchObject({ status: 'POSTED', version: first.payment.version + 1, amount: '600.00', allocated: '600.00', replacedByPaymentId: null });
    const all = await call('GET', `/v1/payments?customerId=${customerId}`, key);
    expect(all.items.map((p: Json) => p.status).sort()).toEqual(['POSTED', 'REVERSED']);
  });

  await step("Malafat reads the client's statement", async () => {
    const statement = await call('GET', `/v1/customers/${customerId}/statement?currency=ILS`, key);
    const lines = statement.lines.filter((l: Json) => l.kind !== 'CHARGE');
    // By date: the original (Oct 20), the corrected payment (Oct 27), then the reversal, dated the day it was made (ADR-225).
    expect(lines.map((l: Json) => [l.kind, l.paymentId])).toEqual([['PAYMENT', originalId], ['PAYMENT', first.payment.id], ['PAYMENT_REVERSAL', originalId]]);
    expect(lines[2]).toMatchObject({ reason: 'ENTERED_BY_MISTAKE', reasonCode: 'ENTERED_BY_MISTAKE', receiptNumber: '3001' });
    expect(statement.closingBalance).toBe('400.00');
  });
});

/**
 * MUT-444 (ADR-226): correcting an agreement's terms after posting (MAL-1368), against the same live dev API. A ₪1,000
 * VAT-inclusive fee at 18 %, split 50/50 "On signing" (billed at once) and "On judgment" (manual); ₪300 paid on the
 * signing charge. Every refusal is its own step, and none of them writes anything.
 */
test("Malafat corrects a billed and paid fee's amount, VAT basis and treatment in one call, and a replay never corrects twice", { tag: '@portal-selfservice.malafat-money-api.agreement-correct' }, async ({ step }) => {
  const admin = { 'x-admin-token': liveState().adminToken };
  let key: Record<string, string> = {};
  let customerId = '';
  let projectId = '';
  let agreementId = '';
  let signingCharge = '';
  let originalDate = '';
  let paymentId = '';
  const send = async (path: string, body: Json, idempotencyKey = `qa-444-${randomUUID()}`) => {
    const res = await fetch(`${liveState().origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey, ...key }, body: JSON.stringify(body) });
    const json = (await res.json()) as Json;
    return { status: res.status, replayed: res.headers.get('idempotent-replayed'), body: json, reason: json.error?.details?.reason as string | undefined };
  };
  const halves = (amount: string, signing = 'IMMEDIATE') => [
    { label: 'On signing', amount, trigger: { type: signing } },
    { label: 'On judgment', amount, trigger: { type: 'MANUAL' } },
  ];
  const balance = async () => {
    const ils = (await call('GET', `/v1/summaries/customers/${customerId}`, key)).currencies.find((c: Json) => c.currency === 'ILS');
    return { outstanding: ils.outstanding as string, unallocated: ils.unallocated as string, balance: minor(ils.outstanding) - minor(ils.unallocated) };
  };
  const version = async () => (await call('GET', `/v1/agreements/${agreementId}`, key)).agreement.version as number;
  const fee = async (body: Json) => {
    const preview = await call('POST', '/v1/agreements/preview', key, body);
    return call('POST', '/v1/agreements', key, { ...body, previewToken: preview.previewToken });
  };

  await step('Malafat sets up a client, a project and a ₪1,000 VAT-inclusive fee split 50/50, and records ₪300 on the signing charge', async () => {
    const org = await call('POST', '/admin/v1/organizations', admin, { name: `QA firm ${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const apiKey = await call('POST', `/admin/v1/organizations/${org.id}/api-keys`, admin, { name: 'Malafat', scopes: SCOPES });
    key = { authorization: `Bearer ${apiKey.secret}` };
    await call('PUT', '/v1/settings/vat', key, { rateBasisPoints: 1800, effectiveFrom: '2025-01-01' });
    customerId = (await call('POST', '/v1/customers', key, { name: 'Haddad' })).id;
    projectId = (await call('POST', '/v1/projects', key, { customerId, name: 'Lawsuit', currency: 'ILS' })).id;
    const created = await fee({ projectId, amount: '1000.00', pricingBasis: 'VAT_INCLUSIVE', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments: halves('500.00') });
    agreementId = created.agreement.id;
    signingCharge = created.installments[0].receivableId;
    originalDate = (await call('GET', `/v1/receivables/${signingCharge}`, key)).postingDate;
    const allocations = [{ receivableId: signingCharge, amount: '300.00' }];
    const preview = await call('POST', '/v1/allocations/preview', key, { customerId, currency: 'ILS', amount: '300.00', allocations });
    paymentId = (await call('POST', '/v1/payments', key, { customerId, currency: 'ILS', amount: '300.00', receivedOn: originalDate, method: 'BANK', allocations, previewToken: preview.previewToken })).id;
    expect(await balance()).toMatchObject({ outstanding: '200.00', unallocated: '0.00' });
  });

  const exclusive = { amount: '1000.00', pricingBasis: 'VAT_EXCLUSIVE', installments: halves('500.00') };
  let request: Json = {};
  await step('Malafat previews correcting the fee to ₪1,000 VAT-exclusive, reason ENTERED_BY_MISTAKE', async () => {
    const plan = await call('POST', `/v1/agreements/${agreementId}/correct/preview`, key, { ...exclusive, reasonCode: 'ENTERED_BY_MISTAKE' });
    expect(plan.installments[0].before).toMatchObject({ gross: '500.00', net: '423.73', vat: '76.27', receivableId: signingCharge, postingDate: originalDate });
    expect(plan.installments[0].after).toMatchObject({ gross: '590.00', net: '500.00', vat: '90.00', postingDate: originalDate });
    expect(plan.installments[1].after).toMatchObject({ gross: '590.00', postingDate: null });
    expect(plan.credits).toEqual([expect.objectContaining({ receivableId: signingCharge, amount: '500.00', effectiveDate: originalDate })]);
    expect(plan.allocations).toEqual([expect.objectContaining({ paymentId, released: [expect.objectContaining({ receivableId: signingCharge, amount: '300.00' })], placed: [expect.objectContaining({ amount: '300.00' })], unallocated: '0.00' })]);
    expect(plan.customer).toEqual({ outstanding: { before: '200.00', after: '290.00' }, unallocated: { before: '0.00', after: '0.00' }, balance: { before: '200.00', after: '290.00' } });
    expect(plan.balanceChange).toBe('90.00');
    request = { ...exclusive, reasonCode: 'ENTERED_BY_MISTAKE', previewToken: plan.previewToken };
  });

  const replayKey = `qa-444-${randomUUID()}`;
  let first: Json = {};
  await step('Malafat confirms with the token (AC1, AC2)', async () => {
    const before = await balance();
    const done = await send(`/v1/agreements/${agreementId}/correct`, request, replayKey);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    first = done.body;
    expect(first.installments.slice(0, 2).map((i: Json) => i.status)).toEqual(['VOID', 'VOID']);
    expect(first.credits).toEqual([expect.objectContaining({ receivableId: signingCharge, amount: '500.00', reasonCode: 'ENTERED_BY_MISTAKE', effectiveDate: originalDate })]);
    expect(await call('GET', `/v1/receivables/${signingCharge}`, key)).toMatchObject({ paid: '0.00', credited: '500.00', outstanding: '0.00' });
    expect(first.receivables).toEqual([expect.objectContaining({ gross: '590.00', paid: '300.00', postingDate: originalDate, number: expect.stringMatching(/^CHG-\d{4}-\d{4}$/) })]);
    const payment = await call('GET', `/v1/payments/${paymentId}`, key);
    expect(payment).toMatchObject({ allocated: '300.00', unallocated: '0.00' });
    expect(payment.allocations.map((a: Json) => a.receivableId)).toEqual([first.receivables[0].id]);
    expect((await balance()).balance - before.balance).toBe(9_000);
  });

  await step('Malafat sends the same request again with the same key (AC3)', async () => {
    const again = await send(`/v1/agreements/${agreementId}/correct`, request, replayKey);
    expect(again.status).toBe(200);
    expect(again.replayed).toBe('true');
    expect(again.body).toEqual(first);
    const detail = await call('GET', `/v1/agreements/${agreementId}`, key);
    expect(detail.supplements.filter((s: Json) => s.distribution === 'CORRECTION')).toHaveLength(1);
    expect((await call('GET', `/v1/receivables/${signingCharge}/credits`, key)).credits).toHaveLength(1);
  });

  const correctTo = async (body: Json) => {
    const plan = await call('POST', `/v1/agreements/${agreementId}/correct/preview`, key, body);
    const done = await send(`/v1/agreements/${agreementId}/correct`, { ...body, reasonCode: 'ENTERED_BY_MISTAKE', previewToken: plan.previewToken });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return { plan, done: done.body };
  };
  const inclusive200 = { amount: '200.00', pricingBasis: 'VAT_INCLUSIVE', installments: halves('100.00') };
  await step('Malafat corrects the fee again, to ₪200 VAT-inclusive: the excess stays unallocated (AC2)', async () => {
    const { plan, done } = await correctTo(inclusive200);
    expect(plan.customer).toEqual({ outstanding: { before: '290.00', after: '0.00' }, unallocated: { before: '0.00', after: '200.00' }, balance: { before: '290.00', after: '-200.00' } });
    expect(plan.balanceChange).toBe('-490.00');
    expect(done.receivables).toEqual([expect.objectContaining({ gross: '100.00', paid: '100.00' })]);
    expect(done.unallocated).toEqual([{ paymentId, amount: '200.00' }]);
    expect(await call('GET', `/v1/payments/${paymentId}`, key)).toMatchObject({ amount: '300.00', allocated: '100.00', unallocated: '200.00' });
  });

  await step('Malafat corrects the VAT treatment from STANDARD_RATED to EXEMPT, same ₪200 VAT-inclusive', async () => {
    const before = await balance();
    const { plan, done } = await correctTo({ ...inclusive200, vatTreatment: 'EXEMPT' });
    expect(plan.terms.before.vatTreatment).toBe('STANDARD_RATED');
    expect(plan.terms.after).toMatchObject({ vatTreatment: 'EXEMPT', net: '200.00', vat: '0.00', gross: '200.00' });
    expect(plan.balanceChange).toBe('0.00');
    expect(done.receivables).toEqual([expect.objectContaining({ net: '100.00', vat: '0.00', gross: '100.00', paid: '100.00', postingDate: originalDate })]);
    expect((await balance()).balance).toBe(before.balance);
    const payment = await call('GET', `/v1/payments/${paymentId}`, key);
    expect(payment.allocations.map((a: Json) => [a.receivableId, a.amount])).toEqual([[done.receivables[0].id, '100.00']]);
  });

  let judgmentCharge = '';
  await step('Malafat bills "On judgment", previews a correction, records ₪100 on that charge, then confirms with the old token: 409 PREVIEW_STALE (AC3)', async () => {
    const lines = (await call('GET', `/v1/agreements/${agreementId}`, key)).installments.filter((i: Json) => i.status !== 'VOID');
    judgmentCharge = (await call('POST', `/v1/installments/${lines[1].id}/trigger`, key, {})).receivable.id;
    const body = { ...inclusive200, vatTreatment: 'EXEMPT', amount: '300.00', installments: halves('150.00') };
    const plan = await call('POST', `/v1/agreements/${agreementId}/correct/preview`, key, body);
    const allocations = [{ receivableId: judgmentCharge, amount: '100.00' }];
    const preview = await call('POST', '/v1/allocations/preview', key, { customerId, currency: 'ILS', amount: '100.00', allocations });
    await call('POST', '/v1/payments', key, { customerId, currency: 'ILS', amount: '100.00', receivedOn: originalDate, method: 'BANK', allocations, previewToken: preview.previewToken });
    const kept = await version();
    const stale = await send(`/v1/agreements/${agreementId}/correct`, { ...body, reasonCode: 'ENTERED_BY_MISTAKE', previewToken: plan.previewToken });
    expect([stale.status, stale.reason]).toEqual([409, 'PREVIEW_STALE']);
    expect(await version()).toBe(kept);
  });

  const exempt200 = { ...inclusive200, vatTreatment: 'EXEMPT' };
  await step('Malafat confirms with OTHER and no note: 422 REASON_REQUIRED', async () => {
    const kept = await version();
    const plan = await call('POST', `/v1/agreements/${agreementId}/correct/preview`, key, { ...exempt200, amount: '300.00', installments: halves('150.00') });
    const res = await send(`/v1/agreements/${agreementId}/correct`, { ...exempt200, amount: '300.00', installments: halves('150.00'), reasonCode: 'OTHER', previewToken: plan.previewToken });
    expect([res.status, res.reason]).toEqual([422, 'REASON_REQUIRED']);
    expect(await version()).toBe(kept);
  });

  await step('Malafat sends the same terms again: 422 NOTHING_TO_CORRECT', async () => {
    const res = await send(`/v1/agreements/${agreementId}/correct/preview`, exempt200);
    expect([res.status, res.reason]).toEqual([422, 'NOTHING_TO_CORRECT']);
  });

  await step('Malafat changes "On signing" to MANUAL: 422 POSTED_INSTALLMENT_CHANGED (D2)', async () => {
    const kept = await version();
    const res = await send(`/v1/agreements/${agreementId}/correct/preview`, { ...exempt200, installments: halves('100.00', 'MANUAL') });
    expect([res.status, res.reason]).toEqual([422, 'POSTED_INSTALLMENT_CHANGED']);
    expect(res.body.error.details).toMatchObject({ position: 1, change: 'TRIGGER' });
    expect(await version()).toBe(kept);
  });

  await step('Malafat tries to correct a cancelled agreement: 409 AGREEMENT_CANCELLED (AC4)', async () => {
    const later = await fee({ projectId, amount: '400.00', pricingBasis: 'VAT_INCLUSIVE', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments: [{ label: 'Later', amount: '400.00', trigger: { type: 'MANUAL' } }] });
    await call('POST', `/v1/agreements/${later.agreement.id}/cancel`, key, {});
    const res = await send(`/v1/agreements/${later.agreement.id}/correct/preview`, { amount: '300.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'Later', amount: '300.00', trigger: { type: 'MANUAL' } }] });
    expect([res.status, res.reason]).toEqual([409, 'AGREEMENT_CANCELLED']);
  });

  await step('Malafat tries to correct a contingency agreement whose outcome is recorded: 409 OUTCOME_ALREADY_RECORDED (AC4)', async () => {
    const contingency = await fee({ projectId, amount: '500.00', pricingBasis: 'VAT_INCLUSIVE', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments: [{ label: 'Upfront', amount: '500.00', trigger: { type: 'MANUAL' } }], contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' } });
    const outcome = { outcome: 'NO_RECOVERY', outcomeDate: '2026-10-01' };
    const preview = await call('POST', `/v1/agreements/${contingency.agreement.id}/outcome/preview`, key, outcome);
    await call('POST', `/v1/agreements/${contingency.agreement.id}/outcome`, key, { ...outcome, previewToken: preview.previewToken });
    const res = await send(`/v1/agreements/${contingency.agreement.id}/correct/preview`, { amount: '400.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'Upfront', amount: '400.00', trigger: { type: 'MANUAL' } }] });
    expect([res.status, res.reason]).toEqual([409, 'OUTCOME_ALREADY_RECORDED']);
  });

  await step('Malafat tries to correct a retainer: 422 NOT_FIXED (AC4)', async () => {
    const body = { projectId, monthlyAmount: '1000.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2027-01', billingDay: 1 };
    const preview = await call('POST', '/v1/retainers/preview', key, body);
    const retainer = await call('POST', '/v1/retainers', key, { ...body, previewToken: preview.previewToken });
    const res = await send(`/v1/agreements/${retainer.agreement.id}/correct/preview`, exclusive);
    expect([res.status, res.reason]).toEqual([422, 'NOT_FIXED']);
  });

  await step("Malafat reads the old charge's credit, the client's statement, the payment, the audit log and the contract version (AC5, AC6)", async () => {
    expect((await call('GET', `/v1/receivables/${signingCharge}/credits`, key)).credits).toEqual([expect.objectContaining({ amount: '500.00', reasonCode: 'ENTERED_BY_MISTAKE', effectiveDate: originalDate })]);
    const statement = await call('GET', `/v1/customers/${customerId}/statement?currency=ILS`, key);
    // On the original date: each charge, its credit, then its repost (three generations of the signing line).
    const signingLines = statement.lines.filter((l: Json) => l.date === originalDate && (l.kind === 'CHARGE' || l.kind === 'CREDIT') && (l.kind === 'CREDIT' || l.origin?.position === 1));
    expect(signingLines.map((l: Json) => l.kind)).toEqual(['CHARGE', 'CREDIT', 'CHARGE', 'CREDIT', 'CHARGE', 'CREDIT', 'CHARGE']);
    expect(statement.lines.some((l: Json) => l.kind === 'CHARGE' && l.receivableId === judgmentCharge)).toBe(true);
    expect(statement.closingBalance).toBe('-200.00');
    const matter = await call('GET', `/v1/summaries/projects/${projectId}`, key);
    expect(matter.posted).toBe('200.00');
    expect(await call('GET', `/v1/payments/${paymentId}`, key)).toMatchObject({ allocated: '100.00', unallocated: '200.00' });
    const audit = (await call('GET', `/v1/audit?entityType=agreement&entityId=${agreementId}`, key)).items.filter((e: Json) => e.action === 'agreement.corrected');
    expect(audit).toHaveLength(3);
    expect(audit.map((e: Json) => [e.metadata.before.pricingBasis, e.metadata.after.pricingBasis]).sort()).toEqual([['VAT_EXCLUSIVE', 'VAT_INCLUSIVE'], ['VAT_INCLUSIVE', 'VAT_EXCLUSIVE'], ['VAT_INCLUSIVE', 'VAT_INCLUSIVE']]);
    const doc = await call('GET', '/openapi.json', {});
    expect(doc.info.version).toBe('1.89.0-mut444');
  });
});
