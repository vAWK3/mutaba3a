import { test, expect } from '../../support/qa';
import { OFFICE_A, OFFICE_B, office, type StubProfile } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';

/**
 * MUT-733 (wireframe mut-733 A): paid plans' monthly limits on the FakeApi's `paid` seed: the gift before anything goes
 * through, Continue retrying what was held, and the hard cap after it.
 */

const personal: StubProfile = { ...office(OFFICE_B, 'Personal'), type: 'PERSONAL', personalDefault: true };

async function issueToClient(page: import('@playwright/test').Page) {
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });
  await drawer.getByLabel('Client').fill('Client 1');
  await page.getByRole('option', { name: /Client 1/ }).click();
  await drawer.getByLabel('Description').fill('Sprint 3');
  await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('1000');
  await page.getByTestId('issue-submit').click();
}

test('On Solo at 50 of 50 invoices, the Issue drawer opens with the gift; Continue takes it and the invoice issues', { tag: '@portal.paid-caps.paid-cap-gift' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], clients: 1, invoicing: 'ready', paid: { plan: 'solo', documents: 50 } });
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });

  await step('As a Solo subscriber who issued 50 documents this month, open Issue a document', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    const gift = drawer.getByTestId('gift-notice');
    await expect(gift).toContainText('Congratulations: 50 invoices this month.');
    await expect(gift).toContainText(/From .+ the limit is 50/);
    await expect(gift.locator('[data-scene="gift-month"]')).toHaveClass(/hp-scene--gift-month/);
    await expect(page.getByTestId('issue-submit')).toHaveCount(0);
  });

  await step('Choose Continue', async () => {
    await page.getByTestId('gift-continue').click();
    await expect(drawer.getByTestId('issue-usage')).toContainText(/^No limit until /);
    await expect(page.getByTestId('issue-submit')).toBeVisible();
    expect(api.calls('POST', '/v1/billing/over-cap-gift')[0]!.body).toMatchObject({ meter: 'documents' });
  });

  await step('Issue a tax invoice to Client 1', async () => {
    await issueToClient(page);
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice');
  });
});

test('Once the gift is used, the 51st invoice is refused with the gift-used scene, the reset day and Upgrade to Business', { tag: '@portal.paid-caps.paid-cap-hard' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], clients: 1, invoicing: 'ready', paid: { plan: 'solo', documents: 50, gift: { used: true } } });

  await step('As a Solo subscriber whose gift is used, with 50 documents this month, issue a tax invoice', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    await issueToClient(page);
    const notice = page.getByRole('dialog', { name: 'Issue a document' }).getByTestId('plan-limit-notice');
    await expect(notice).toContainText('Limit reached: 50 of 50 documents');
    await expect(notice).toContainText(/^.*You can issue more on /);
    await expect(notice.locator('[data-scene="gift-used"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upgrade to Business' })).toBeVisible();
  });
});

test('On Solo at 100 of 100 scans, an upload shows the gift; Continue takes it and the receipt uploads', { tag: '@portal.paid-caps.paid-scan-gift' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], receipts: [], paid: { plan: 'solo', scans: 100 } });

  await step('As a Solo subscriber who used 100 scans this month, upload a receipt in Expenses › Receipts', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses/receipts`);
    await page.getByTestId('receipts-upload-input').setInputFiles({ name: 'cafe.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) });
    const gift = page.getByTestId('gift-notice');
    await expect(gift).toContainText('Congratulations: 100 scans this month.');
    expect(api.calls('POST', /^\/v1\/receipts\/uploads$/)).toHaveLength(0);
  });

  await step('Choose Continue', async () => {
    await page.getByTestId('gift-continue').click();
    await expect(page.getByTestId('gift-notice')).toHaveCount(0);
    await expect.poll(() => api.calls('POST', /^\/v1\/receipts\/uploads$/).length).toBeGreaterThan(0);
    expect(api.calls('POST', '/v1/billing/over-cap-gift')[0]!.body).toMatchObject({ meter: 'scans' });
  });
});

test("On Solo at 46 of 50, the Issue drawer's footer says so in butter with Upgrade to Business", { tag: '@portal.paid-caps.paid-usage-nudge' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], clients: 1, invoicing: 'ready', paid: { plan: 'solo', documents: 46 } });

  await step('As a Solo subscriber who issued 46 documents this month, open Issue a document', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    const line = page.getByRole('dialog', { name: 'Issue a document' }).getByTestId('issue-usage');
    await expect(line).toContainText('46 of 50 documents this month');
    await expect(line).toHaveAttribute('data-level', 'nudge');
    await expect(line.getByRole('button', { name: 'Upgrade to Business' })).toBeVisible();
  });
});
