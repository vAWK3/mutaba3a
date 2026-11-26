import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, OFFICE_B, office, type StubProfile } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-731 (ADR-284): the free Starter plan «البداية» in the portal, on the FakeApi (`starter` seed: the server's
 * STARTER_PLAN states and its 409 PLAN_LIMIT refusals). Wireframes 1–4 and 7; Basel's comments 13549, 13554, 13540.
 */

const personal: StubProfile = { ...office(OFFICE_B, 'Personal'), type: 'PERSONAL', personalDefault: true };
const CARRIED = '55555555-5555-4555-8555-555555555555';

async function openBilling(page: import('@playwright/test').Page, language: 'en' | 'ar' = 'en') {
  const name = language === 'ar' ? 'الاشتراك' : 'Billing';
  await openYou(page, 'account');
  await youRow(page, name).click();
  return page.getByRole('dialog', { name });
}

test('On Starter, Billing is a normal state with this month’s documents and scans, the plan’s lines and See plans', { tag: '@portal.starter.starter-billing' }, async ({ page, step }) => {
  await step('As a Starter person with 1 document and 7 scans this month, open You › Account › Billing', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { documents: 1, scans: 7 } });
    await api.open(page, `/p/${OFFICE_A}`);
    const drawer = await openBilling(page);
    await expect(drawer.getByText("You're on Starter, free")).toBeVisible();
    await expect(drawer.getByText('1 of 3 documents')).toBeVisible();
    await expect(drawer.getByText('7 of 12 scans')).toBeVisible();
    await expect(drawer.getByText(/^Resets on /)).toBeVisible();
    await expect(drawer.getByText('1 business and your personal profile')).toBeVisible();
    await expect(drawer.getByText('3 documents and 12 scans a month')).toBeVisible();
    await expect(drawer.getByText('Tax Authority connection: Solo and above')).toBeVisible();
    await expect(page.getByRole('button', { name: 'See plans' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Upgrade to Solo' })).toHaveCount(0);
  });

  await step('With 2 of 3 documents and 11 of 12 scans, open Billing again', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { documents: 2, scans: 11 } });
    await api.open(page, `/p/${OFFICE_A}`);
    const drawer = await openBilling(page);
    await expect(drawer.getByText('1 document left this month')).toBeVisible();
    await expect(drawer.getByText('1 scan left this month')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
  });

  await step('Open Billing in Arabic', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { documents: 1, scans: 7 } });
    await api.open(page, `/p/${OFFICE_A}`, 'ar');
    const drawer = await openBilling(page, 'ar');
    await expect(drawer.getByText('أنت على خطة البداية المجانية')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'Billing on Starter in Arabic');
  });
});

test('At 3 of 3 the Issue drawer opens refused with the reset day and Upgrade to Solo; a 4th document is refused by the server too', { tag: '@portal.starter.starter-invoice-cap' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], clients: 1, invoicing: 'ready', starter: { documents: 2 } });
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });

  await step('As a Starter person who issued 2 documents this month, open Issue a document', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    await expect(drawer.getByTestId('issue-usage')).toContainText('1 document left this month');
  });

  await step('Issue a tax invoice to Client 1', async () => {
    await drawer.getByLabel('Client').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await drawer.getByLabel('Description').fill('Sprint 3');
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('1000');
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice 1');
  });

  await step('Open Issue a document again', async () => {
    await page.goto(`/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    const notice = drawer.getByTestId('plan-limit-notice');
    await expect(notice.getByText("You've issued Starter's 3 documents this month")).toBeVisible();
    await expect(notice.getByText(/^You can issue more on /)).toBeVisible();
    await expect(page.getByTestId('issue-submit')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
  });
});

test('At 12 of 12 a scan is refused before the upload, with Add the expense by hand', { tag: '@portal.starter.starter-scan-cap' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], receipts: [], starter: { scans: 12 } });

  await step('As a Starter person who used 12 scans this month, open Expenses › Receipts and upload a receipt', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses/receipts`);
    await page.getByTestId('receipts-upload-input').setInputFiles({ name: 'cafe.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) });
    const notice = page.getByTestId('plan-limit-notice');
    await expect(notice.getByText("You've used Starter's 12 scans this month")).toBeVisible();
    await expect(notice.getByText(/^You can scan again on /)).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
    expect(api.calls('POST', /^\/v1\/receipts\/uploads$/)).toHaveLength(0);
  });

  await step('Choose Add the expense by hand', async () => {
    await page.getByRole('button', { name: 'Add the expense by hand' }).click();
    await expect(page).toHaveURL(/newExpense=true/);
  });
});

