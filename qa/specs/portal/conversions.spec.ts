import { test, expect } from '../../support/qa';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi, conversion, todayInJerusalem } from '../../support/portalApi';

/**
 * Currency conversions in the portal (MUT-161; edit and delete since MUT-194):
 * the list, and the drawer that logs, edits or deletes one. The in-memory API
 * (qa/support/portalApi.ts) answers a stale If-Match with 409, as the server does.
 */

test('a successful conversion save shows the animated save-feedback icon in the saved notice', { tag: '@portal.conversions.save-feedback-animation' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
  const drawer = page.getByRole('dialog', { name: 'Log conversion' });

  await step('Open Conversions and add a new conversion', async () => {
    await api.open(page, `/p/${OFFICE_A}/conversions`);
    await page.getByRole('button', { name: 'Log conversion' }).first().click();
    await expect(drawer).toBeVisible();
  });

  await step('Save it', async () => {
    await drawer.getByLabel('From amount').fill('100');
    await drawer.getByLabel('To amount').fill('370');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });

  const notice = page.getByRole('status');
  await expect(notice).toBeVisible();
  await expect(notice.locator('[data-part]').first()).toBeVisible();
});

test('Log a conversion: the drawer shows the implied rate, refuses one currency to itself, and the conversion is listed', { tag: '@portal.conversions.log' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
  const drawer = page.getByRole('dialog', { name: 'Log conversion' });

  await step('Open Conversions: nothing logged yet', async () => {
    await api.open(page, `/p/${OFFICE_A}/conversions`);
    await expect(page.getByRole('heading', { name: 'No conversions logged on this profile yet' })).toBeVisible();
  });

  await step('Choose Log conversion: 1000 USD to 3700 ILS shows the rate', async () => {
    await page.getByRole('button', { name: 'Log conversion' }).first().click();
    await expect(page).toHaveURL(/newConversion=true/);
    await expect(drawer.getByLabel('Date')).toHaveValue(todayInJerusalem());
    await drawer.getByLabel('From amount').fill('1000');
    await drawer.getByLabel('To amount').fill('3700');
    await expect(drawer.getByText('Implied rate: 1 USD = 3.7000 ILS')).toBeVisible();
  });

  await step('Convert ILS to ILS: refused at the field', async () => {
    await drawer.getByLabel('From currency').selectOption('ILS');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByText('Choose a different currency to convert to')).toBeVisible();
    expect(api.calls('POST', /^\/v1\/conversions$/)).toHaveLength(0);
  });

  await step('Back to USD, add a note, save', async () => {
    await drawer.getByLabel('From currency').selectOption('USD');
    await drawer.getByLabel('Notes').fill('Rent transfer');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    const post = api.last('POST', /^\/v1\/conversions$/);
    expect(post?.body).toEqual({ occurredOn: todayInJerusalem(), amount: '1000', currency: 'USD', toAmount: '3700', toCurrency: 'ILS', notes: 'Rent transfer' });
    expect(post?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  await step('It is listed with both legs', async () => {
    const row = page.getByRole('table', { name: 'Conversions' }).getByRole('row', { name: /Rent transfer/ });
    await expect(row).toContainText('$1,000.00');
    await expect(row).toContainText('3,700.00');
  });

  await step('Filter to EUR: nothing matches', async () => {
    await page.getByLabel('Currency').selectOption('EUR');
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
    expect(api.last('GET', /^\/v1\/conversions$/)?.query.get('currency')).toBe('EUR');
  });
});

test('Edit a conversion: a change made elsewhere first is loaded into the drawer, then the edit saves at the latest version', { tag: '@portal.conversions.edit' }, async ({ page, step }) => {
  const rent = conversion(1, { amount: '1000.00', currency: 'USD', toAmount: '3700.00', toCurrency: 'ILS', notes: 'Rent transfer' });
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], conversions: [rent] });
  const drawer = page.getByRole('dialog', { name: 'Edit conversion' });

  await step('Open Conversions and choose the rent transfer', async () => {
    await api.open(page, `/p/${OFFICE_A}/conversions`);
    await page.getByRole('table', { name: 'Conversions' }).getByRole('button', { name: /Oct 4, 2026/ }).click();
    await expect(page).toHaveURL(new RegExp(`conversion=${rent.id}`));
    await expect(drawer.getByLabel('To amount')).toHaveValue('3700.00');
    await expect(drawer.getByLabel('Notes')).toHaveValue('Rent transfer');
  });

  await step('Meanwhile the phone app edits the note', async () => {
    rent.notes = 'Rent transfer, October';
    rent.version = 2;
  });

  await step('Change the ILS leg to 3650 and save: refused, and the drawer shows the latest', async () => {
    await drawer.getByLabel('To amount').fill('3650');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('This conversion changed elsewhere — showing the latest version');
    await expect(drawer.getByLabel('Notes')).toHaveValue('Rent transfer, October');
    await expect(drawer.getByLabel('To amount')).toHaveValue('3700.00');
    expect(api.last('PATCH', /^\/v1\/conversions\//)?.headers['if-match']).toBe('1');
  });

  await step('Change it again and save: it goes through at version 2', async () => {
    await drawer.getByLabel('To amount').fill('3650');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    const patch = api.last('PATCH', /^\/v1\/conversions\//);
    expect(patch?.headers['if-match']).toBe('2');
    expect(patch?.body).toEqual({ occurredOn: '2026-10-04', amount: '1000.00', currency: 'USD', toAmount: '3650', toCurrency: 'ILS', notes: 'Rent transfer, October' });
    await expect(page.getByRole('table', { name: 'Conversions' })).toContainText('3,650.00');
  });
});

test('Delete a conversion: the prompt names both legs, Cancel keeps it, OK removes it, and its old link says it is gone', { tag: '@portal.conversions.delete' }, async ({ page, step }) => {
  const rent = conversion(1, { amount: '1000.00', currency: 'USD', toAmount: '3700.00', toCurrency: 'ILS', notes: 'Rent transfer' });
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], conversions: [rent] });
  const drawer = page.getByRole('dialog', { name: 'Edit conversion' });
  let prompt = '';

  await step('Open the rent transfer', async () => {
    await api.open(page, `/p/${OFFICE_A}/conversions?conversion=${rent.id}`);
    await expect(drawer.getByLabel('From amount')).toHaveValue('1000.00');
  });

  await step('Delete, then Cancel the prompt: nothing is deleted', async () => {
    page.once('dialog', (dialog) => {
      prompt = dialog.message();
      void dialog.dismiss();
    });
    await drawer.getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => prompt).toContain('Delete this conversion');
    expect(prompt).toContain('$1,000.00');
    expect(prompt).toContain('3,700.00');
    expect(prompt).toContain("This can't be undone.");
    await expect(drawer).toBeVisible();
    expect(api.calls('DELETE', /^\/v1\/conversions\//)).toHaveLength(0);
  });

  await step('Delete, and OK the prompt', async () => {
    page.once('dialog', (dialog) => void dialog.accept());
    await drawer.getByRole('button', { name: 'Delete' }).click();
    await expect(drawer).toHaveCount(0);
    expect(api.calls('DELETE', new RegExp(`^/v1/conversions/${rent.id}$`))).toHaveLength(1);
    await expect(page.getByRole('heading', { name: 'No conversions logged on this profile yet' })).toBeVisible();
  });

  await step('Open its old link: the drawer says it no longer exists', async () => {
    await page.goto(`/p/${OFFICE_A}/conversions?conversion=${rent.id}`);
    await expect(drawer.getByText('This conversion no longer exists')).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).last().click();
    await expect(drawer).toHaveCount(0);
  });
});
