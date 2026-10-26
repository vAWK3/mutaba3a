import type { BrowserContext, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { test, expect } from '../../support/qa';

/**
 * MUT-291: records carried from the old address to the new address, across two real browser origins
 * (qa/support/carry-over.mjs): the portal as the old address and the portal as the new one. Every /v1 request is
 * answered here as the API answers nobody signed in (401), so both portals run signed out on the real local backend;
 * the carry-over itself is real end to end: the pop-up, the messages, the server's rules replayed in the page, the
 * totals check, Restore. The free web app that also sent its records is retired (MUT-445): what is left of it is the
 * records file a person saved from it, which the new address still reads.
 */

const OLD_ADDRESS = 'http://127.0.0.1:5187';
const NEW_ADDRESS = 'http://127.0.0.1:5188';

/** PORTAL_LANGUAGE_KEY (src/hosted/i18n/HostedLanguageProvider.tsx). */
const LANGUAGE_KEYS: Array<[string, string]> = [['mutaba3a-portal-language', 'en']];

/** Nobody signed in, everywhere, in English. */
async function signedOutInEnglish(context: BrowserContext) {
  await context.route('**/v1/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) }));
  await context.addInitScript((keys) => keys.forEach(([key, value]) => localStorage.setItem(key, value)), LANGUAGE_KEYS);
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * A records file as the free web app saved it (its last backup version, 24): a business with a client, money
 * received, money still owed, an expense from a saved vendor and a recurring expense rule.
 */
function freeAppRecordsFile(path: string) {
  const at = new Date().toISOString();
  const stamps = { createdAt: at, updatedAt: at };
  const [received, owed, spent] = [daysAgo(20), daysAgo(10), daysAgo(5)];
  const tables = {
    businessProfiles: [{ id: 'qa-b1', name: 'QA Studio', defaultCurrency: 'ILS', isDefault: true, ...stamps }],
    clients: [{ id: 'qa-c1', name: 'Amman Studio', profileId: 'qa-b1', ...stamps }],
    transactions: [
      { id: 'qa-t1', kind: 'income', status: 'paid', title: 'Logo', amountMinor: 10_000, currency: 'ILS', occurredAt: received, paidAt: received, clientId: 'qa-c1', profileId: 'qa-b1', ...stamps },
      { id: 'qa-t2', kind: 'income', status: 'unpaid', title: 'Website', amountMinor: 25_000, currency: 'USD', occurredAt: owed, clientId: 'qa-c1', profileId: 'qa-b1', ...stamps },
    ],
    paymentRecords: [{ id: 'qa-r1', transactionId: 'qa-t1', amountMinor: 10_000, paidAt: received, ...stamps }],
    vendors: [{ id: 'qa-v1', profileId: 'qa-b1', canonicalName: 'Office Depot', aliases: [], ...stamps }],
    expenses: [{ id: 'qa-e1', profileId: 'qa-b1', vendorId: 'qa-v1', title: 'Paper', amountMinor: 2_500, currency: 'ILS', occurredAt: spent, ...stamps }],
    recurringRules: [{ id: 'qa-rr1', profileId: 'qa-b1', title: 'Rent', amountMinor: 100_000, currency: 'ILS', frequency: 'monthly', startDate: spent, endMode: 'noEnd', isPaused: false, ...stamps }],
  };
  writeFileSync(path, JSON.stringify({ version: 24, timestamp: at, tables }));
}

/** Signed out on the old address, money received is added; returns the Paid page's path. */
async function oldAddressWithPayment(page: Page, amount: string): Promise<string> {
  await page.goto(`${OLD_ADDRESS}/`);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Paid' }).click();
  await page.getByRole('button', { name: '+ Add income' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'New income' });
  await drawer.getByRole('radio', { name: 'Received' }).click();
  await drawer.getByLabel('Amount').fill(amount);
  await drawer.getByRole('button', { name: 'Save income' }).click();
  await expect(drawer).toBeHidden();
  return new URL(page.url()).pathname;
}

test('A records file saved from the old web app restores on the new address with the same summary', { tag: '@carry-over.carry.records-file' }, async ({ page, step }, testInfo) => {
  await signedOutInEnglish(page.context());
  const file = testInfo.outputPath('free-app-backup.json');
  freeAppRecordsFile(file);

  await step('On the new address, choose the file: the same counts and totals, before Save', async () => {
    await page.goto(`${NEW_ADDRESS}/carry-over/receive`);
    await expect(page.getByRole('heading', { name: 'Bring your records from a file' })).toBeVisible();
    await page.getByTestId('carry-over-file').setInputFiles(file);
    await expect(page.getByRole('heading', { name: 'Your records from the old app' })).toBeVisible();
    const counts = page.getByTestId('carry-over-counts');
    await expect(counts).toContainText('Clients1');
    await expect(counts).toContainText('Expenses1');
    const totals = page.getByTestId('carry-over-totals');
    await expect(totals.locator('tr[data-currency="ILS"] td[data-field="paid"]')).toContainText('100.00');
    await expect(totals.locator('tr[data-currency="ILS"] td[data-field="expenses"]')).toContainText('25.00');
    await expect(totals.locator('tr[data-currency="USD"] td[data-field="outstanding"]')).toContainText('250.00');
  });

  await step('Open Not carried: the saved vendor list and the recurring rule are listed, and Save is offered', async () => {
    const notCarried = page.getByTestId('carry-over-not-carried');
    await notCarried.locator('summary').click();
    await expect(notCarried.locator('li[data-code="vendors"]')).toBeVisible();
    await expect(notCarried.locator('li[data-code="recurring-rules"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save on this device' })).toBeVisible();
  });
});

test('Carrying into a device that already has records warns, offers a download first, and replaces only on a second confirm', { tag: '@carry-over.carry.replace-existing' }, async ({ page, step }) => {
  await signedOutInEnglish(page.context());

  await step('Have records on the new address already', async () => {
    await page.goto(`${NEW_ADDRESS}/`);
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Paid' }).click();
    await page.getByRole('button', { name: '+ Add income' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('radio', { name: 'Received' }).click();
    await drawer.getByLabel('Amount').fill('99.00');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toBeHidden();
  });

  await step('Have records on the old address, and open its carry-over page', async () => {
    await oldAddressWithPayment(page, '321.00');
    await page.goto(`${OLD_ADDRESS}/carry-over`);
    await expect(page.getByRole('heading', { name: 'Your records are moving' })).toBeVisible();
  });

  let receiver!: Page;
  await step('Choose Carry my records over', async () => {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Carry my records over' }).click();
    receiver = await popup;
    await expect(receiver.getByRole('heading', { name: 'Your records from the old address' })).toBeVisible();
  });

  await step('The summary warns how many records this device already has', async () => {
    await expect(receiver.getByTestId('carry-over-existing')).toContainText('This device already has 1 record.');
  });

  await step('Download what\'s here first', async () => {
    const download = receiver.waitForEvent('download');
    await receiver.getByRole('button', { name: "Download what's here first" }).click();
    expect((await download).suggestedFilename()).toMatch(/^mtb3a-records-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  await step('Replace: it asks once more, then replaces', async () => {
    await receiver.getByRole('button', { name: 'Replace with the carried records' }).click();
    await expect(receiver.getByTestId('carry-over-replace-confirm')).toBeVisible();
    // A person reads the question first; a click this soon after the first is a double-click and doesn't count (D3).
    await receiver.waitForTimeout(700);
    await receiver.getByRole('button', { name: 'Yes, replace everything' }).click();
    await expect(receiver.getByRole('heading', { name: 'Your records are here.' })).toBeVisible();
  });

  await step('The device now holds the carried records, not the earlier payment', async () => {
    await receiver.getByRole('button', { name: 'Open MTB3A' }).click();
    await expect(receiver.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await receiver.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Paid' }).click();
    await expect(receiver.getByRole('table', { name: 'Payments' })).toContainText('321.00');
    await expect(receiver.getByText('99.00')).toHaveCount(0);
  });
});

test('The old address\'s signed-out records go to the new address, and the old link\'s page opens there', { tag: '@carry-over.carry.portal-host' }, async ({ page, step }) => {
  await signedOutInEnglish(page.context());

  let paymentsPath = '';
  await step('Signed out on the old address, add money received', async () => {
    paymentsPath = await oldAddressWithPayment(page, '321.00');
  });

  await step('Open an old link that goes through the carry-over page: it offers the move', async () => {
    await page.goto(`${OLD_ADDRESS}/carry-over?next=${encodeURIComponent(paymentsPath)}`);
    await expect(page.getByRole('heading', { name: 'Your records are moving' })).toBeVisible();
  });

  let receiver!: Page;
  await step('Choose Carry my records over', async () => {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Carry my records over' }).click();
    receiver = await popup;
    await expect(receiver.getByRole('heading', { name: 'Your records from the old address' })).toBeVisible();
    await expect(receiver.getByTestId('carry-over-totals').locator('tr[data-currency="ILS"] td[data-field="paid"]')).toContainText('321.00');
  });

  await step('Save on the new address: the old link\'s page opens there, with the money received', async () => {
    await receiver.getByRole('button', { name: 'Save on this device' }).click();
    await expect(receiver.getByRole('heading', { name: 'Your records are here.' })).toBeVisible();
    await page.bringToFront();
    await page.waitForURL(`${NEW_ADDRESS}${paymentsPath}`);
    await expect(page.getByRole('table', { name: 'Payments' })).toContainText('321.00');
  });
});
