import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { FIRM, OFFICE_A, customer, malafatFirm, office } from '../../support/portal';
import { FakeApi, allocation, apiError, customerSummary, payment, receivable, todayInJerusalem } from '../../support/portalApi';

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

// ---------------------------------------------------------------- MUT-224: changing a date

const owedEntry = () => receivable(31, { customerId: C1, gross: '500.00', dueDate: '2026-11-15', postingDate: '2026-10-08' });
const receivedEntry = () => payment(41, { customerId: C1, amount: '300.00', receivedOn: '2026-10-08', mine: true });
const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

test('An Owed entry’s date is changed from Receivables; the Date column shows it and its due date stays', { tag: '@portal.income.redate-owed' }, async ({ page, step }) => {
  const owed = owedEntry();
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, receivables: [owed] });
  const drawer = page.getByRole('dialog', { name: 'Change the date' });
  const row = () => page.getByRole('table', { name: 'Receivables' }).getByRole('row', { name: /Client 1/ });

  await step('Open Receivables and open the Owed entry from its row', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await expect(row()).toContainText('Oct 8, 2026');
    await row().locator('button.row-link').click();
    await expect(page).toHaveURL(new RegExp(`income=${owed.id}`));
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Due Nov 15, 2026 — stays as it is')).toBeVisible();
    await expect(drawer.getByLabel('Date')).toHaveValue('2026-10-08');
    await expect(drawer.getByLabel('Amount')).toHaveCount(0);
  });

  await step('Pick a date last month and save', async () => {
    await drawer.getByLabel('Date').fill('2026-09-20');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).not.toHaveURL(/income=/);
  });

  await step('The server got the date with If-Match, and the row shows the new day with the same due date', async () => {
    const patch = api.last('PATCH', new RegExp(`^/v1/income/${owed.id}$`));
    expect(patch?.body).toEqual({ occurredOn: '2026-09-20' });
    expect(patch?.headers['if-match']).toBe('1');
    await expect(row()).toContainText('Sep 20, 2026');
    await expect(row()).toContainText('Nov 15, 2026');
  });
});

test('A Received payment’s date is changed from Payments by its Received cell', { tag: '@portal.income.redate-received' }, async ({ page, step }) => {
  const received = receivedEntry();
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, payments: [received] });
  const drawer = page.getByRole('dialog', { name: 'Change the received date' });
  const row = () => page.getByRole('table', { name: 'Payments' }).getByRole('row', { name: /Client 1/ });

  await step('Open Payments and open the payment from its Received date', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await row().getByRole('button', { name: 'Oct 8, 2026' }).click();
    await expect(page).toHaveURL(new RegExp(`payment=${received.id}`));
    await expect(drawer.getByLabel('Received on')).toHaveValue('2026-10-08');
  });

  await step('Pick an earlier day and save', async () => {
    await drawer.getByLabel('Received on').fill('2026-10-02');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('The server got receivedOn with If-Match, and the row shows the new day', async () => {
    const patch = api.last('PATCH', new RegExp(`^/v1/payments/${received.id}$`));
    expect(patch?.body).toEqual({ receivedOn: '2026-10-02' });
    expect(patch?.headers['if-match']).toBe('1');
    await expect(row()).toContainText('Oct 2, 2026');
  });
});

