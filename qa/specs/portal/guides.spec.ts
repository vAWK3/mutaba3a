import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { attachScreenshot } from '../../support/brand';
import { OFFICE_A, OFFICE_B, office } from '../../support/portal';
import { FakeApi, type StubGrant } from '../../support/portalApi';

/**
 * MUT-674 and MUT-679: the Tax Authority guide opens in a drawer over the page from the button beside Connect on the
 * invoicing setup's step 5 (and from the allocation panel on the issue screen), and closing it leaves the page as it
 * was. Arabic first, then English. MUT-785 and MUT-786 add the invoice guide (the empty Issued list, the setup's ready
 * block) and the accountant guide (the Sharing page), and MUT-679's ended-connection entry.
 */

const SETUP = `/p/${OFFICE_A}/you/invoicing`;
const region5 = (page: Page) => page.getByTestId('letterhead').getByRole('button', { name: /^(Step 5:|الخطوة 5)/ });

test('The Tax Authority guide opens from Connect, reads in Arabic then English, and closing it leaves the page as it was', { tag: '@portal.guides.guide-open-read-close' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], invoicing: 'ready', taxAuthority: { plan: 'solo' } });
  const taStep = page.getByTestId('tax-authority-step');

  await step('Open Invoicing in Arabic and choose step 5, the Tax Authority', async () => {
    await api.open(page, SETUP, 'ar');
    await region5(page).click();
    await expect(taStep.getByTestId('tax-authority-connect')).toBeVisible();
  });

  await step('Press the guide button beside Connect', async () => {
    await taStep.getByRole('button', { name: 'كيف أربط؟' }).click();
    await expect(page.getByRole('dialog', { name: 'الربط بسلطة الضرائب' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('guide')).toBe('tax-authority');
  });

  await step('Read it in Arabic, right to left', async () => {
    const dialog = page.getByRole('dialog', { name: 'الربط بسلطة الضرائب' });
    await expect(dialog.getByRole('listitem')).toHaveCount(4);
    await expect(dialog.getByRole('note')).toBeVisible();
    await expect(dialog.getByText('إن انتهى الربط')).toBeVisible();
    await expect(dialog.getByRole('link', { name: /صفحة سلطة الضرائب/ })).toHaveAttribute('href', /gov\.il/);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(dialog.locator('[data-scene="guide-tax-1"]')).toHaveAttribute('data-scene-art', 'guide-tax-1-rtl');
    await attachScreenshot(page, 'ar-portal-guide-tax');
  });

  await step('Close it with the cross: step 5 is as it was', async () => {
    await page.getByRole('dialog', { name: 'الربط بسلطة الضرائب' }).getByRole('button', { name: 'إغلاق' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('guide')).toBeNull();
    await expect(taStep.getByTestId('tax-authority-connect')).toBeVisible();
  });

  await step('Press the button again and Escape: the guide closes and focus is back on the button', async () => {
    const button = taStep.getByRole('button', { name: 'كيف أربط؟' });
    await button.click();
    await expect(page.getByRole('dialog', { name: 'الربط بسلطة الضرائب' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  await step('Open it in English from the same button and read it', async () => {
    await api.open(page, SETUP, 'en');
    await region5(page).click();
    await taStep.getByRole('button', { name: 'How to connect' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect to the Tax Authority' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(4);
    await expect(dialog.getByText('Approve MTB3A\'s access.')).toBeVisible();
    await expect(dialog.getByText('Reconnect every 90 days.')).toBeVisible();
    await attachScreenshot(page, 'en-portal-guide-tax');
  });

  await step('Press Done: the guide closes and step 5 is as it was', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(taStep.getByTestId('tax-authority-connect')).toBeVisible();
  });
});

test('The guide opens over the issue drawer from the allocation panel, and closing it returns to the invoice as it was', { tag: '@portal.guides.guide-over-issue-drawer' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, invoicing: 'ready', manualAllocation: true });
  const issue = page.getByRole('dialog', { name: 'Issue a document' });
  const panel = issue.getByTestId('issue-allocation');

  await step('Open Issue a document, choose Client 1 and a line of 6,000, and type the allocation number', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    await issue.getByLabel('Client').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await issue.getByLabel('Description').fill('Annual retainer');
    await issue.getByRole('textbox', { name: 'Price', exact: true }).fill('6000');
    await expect(panel).toBeVisible();
    await issue.getByLabel('Allocation number (9 digits)').fill('123456789');
  });

  await step('Press How to connect in the panel: the guide opens over the invoice', async () => {
    await panel.getByRole('button', { name: 'How to connect' }).click();
    await expect(page.getByRole('dialog', { name: 'Connect to the Tax Authority' })).toBeVisible();
    await expect(issue).toBeVisible();
    await attachScreenshot(page, 'en-portal-guide-over-issue');
  });

  await step('Close the guide: the invoice is as it was, with the number still typed', async () => {
    await page.getByRole('dialog', { name: 'Connect to the Tax Authority' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: 'Connect to the Tax Authority' })).toHaveCount(0);
    await expect(issue).toBeVisible();
    await expect(issue.getByLabel('Allocation number (9 digits)')).toHaveValue('123456789');
    await expect(issue.getByLabel('Description')).toHaveValue('Annual retainer');
  });
});

test('The invoice guide opens from the empty Issued list and from the ready setup, in Arabic then English', { tag: '@portal.guides.invoice-from-issued-and-setup' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], invoicing: 'ready' });

  await step('Open Documents, Issued, in Arabic: nothing is issued yet', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`, 'ar');
    await expect(page.getByTestId('issued-empty')).toBeVisible();
  });

  await step('Press the guide button and read it in Arabic, right to left', async () => {
    await page.getByRole('button', { name: 'كيف أصدر؟' }).click();
    const dialog = page.getByRole('dialog', { name: 'إصدار أول فاتورة' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(4);
    await expect(dialog.getByRole('note')).toBeVisible();
    await expect(dialog.locator('[data-scene="guide-invoice-1"]')).toHaveAttribute('data-scene-art', 'guide-invoice-1-rtl');
    await expect(dialog.locator('[data-scene="guide-invoice-2"]')).toHaveAttribute('data-scene-art', 'guide-invoice-2');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await attachScreenshot(page, 'ar-portal-guide-invoice');
  });

  await step('Close it with the cross: the empty list is as it was', async () => {
    await page.getByRole('dialog', { name: 'إصدار أول فاتورة' }).getByRole('button', { name: 'إغلاق' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('issued-empty')).toBeVisible();
  });

  await step('Open the ready invoicing setup in English and press the guide button there', async () => {
    await api.open(page, `/p/${OFFICE_A}/you/invoicing`, 'en');
    await page.getByTestId('setup-ready').getByRole('button', { name: 'How to issue' }).click();
    const dialog = page.getByRole('dialog', { name: 'Issue your first invoice' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Issue your first document from MTB3A.')).toBeVisible();
    await expect(dialog.getByText('Press Issue a document.')).toBeVisible();
    await attachScreenshot(page, 'en-portal-guide-invoice');
  });

  await step('Press Done: the setup is as it was', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('setup-ready')).toBeVisible();
  });
});

const SAMI: StubGrant = { id: 'a1000001-0000-4000-8000-000000000000', email: 'sami@khoury-cpa.com', name: 'Sami Khoury', status: 'active', invitedAt: new Date(Date.now() - 26 * 86_400_000).toISOString(), expiresAt: new Date(Date.now() - 12 * 86_400_000).toISOString(), acceptedAt: new Date(Date.now() - 25 * 86_400_000).toISOString(), lastViewedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() };
const SHARING = `/p/${OFFICE_B}/you/sharing`;

test('The accountant guide opens from the Sharing page, in Arabic then English', { tag: '@portal.guides.accountant-from-sharing' }, async ({ page, step }) => {
  const nobody = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Personal'), office(OFFICE_B, 'Studio')], accountants: { [OFFICE_B]: [] } });

  await step('Open Sharing in Arabic on a profile shared with nobody', async () => {
    await nobody.open(page, SHARING, 'ar');
    await expect(page.getByRole('heading', { level: 2, name: 'لم تشارك هذا الملف بعد' })).toBeVisible();
  });

  await step('Press the guide button and read it in Arabic, in the page\'s own words about what an accountant sees', async () => {
    await page.getByRole('main').getByRole('button', { name: 'كيف أدعو؟' }).click();
    const dialog = page.getByRole('dialog', { name: 'دعوة المحاسب' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(3);
    await expect(dialog.getByText('يرى المصاريف والدخل والإيصالات في هذا الملف.')).toBeVisible();
    await expect(dialog.locator('[data-scene="guide-accountant-1"]')).toHaveAttribute('data-scene-art', 'guide-accountant-1-rtl');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await attachScreenshot(page, 'ar-portal-guide-accountant');
  });

  await step('Close it with the cross: the empty Sharing page is as it was', async () => {
    await page.getByRole('dialog', { name: 'دعوة المحاسب' }).getByRole('button', { name: 'إغلاق' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'لم تشارك هذا الملف بعد' })).toBeVisible();
  });

  await step('Open Sharing in English with an accountant and press the guide button in the Accountants column', async () => {
    const shared = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Personal'), office(OFFICE_B, 'Studio')], accountants: { [OFFICE_B]: [SAMI] } });
    await shared.open(page, SHARING, 'en');
    await page.getByRole('main').getByRole('button', { name: 'How to invite' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite your accountant' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("They see this profile's expenses, income and receipts.")).toBeVisible();
    await expect(dialog.getByText('The invite lasts 14 days. If it expires, invite again.')).toBeVisible();
    await attachScreenshot(page, 'en-portal-guide-accountant');
  });

  await step('Press Done: the Sharing page is as it was', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Sami Khoury')).toBeVisible();
  });
});

test('The Tax Authority guide opens beside Connect again when the connection has ended', { tag: '@portal.guides.tax-guide-ended-state' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], invoicing: 'ready', taxAuthority: { plan: 'solo', ended: true } });
  const taStep = page.getByTestId('tax-authority-step');

  await step('Open Invoicing and choose step 5 with a connection that has ended', async () => {
    await api.open(page, SETUP, 'en');
    await region5(page).click();
    await expect(taStep.getByText('The connection to the Tax Authority has ended.')).toBeVisible();
    await expect(taStep.getByTestId('tax-authority-connect')).toBeVisible();
  });

  await step('Press How to connect beside Connect: the guide opens, and closing it leaves step 5 as it was', async () => {
    await taStep.getByRole('button', { name: 'How to connect' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect to the Tax Authority' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Reconnect every 90 days.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(taStep.getByText('The connection to the Tax Authority has ended.')).toBeVisible();
  });
});
