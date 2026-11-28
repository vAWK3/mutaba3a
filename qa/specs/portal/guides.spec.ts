import { test, expect } from '../../support/qa';
import { attachScreenshot } from '../../support/brand';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';

/**
 * MUT-674: a guide opens in a drawer over the page and closing it leaves the page as it was. The one shipped guide is
 * `tax-authority`; no screen carries its button yet (MUT-679 places it), so it opens through its link, the URL key
 * every guide button uses.
 */

const PAGE = `/p/${OFFICE_A}/payments?status=POSTED`;
const GUIDE = `${PAGE}&guide=tax-authority`;

test('A guide opens in a drawer over the page, reads in Arabic then English, and closing it leaves the page as it was', { tag: '@portal.guides.guide-open-read-close' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });

  await step('Open Payments filtered to posted payments, in Arabic', async () => {
    await api.open(page, PAGE, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await step('Open the Tax Authority guide by its link', async () => {
    await page.goto(GUIDE);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  await step('Read it in Arabic, right to left', async () => {
    const dialog = page.getByRole('dialog', { name: 'الربط بسلطة الضرائب' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(4);
    await expect(dialog.getByRole('note')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(dialog.locator('[data-scene="guide-tax-1"]')).toHaveAttribute('data-scene-art', 'guide-tax-1-rtl');
    await attachScreenshot(page, 'ar-portal-guide');
  });

  await step('Close it with the cross', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'إغلاق' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('?status=POSTED');
    expect(new URL(page.url()).pathname).toBe(`/p/${OFFICE_A}/payments`);
  });

  await step('Open the same guide in English and read it', async () => {
    await api.open(page, GUIDE, 'en');
    const dialog = page.getByRole('dialog', { name: 'Connect to the Tax Authority' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(4);
    await expect(dialog.getByText('Approve access.')).toBeVisible();
    await attachScreenshot(page, 'en-portal-guide');
  });

  await step('Press Done', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('?status=POSTED');
  });
});