test('A settled entry lists its payment; changing that payment’s date shows on the entry', { tag: '@portal.income.redate-payment' }, async ({ page, step }) => {
  const owed = owedEntry();
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, receivables: [owed] });
  const entry = page.getByRole('dialog', { name: 'Change the date' });
  const paymentDrawer = page.getByRole('dialog', { name: 'Change the received date' });
  const today = todayInJerusalem();

  await step('Record payment in full on the Owed entry', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await page.getByRole('button', { name: /^Record payment for Client 1/ }).click();
    const settle = page.getByRole('dialog', { name: /Record payment/ });
    await settle.getByRole('button', { name: 'Record payment' }).click();
    await expect(settle).toHaveCount(0);
  });

  await step('Open the settled entry: it lists its payment, received today', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables?status=SETTLED`);
    await page.getByRole('table', { name: 'Receivables' }).getByRole('row', { name: /Client 1/ }).locator('button.row-link').click();
    await expect(entry.getByText('Payments on this entry')).toBeVisible();
    await expect(entry.getByRole('button', { name: /500\.00/ })).toBeVisible();
  });

  await step('Open its payment line and pick an earlier day', async () => {
    await entry.getByRole('button', { name: /500\.00/ }).click();
    await expect(paymentDrawer).toBeVisible();
    await expect(paymentDrawer.getByLabel('Received on')).toHaveValue(today);
    await paymentDrawer.getByLabel('Received on').fill('2026-10-01');
    await paymentDrawer.getByRole('button', { name: 'Save' }).click();
    await expect(paymentDrawer).toHaveCount(0);
    expect(api.last('PATCH', /^\/v1\/payments\//)?.body).toEqual({ receivedOn: '2026-10-01' });
  });

  await step('Open the entry again: its payment line shows the new date', async () => {
    await page.getByRole('table', { name: 'Receivables' }).getByRole('row', { name: /Client 1/ }).locator('button.row-link').click();
    await expect(entry.getByRole('button', { name: /Oct 1, 2026/ })).toBeVisible();
  });
});

test('The date stops at the profile’s today, and a later date is refused at the field without a request', { tag: '@portal.income.redate-no-future' }, async ({ page, step }) => {
  const owed = owedEntry();
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, receivables: [owed] });
  const drawer = page.getByRole('dialog', { name: 'Change the date' });

  await step('Open the Owed entry', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables?income=${owed.id}`);
    await expect(drawer.getByLabel('Date')).toHaveAttribute('max', todayInJerusalem());
  });

  await step('Type tomorrow and save', async () => {
    await drawer.getByLabel('Date').fill(dayAfter(todayInJerusalem()));
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByText(/The date can.t be later than today/)).toBeVisible();
    expect(api.calls('PATCH', /^\/v1\/income\//)).toHaveLength(0);
  });
});

test('A date changed on another device is refused on Save; the drawer refills with it and saving again works', { tag: '@portal.income.redate-conflict' }, async ({ page, step }) => {
  const owed = owedEntry();
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, receivables: [owed] });
  const drawer = page.getByRole('dialog', { name: 'Change the date' });

  await step('Open the Owed entry; meanwhile it is re-dated elsewhere', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables?income=${owed.id}`);
    await expect(drawer.getByLabel('Date')).toHaveValue('2026-10-08');
    api.redatedElsewhere(owed.id, '2026-10-05');
  });

  await step('Pick a day and save: refused, and the other device’s day is shown', async () => {
    await drawer.getByLabel('Date').fill('2026-09-30');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('This changed elsewhere');
    await expect(drawer.getByLabel('Date')).toHaveValue('2026-10-05');
  });

  await step('Pick the day again and save: it goes through at the new version', async () => {
    await drawer.getByLabel('Date').fill('2026-09-30');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    expect(api.last('PATCH', /^\/v1\/income\//)?.headers['if-match']).toBe('2');
  });
});

test('A Malafat-fed profile offers no date change on Receivables or Payments, even from a deep link', { tag: '@portal.income.redate-malafat-readonly' }, async ({ page, step }) => {
  const owed = receivable(51, { customerId: C1, gross: '500.00', origin: 'INSTALLMENT' });
  const paid = payment(52, { customerId: C1, amount: '500.00', allocations: [allocation(53, { receivableId: owed.id, projectId: owed.projectId ?? C1, amount: '500.00', left: '0.00' })] });
  const api = new FakeApi({ profiles: [malafatFirm()], clients: 1, receivables: [owed], payments: [paid] });

  await step('Open the firm’s Receivables at ?income=', async () => {
    await api.open(page, `/p/${FIRM}/receivables?income=${owed.id}`);
    const table = page.getByRole('table', { name: 'Receivables' });
    await expect(table).toBeVisible();
    await expect(table.locator('button.row-link')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  await step('Open its Payments at ?payment=', async () => {
    await api.open(page, `/p/${FIRM}/payments?payment=${paid.id}`);
    const table = page.getByRole('table', { name: 'Payments' });
    await expect(table).toBeVisible();
    await expect(table.locator('button.row-link')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

