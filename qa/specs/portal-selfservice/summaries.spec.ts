import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { liveState } from '../../support/selfService';

/**
 * MUT-482: the oldest overdue due date per client, read the way Malafat reads it — an API key on the live dev API
 * (support/selfservice-live.mjs), no portal screen. Dates are counted back from the summary's own asOf, so the flow
 * holds whatever day it runs.
 */

/** A calendar date `days` after `iso` (negative goes back). */
const daysAfter = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

interface Firm {
  auth: Record<string, string>;
  customerId: string;
  projectId: string;
}

async function firmWithKey(request: APIRequestContext): Promise<Firm> {
  const { origin, adminToken } = liveState();
  const admin = { 'x-admin-token': adminToken };
  const org = await request.post(`${origin}/admin/v1/organizations`, { headers: admin, data: { name: `QA Summaries ${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' } });
  expect(org.status(), await org.text()).toBe(201);
  const orgId = ((await org.json()) as { id: string }).id;
  const key = await request.post(`${origin}/admin/v1/organizations/${orgId}/api-keys`, { headers: admin, data: { name: 'Malafat', scopes: ['customers:write', 'projects:write', 'agreements:read', 'agreements:write', 'payments:read', 'payments:write', 'summaries:read'] } });
  expect(key.status(), await key.text()).toBe(201);
  const auth = { authorization: `Bearer ${((await key.json()) as { secret: string }).secret}` };
  const write = { ...auth, 'idempotency-key': `qa-summaries-${randomUUID()}` };
  const vat = await request.put(`${origin}/v1/settings/vat`, { headers: auth, data: { rateBasisPoints: 1800, effectiveFrom: '2025-01-01' } });
  expect(vat.ok(), await vat.text()).toBe(true);
  const customer = (await (await request.post(`${origin}/v1/customers`, { headers: write, data: { name: 'Haddad' } })).json()) as { id: string };
  const project = (await (await request.post(`${origin}/v1/projects`, { headers: { ...auth, 'idempotency-key': `qa-summaries-${randomUUID()}` }, data: { customerId: customer.id, name: 'Property sale', currency: 'ILS' } })).json()) as { id: string };
  return { auth, customerId: customer.id, projectId: project.id };
}

test('A client’s oldest overdue due date and its days, moving on when that receivable is paid in full', { tag: '@portal-selfservice.summaries.overdue-since' }, async ({ page, step }) => {
  const { origin } = liveState();
  const request = page.request;
  let firm!: Firm;
  let asOf = '';
  const org = async () => (await (await request.get(`${origin}/v1/summaries/organization`, { headers: firm.auth })).json()) as { asOf: string; currencies: Array<{ currency: string; customers: Array<Record<string, unknown>> }> };
  const row = async () => (await org()).currencies.find((c) => c.currency === 'ILS')!.customers.find((c) => c.customerId === firm.customerId)!;

  await step('Create a firm with an API key, and a client owed 1000 ILS due 148 days ago and 500 ILS due 56 days ago', async () => {
    firm = await firmWithKey(request);
    asOf = (await org()).asOf;
    const body = {
      projectId: firm.projectId,
      amount: '1500.00',
      pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'EXEMPT',
      agreementDate: daysAfter(asOf, -150),
      paymentTerms: 'EOM',
      installments: [
        { label: 'First', amount: '1000.00', trigger: { type: 'IMMEDIATE' }, dueDate: daysAfter(asOf, -148) },
        { label: 'Second', amount: '500.00', trigger: { type: 'IMMEDIATE' }, dueDate: daysAfter(asOf, -56) },
      ],
    };
    const preview = await request.post(`${origin}/v1/agreements/preview`, { headers: firm.auth, data: body });
    expect(preview.status(), await preview.text()).toBe(200);
    const created = await request.post(`${origin}/v1/agreements`, { headers: { ...firm.auth, 'idempotency-key': `qa-summaries-${randomUUID()}` }, data: { ...body, previewToken: ((await preview.json()) as { previewToken: string }).previewToken } });
    expect(created.status(), await created.text()).toBe(201);
  });

  await step('Read the organization summary', async () => {
    expect(await row()).toMatchObject({ overdue: '1500.00', status: 'OVERDUE', oldestOverdueDueDate: daysAfter(asOf, -148), daysOverdue: 148 });
  });

  await step('Pay the older one in full', async () => {
    const receivables = (await (await request.get(`${origin}/v1/receivables?projectId=${firm.projectId}`, { headers: firm.auth })).json()) as { items: Array<{ id: string; dueDate: string }> };
    const older = receivables.items.find((r) => r.dueDate === daysAfter(asOf, -148))!;
    const allocations = [{ receivableId: older.id, amount: '1000.00' }];
    const preview = await request.post(`${origin}/v1/allocations/preview`, { headers: firm.auth, data: { customerId: firm.customerId, currency: 'ILS', amount: '1000.00', allocations } });
    expect(preview.status(), await preview.text()).toBe(200);
    const paid = await request.post(`${origin}/v1/payments`, {
      headers: { ...firm.auth, 'idempotency-key': `qa-summaries-${randomUUID()}` },
      data: { customerId: firm.customerId, currency: 'ILS', amount: '1000.00', receivedOn: asOf, method: 'BANK', allocations, previewToken: ((await preview.json()) as { previewToken: string }).previewToken },
    });
    expect(paid.status(), await paid.text()).toBe(201);
  });

  await step('Read the organization summary and the client’s summary again', async () => {
    const since = { oldestOverdueDueDate: daysAfter(asOf, -56), daysOverdue: 56 };
    expect(await row()).toMatchObject({ overdue: '500.00', ...since });
    const customer = (await (await request.get(`${origin}/v1/summaries/customers/${firm.customerId}`, { headers: firm.auth })).json()) as { currencies: Array<Record<string, unknown>> };
    expect(customer.currencies.find((c) => c.currency === 'ILS')).toMatchObject({ overdue: '500.00', ...since });
  });
});
