import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { OFFICE_A, customer, office } from '../../support/portal';
import { FakeApi, apiError, customerSummary, receivable, todayInJerusalem } from '../../support/portalApi';

/**
 * Income on an owned hosted profile (MUT-133): Add income (Received or Owed)
 * and Record payment on an open Owed entry. The in-memory API
 * (qa/support/portalApi.ts) records each POST, so the body and the
 * Idempotency-Key the portal sent are asserted, not just the screen.
 */

const C1 = customer(0).id;
const C2 = customer(1).id;

async function pickClient(page: Page, label: string | RegExp, name: string) {
  const field = page.getByRole('dialog').getByLabel(label);
  await field.fill(name);
  await page.getByRole('dialog').getByRole('listbox').getByRole('option', { name, exact: true }).click();
  await expect(field).toHaveValue(name);
}

test('Add income, Received: amount, client and method go to the server, and the payment is listed', { tag: '@portal.income.add-received' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 2 });
  const drawer = page.getByRole('dialog', { name: 'New income' });

  await step('Open Payments and choose + Add income', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await expect(page.getByRole('heading', { name: 'No payments recorded on this profile yet' })).toBeVisible();
    await page.locator('[data-income-add]').click();
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/newIncome=received/);
    await expect(drawer.getByRole('radio', { name: 'Received' })).toHaveAttribute('aria-checked', 'true');
    await expect(drawer.getByTestId('income-defaults')).toHaveText('ILS · today · cash');
  });

  await step('Type 1,200, pick Client 1, and choose Bank transfer under More details', async () => {
    await drawer.getByLabel('Amount').fill('1,200');
    await pickClient(page, 'Client (optional)', 'Client 1');
    await drawer.getByRole('button', { name: /More details/ }).click();
    await drawer.getByRole('radio', { name: 'Bank transfer' }).click();
    await expect(drawer.getByLabel('Date')).toHaveValue(todayInJerusalem());
  });

  await step('Save income', async () => {
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByTestId('toast-live')).toHaveText(/Saved · .*1,200\.00.* received from .*Client 1/);
  });

  await step('The server got the canonical amount, the client and the method, with an Idempotency-Key', async () => {
    const post = api.last('POST', /^\/v1\/income$/);
    expect(post?.body).toEqual({ kind: 'received', amount: '1200.00', currency: 'ILS', occurredOn: todayInJerusalem(), customerId: C1, method: 'BANK' });
    expect(post?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(post?.headers['x-mutaba3a-profile']).toBe(OFFICE_A);
  });

  await step('The payment is on the list, and focus is back on + Add income', async () => {
    const row = page.getByRole('table', { name: 'Payments' }).getByRole('row', { name: /Client 1/ });
    await expect(row).toContainText('1,200.00');
    await expect(row).toContainText('Bank transfer');
    await expect(page.locator('[data-income-add]')).toBeFocused();
  });
});

test('Add income dated more than ten years back is refused at the date field, not as a future date (MUT-227)', { tag: '@portal.income.date-too-old' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 2 });
  const drawer = page.getByRole('dialog', { name: 'New income' });

  await step('Open Payments and choose + Add income', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await page.locator('[data-income-add]').click();
    await expect(drawer).toBeVisible();
  });

  await step('Type 1,200, pick Client 1, and set the date to 2001-03-04 under More details', async () => {
    await drawer.getByLabel('Amount').fill('1,200');
    await pickClient(page, 'Client (optional)', 'Client 1');
    await drawer.getByRole('button', { name: /More details/ }).click();
    await drawer.getByLabel('Date').fill('2001-03-04');
  });

  await step('Save income; the server refuses the date as more than ten years ago', async () => {
    api.once('POST', /^\/v1\/income$/, apiError(422, 'VALIDATION_FAILED', { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' }));
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer.getByText("The date can't be more than ten years ago")).toBeVisible();
    await expect(drawer.getByText("The date can't be later than today")).toHaveCount(0);
    expect(api.last('POST', /^\/v1\/income$/)?.body).toMatchObject({ occurredOn: '2001-03-04' });
  });

  await step('The drawer stays open with the entry as typed', async () => {
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('Amount')).toHaveValue('1,200');
    await expect(drawer.getByLabel('Date')).toHaveValue('2001-03-04');
  });
});