test('On Starter a second business is refused in New profile with Upgrade to Solo', { tag: '@portal.starter.starter-second-business' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: {} });

  await step('As a Starter person with one business, open New profile', async () => {
    await api.open(page, `/p/${OFFICE_A}?newProfile=true`);
    const drawer = page.getByRole('dialog', { name: 'New profile' });
    await expect(drawer.getByTestId('plan-limit-notice').getByText('Starter includes one business')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
  });
});

test('Read-only after a cancel offers Continue free on Starter; choosing it makes the profile writable', { tag: '@portal.starter.cancel-continue-starter' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], billingStanding: 'read-only', starter: { cancelled: true } });
  const banner = page.getByTestId('lapse-cancelled');

  await step('As a person whose paid plan was cancelled, open Home', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await expect(banner.getByText('Your plan has ended')).toBeVisible();
    await expect(banner.getByText('Starter: 1 business, 3 documents and 12 scans a month, no Tax Authority connection.')).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Subscribe' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Download my records' })).toBeVisible();
  });

  await step('Choose Continue free on Starter', async () => {
    await banner.getByRole('button', { name: 'Continue free on Starter' }).click();
    await expect(page.getByTestId('toast-live')).toContainText("You're on Starter now.");
    expect(api.calls('POST', /^\/v1\/billing\/starter$/)).toHaveLength(1);
    await expect(banner).toHaveCount(0);
  });
});

test('With two businesses on Starter the person must pick the active one first; the other stays read-only', { tag: '@portal.starter.starter-choose-active-business' }, async ({ page, step }) => {
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio'), office(CARRIED, 'Carried Studio'), personal],
    starter: { businesses: { active: [], readOnly: [OFFICE_A, CARRIED] } },
  });
  const dialog = page.getByRole('dialog', { name: 'Choose your active business' });

  await step('As a Starter person whose two businesses came over from the free app, sign in', async () => {
    await api.open(page, `/p/${OFFICE_B}`);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(dialog.getByTestId('pick-business-confirm')).toBeDisabled();
    await expect(dialog.getByTestId('pick-business-confirm')).toHaveText('Choose a business');
    await expect(dialog.getByRole('button', { name: 'See plans' })).toBeVisible();
  });

  await step('Choose Carried Studio and keep it active', async () => {
    await dialog.getByLabel('Carried Studio').check();
    await dialog.getByRole('button', { name: 'Keep Carried Studio active' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.last('PUT', /^\/v1\/billing\/active-businesses$/)?.body).toEqual({ organizationIds: [CARRIED] });
  });

  await step('Open Nour Studio', async () => {
    await page.goto(`/p/${OFFICE_A}`);
    const banner = page.getByTestId('lapse-plan-limit');
    await expect(banner.getByText('Starter includes one business. The others stay read-only.')).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Change' })).toBeVisible();
  });
});

test('Home’s 80% line, the 90% nudge that can be hidden, and the limit line that can’t', { tag: '@portal.starter.starter-usage-notices' }, async ({ page, step }) => {
  await step('As a Starter person with 10 of 12 scans, open Home', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { scans: 10 } });
    await api.open(page, `/p/${OFFICE_A}`);
    await expect(page.getByTestId('usage-near')).toContainText(/10 of 12 scans this month · Resets on/);
  });

  await step('With 11 of 12 scans, open Home and choose Hide', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { scans: 11 } });
    await api.open(page, `/p/${OFFICE_A}`);
    const nudge = page.getByTestId('usage-nudge');
    await expect(nudge.getByText('1 scan left this month')).toBeVisible();
    await expect(nudge.getByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
    await nudge.getByRole('button', { name: 'Hide' }).click();
    await expect(nudge).toHaveCount(0);
  });

  await step('With 3 of 3 documents, open Home', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { documents: 3 } });
    await api.open(page, `/p/${OFFICE_A}`);
    const line = page.getByTestId('usage-at_cap');
    await expect(line).toContainText(/No documents left this month · Resets on/);
    await expect(line.getByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
    await expect(line.getByRole('button', { name: 'Hide' })).toHaveCount(0);
  });
});
