import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { attachScreenshot } from '../../support/brand';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';

/**
 * MUT-674 and MUT-679: the Tax Authority guide opens in a drawer over the page from the button beside Connect on the
 * invoicing setup's step 5 (and from the allocation panel on the issue screen), and closing it leaves the page as it
 * was. Arabic first, then English.
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