test('Add income, Owed: what is missing is said at the field, a refusal or a dropped connection keeps the entry, and a retry never writes twice', { tag: '@portal.income.owed-errors' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 2 });
  const drawer = page.getByRole('dialog', { name: 'New income' });

  await step('Open Receivables and choose + Add income: Owed is chosen', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await page.locator('[data-income-add]').click();
    await expect(drawer.getByRole('radio', { name: 'Owed' })).toHaveAttribute('aria-checked', 'true');
    await expect(drawer.getByTestId('income-defaults')).toHaveText('ILS · today · due the 15th of next month');
  });

  await step('Save with nothing filled in', async () => {
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer.getByText('Enter an amount')).toBeVisible();
    await expect(drawer.getByText('Owed needs a client')).toBeVisible();
    expect(api.calls('POST', /^\/v1\/income$/)).toHaveLength(0);
  });

  await step('Type $50 on an ILS entry', async () => {
    await drawer.getByLabel('Amount').fill('$50');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer.getByText('That amount is in USD; this entry is in ILS')).toBeVisible();
  });

  await step('Fix it: 750 for Client 1, for a brand audit; the server says that client is not on this profile', async () => {
    await drawer.getByLabel('Amount').fill('750');
    await pickClient(page, 'Client', 'Client 1');
    await drawer.getByLabel('What was it for?').fill('Brand audit');
    api.once('POST', /^\/v1\/income$/, apiError(422, 'VALIDATION_FAILED', { reason: 'CUSTOMER_NOT_FOUND', field: 'customerId' }));
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer.getByText("This client isn't on this profile")).toBeVisible();
    await expect(drawer).toBeVisible();
  });

  await step('Pick Client 2 instead; the connection drops on Save', async () => {
    await pickClient(page, 'Client', 'Client 2');
    api.once('POST', /^\/v1\/income$/, 'abort');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(page.getByRole('alert')).toContainText("Couldn't reach the server. Try again.");
    await expect(drawer.getByLabel('Amount')).toHaveValue('750');
  });

  await step('Save again: it lands once, under the same Idempotency-Key as the dropped try', async () => {
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByTestId('toast-live')).toHaveText(/Saved · .*750\.00.* owed by .*Client 2/);
    const [refused, dropped, saved] = api.calls('POST', /^\/v1\/income$/);
    expect(saved.body).toEqual({ kind: 'owed', amount: '750.00', currency: 'ILS', occurredOn: todayInJerusalem(), customerId: C2, title: 'Brand audit' });
    expect(saved.headers['idempotency-key']).toBe(dropped.headers['idempotency-key']);
    expect(saved.headers['idempotency-key']).not.toBe(refused.headers['idempotency-key']);
  });

  await step('The new entry is open on Receivables, ready to take a payment', async () => {
    const row = page.getByRole('table', { name: 'Receivables' }).getByRole('row', { name: /Client 2/ });
    await expect(row).toContainText('750.00');
    await expect(row.getByRole('button', { name: /^Record payment for Client 2/ })).toBeVisible();
  });
});

