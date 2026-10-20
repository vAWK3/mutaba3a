import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { attachScreenshot } from '../../support/brand';
import { readBidi, readField } from '../../support/bidi';
import { OFFICE_A, customer, office } from '../../support/portal';
import { FakeApi, attachment, payment } from '../../support/portalApi';

/**
 * MUT-109 (TD-048, direction half) in the portal: an Arabic amount keeps the place
 * it had before, and what must read left to right (an email, a password, a payment
 * or invoice number) now does. Proved in a browser, since jsdom runs no cascade.
 */

/** PORTAL_LANGUAGE_KEY in src/hosted/i18n/HostedLanguageProvider.tsx */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';
const portalI18n = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/hosted/i18n');
const arTitle = (JSON.parse(fs.readFileSync(path.join(portalI18n, 'ar.json'), 'utf8')) as { hosted: { auth: { title: string } } }).hosted.auth.title;

/** Where a standalone Arabic shekel amount sits today, read left to right on screen: ₪, then the number. Kept by MUT-109. */
const ARABIC_SHEKELS_ON_SCREEN = /^₪ [\d,.]+$/;

async function openArabicSignIn(page: Page) {
  await page.route('**/v1/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) }),
  );
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [PORTAL_LANGUAGE_KEY, 'ar'] as const);
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { level: 1, name: arTitle })).toBeVisible();
}

test('Arabic: sign-in’s email and password are typed left to right, on the right as before', { tag: '@portal.direction.signin' }, async ({ page, step }) => {
  await step('Open sign-in in Arabic, signed out', async () => {
    await openArabicSignIn(page);
  });

  await step('Type an email: the fields are left to right and sit on the right', async () => {
    const email = page.locator('input[type="email"]');
    await email.fill('nour.haddad@example.com');
    expect(await readField(email)).toEqual({ direction: 'ltr', dir: 'ltr', side: 'right' });
    expect(await readField(page.locator('input[autocomplete="current-password"]'))).toEqual({ direction: 'ltr', dir: 'ltr', side: 'right' });
    await attachScreenshot(page, 'ar-portal-signin');
  });
});

test('Arabic: the expense form’s amount is typed left to right, on the right as before', { tag: '@portal.direction.amount-input' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });

  await step('Open a new expense in Arabic', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses?newExpense=true`, 'ar');
  });

  await step('Type 1,200.50: the field is left to right and sits on the right', async () => {
    const amount = page.locator('#expense-amount');
    await amount.fill('1,200.50');
    await expect(amount).toHaveValue('1,200.50');
    expect(await readField(amount)).toEqual({ direction: 'ltr', dir: 'ltr', side: 'right' });
    await attachScreenshot(page, 'ar-portal-expense-form');
  });
});

test('Arabic: payment and invoice numbers read left to right, and amounts keep their place', { tag: '@portal.direction.ledger' }, async ({ page, step }) => {
  const C1 = customer(0).id;
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 1,
    payments: [payment(1, { customerId: C1, amount: '1500.00', number: 'PAY-2026-0001' })],
    attachments: [attachment(1, { filename: 'invoice-7.pdf', kind: 'INVOICE', customerId: C1, invoiceNumber: 'INV-2026-007' })],
  });

  await step('Open Payments in Arabic', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`, 'ar');
    await expect(page.getByRole('table').getByText('PAY-2026-0001')).toBeVisible();
  });

  await step('The payment number reads PAY-2026-0001; its amount reads ₪ 1,500.00 as before', async () => {
    const row = page.getByRole('table').getByRole('row').filter({ hasText: 'PAY-2026-0001' });
    expect(await readBidi(row.locator('bdi', { hasText: 'PAY-' }))).toMatchObject({ direction: 'ltr', visual: 'PAY-2026-0001' });
    const amount = await readBidi(row.locator('bdi.hp-amount').first());
    expect(amount.visual).toMatch(ARABIC_SHEKELS_ON_SCREEN);
    expect(amount).toMatchObject({ direction: 'rtl', dir: null });
    await attachScreenshot(page, 'ar-portal-payments');
  });

  await step('Documents: the invoice number reads INV-2026-007', async () => {
    await page.goto(`/p/${OFFICE_A}/documents`);
    const invoice = page.getByRole('table').locator('bdi', { hasText: 'INV-' });
    await expect(invoice).toBeVisible();
    expect(await readBidi(invoice)).toMatchObject({ direction: 'ltr', visual: 'INV-2026-007' });
    await attachScreenshot(page, 'ar-portal-documents');
  });
});

/** A phone, narrower than the drawer's 480px (--drawer-width in src/styles/theme.css). */
const PHONE = { width: 375, height: 812 };

/** Where the open drawer sits once its spring has settled, and whether the page scrolls sideways. */
async function readDrawerFit(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  const box = await dialog.boundingBox();
  const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  return { box, sideScroll };
}

for (const language of ['ar', 'en'] as const) {
  test(`${language === 'ar' ? 'Arabic' : 'English'} on a phone: a drawer sits wholly on screen, with no sideways scroll`, { tag: `@portal.direction.drawer-phone-${language}` }, async ({ page, step }) => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });

    await step(`Open Change password in ${language === 'ar' ? 'Arabic' : 'English'} on a 375px phone`, async () => {
      await page.setViewportSize(PHONE);
      await api.open(page, `/p/${OFFICE_A}/expenses?changePassword=true`, language);
    });

    await step('The drawer fills the screen edge to edge, and nothing scrolls sideways', async () => {
      const { box, sideScroll } = await readDrawerFit(page);
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
      expect(box!.width).toBe(PHONE.width);
      expect(sideScroll).toBe(false);
      await attachScreenshot(page, `${language}-portal-drawer-phone`);
    });
  });
}
