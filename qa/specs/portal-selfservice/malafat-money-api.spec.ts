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