test('Record payment on an open Owed entry: the drawer says what the amount leaves, and the entry shows what is still owed', { tag: '@portal.income.record-payment' }, async ({ page, step }) => {
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 2,
    receivables: [receivable(1, { customerId: C1, gross: '500.00', dueDate: '2026-10-30' }), receivable(2, { customerId: C2, gross: '900.00', origin: 'INSTALLMENT' })],
  });
  const table = page.getByRole('table', { name: 'Receivables' });
  const drawer = page.getByRole('dialog', { name: /Record payment · .*500\.00.* left/ });
  const amount = drawer.getByLabel('Amount (ILS)');
  const record = drawer.getByRole('button', { name: 'Record payment' });

  await step('Open Receivables: only the entry captured here offers Record payment', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await expect(table.getByRole('row', { name: /Client 1/ }).getByRole('button', { name: /^Record payment for Client 1, remaining: .*500\.00/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Client 2/ }).getByRole('button')).toHaveCount(0);
  });

  await step('Choose Record payment for Client 1: the whole 500 is offered', async () => {
    await table.getByRole('button', { name: /^Record payment for Client 1/ }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Client 1 · — · due Oct 30, 2026');
    await expect(amount).toHaveValue('500.00');
    await expect(drawer.getByRole('status')).toHaveText('Paid in full');
    await expect(drawer.getByLabel('Paid on')).toHaveValue(todayInJerusalem());
  });

  await step('Type 700: more than is left, so it cannot be recorded', async () => {
    await amount.fill('700');
    await expect(drawer.getByRole('status')).toHaveText(/Exceeds what's left \(.*500\.00.*\)/);
    await expect(record).toBeDisabled();
  });

  await step('Type 200 by bank transfer; the server says less is left now', async () => {
    await amount.fill('200');
    await expect(drawer.getByRole('status')).toHaveText(/300\.00.* still owed/);
    await drawer.getByRole('radio', { name: 'Bank transfer' }).click();
    api.once('POST', /\/settle$/, apiError(422, 'VALIDATION_FAILED', { reason: 'ALLOCATION_EXCEEDS_OUTSTANDING', outstanding: '150.00' }));
    await record.click();
    await expect(drawer.getByText(/That's more than what's left now \(.*150\.00.*\)/)).toBeVisible();
    await expect(amount).toHaveValue('200');
  });

  await step('Record it again', async () => {
    await record.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('toast-live')).toHaveText(/Payment recorded · .*200\.00.* from .*Client 1/);
    const settle = api.last('POST', /\/settle$/);
    expect(settle?.path).toBe(`/v1/receivables/${receivable(1, { customerId: C1, gross: '0' }).id}/settle`);
    expect(settle?.body).toEqual({ amount: '200.00', paidAt: todayInJerusalem(), method: 'BANK' });
    expect(settle?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  await step('The entry is partly paid with 300 outstanding, and still offers Record payment', async () => {
    const row = table.getByRole('row', { name: /Client 1/ });
    await expect(row).toContainText('Partly paid');
    await expect(row.getByRole('button', { name: /^Record payment for Client 1, remaining: .*300\.00/ })).toBeVisible();
  });
});

test('Add income from a client’s page starts as Owed with that client filled in', { tag: '@portal.income.from-client' }, async ({ page, step }) => {
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 2,
    customerSummaries: [customerSummary(C2, { currency: 'ILS', outstanding: '0.00', overdue: '0.00', status: 'UP_TO_DATE', matters: [] })],
  });
  const drawer = page.getByRole('dialog', { name: 'New income' });

  await step('Open Client 2 and choose + Add income', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients/${C2}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Client 2' })).toBeVisible();
    await page.locator('[data-income-add]').click();
    await expect(drawer.getByRole('radio', { name: 'Owed' })).toHaveAttribute('aria-checked', 'true');
    await expect(drawer.getByLabel('Client', { exact: true })).toHaveValue('Client 2');
  });

  await step('Type 300 and save', async () => {
    await drawer.getByLabel('Amount').fill('300');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toHaveCount(0);
    expect(api.last('POST', /^\/v1\/income$/)?.body).toMatchObject({ kind: 'owed', amount: '300.00', customerId: C2 });
  });

  await step('It is on the client’s Receivables tab', async () => {
    await page.getByRole('tab', { name: 'Receivables' }).click();
    await expect(page.getByRole('table', { name: 'Receivables' })).toContainText('300.00');
  });
});
