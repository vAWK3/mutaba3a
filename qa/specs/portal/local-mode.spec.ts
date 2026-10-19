import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { MODE_KEY, OFFICE_A, customer, office } from '../../support/portal';
import { FakeApi, payment } from '../../support/portalApi';

/**
 * The portal signed out, on this device (MUT-286, ADR-097). Nothing is
 * stubbed but the server's one answer: every /v1 request is a 401, as the API
 * gives with nobody signed in. Everything else is the real local backend, the
 * server's own routes running in the page over this browser's IndexedDB.
 */

/** PORTAL_LANGUAGE_KEY in src/hosted/i18n/HostedLanguageProvider.tsx */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

interface Server {
  /** Every /v1 request that reached the "server", as "METHOD /path". */
  requests: string[];
}

/** A browser with nobody signed in: the server answers 401 to everything and counts what it was asked. */
async function signedOutServer(page: Page, language: 'en' | 'ar' | null = 'en'): Promise<Server> {
  const server: Server = { requests: [] };
  await page.context().route('**/v1/**', async (route) => {
    const request = route.request();
    server.requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) });
  });
  if (language) await page.context().addInitScript(([key, value]) => localStorage.setItem(key, value), [PORTAL_LANGUAGE_KEY, language] as const);
  return server;
}

async function openPayments(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Payments' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
}

async function addReceived(page: Page, amount: string) {
  await page.getByRole('button', { name: '+ Add income' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'New income' });
  await drawer.getByRole('radio', { name: 'Received' }).click();
  await drawer.getByLabel('Amount').fill(amount);
  await drawer.getByRole('button', { name: 'Save income' }).click();
  await expect(drawer).toBeHidden();
}

const paymentsTable = (page: Page) => page.getByRole('table', { name: 'Payments' });

test('A first visit opens the app on this device in Arabic, with no sign-in and nothing sent but one check', { tag: '@portal.local.first-visit' }, async ({ page, step }) => {
  const server = await signedOutServer(page, null);

  await step('Open the portal for the first time, with nobody signed in', async () => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'الأقسام' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'نظرة عامة' })).toBeVisible();
    await expect(page.getByLabel('البريد الإلكتروني')).toHaveCount(0);
  });

  await step('The nav has no Expenses or Conversions yet', async () => {
    const links = page.getByRole('navigation', { name: 'الأقسام' }).getByRole('link');
    await expect(links).toHaveText(['نظرة عامة', 'العملاء', 'المستحقات', 'الدفعات', 'المستندات']);
  });

  await step('The account menu is this device\'s: Sign in and Your data, nothing that needs an account', async () => {
    const account = page.getByRole('button', { name: /^الحساب/ });
    await expect(account).toContainText('على هذا الجهاز');
    await account.click();
    const items = page.getByRole('menu', { name: 'الحساب' }).getByRole('menuitem');
    await expect(items).toHaveText(['تسجيل الدخول', 'بياناتك']);
  });

  await step('Only the first-visit check reached the server', async () => {
    expect(server.requests).toEqual(['GET /v1/me']);
  });
});

test('Money received signed out is still there after a reload, and nothing is sent', { tag: '@portal.local.received-persists' }, async ({ page, step }) => {
  const server = await signedOutServer(page);

  await step('Open Payments signed out', async () => {
    await openPayments(page);
  });

  await step('Add 250.00 received', async () => {
    await addReceived(page, '250.00');
    await expect(paymentsTable(page)).toContainText('250.00');
  });

  const profileUrl = page.url();
  await step('Reload: the payment is still there, on the same profile', async () => {
    await page.reload();
    await expect(paymentsTable(page)).toContainText('250.00');
    expect(page.url()).toBe(profileUrl);
  });

  await step('Nothing reached the server after the first-visit check', async () => {
    expect(server.requests).toEqual(['GET /v1/me']);
  });
});

test('Signed out, add a client from the picker, record money owed and part of it paid, reload, and both are there', { tag: '@portal.local.owed-part-paid' }, async ({ page, step }) => {
  const server = await signedOutServer(page);
  const table = page.getByRole('table', { name: 'Receivables' });
  const row = () => table.getByRole('row', { name: /Ramallah Bakery/ });

  await step('Open Receivables signed out', async () => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Receivables' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Receivables' })).toBeVisible();
  });

  await step('Add 900.00 owed by a client nobody has yet: Add client: Ramallah Bakery', async () => {
    await page.getByRole('button', { name: '+ Add income' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('radio', { name: 'Owed' }).click();
    await drawer.getByLabel('Amount').fill('900');
    const client = drawer.getByLabel('Client');
    await client.fill('Ramallah Bakery');
    await drawer.getByRole('option', { name: /Add client.*Ramallah Bakery/ }).click();
    await expect(client).toHaveValue('Ramallah Bakery');
    await drawer.getByLabel('What was it for?').fill('Menu design');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toBeHidden();
    await expect(row()).toContainText('900.00');
  });

  await step('Record a payment of 400.00 on it: Partly paid, 500.00 still owed', async () => {
    await row().getByRole('button', { name: /^Record payment for Ramallah Bakery/ }).click();
    const drawer = page.getByRole('dialog', { name: /Record payment/ });
    await drawer.getByLabel('Amount (ILS)').fill('400');
    await drawer.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row()).toContainText('Partly paid');
    await expect(row().getByRole('button', { name: /^Record payment for Ramallah Bakery, remaining: .*500\.00/ })).toBeVisible();
  });

  await step('Reload: still Partly paid with 500.00 owed, and Clients lists Ramallah Bakery', async () => {
    await page.reload();
    await expect(row()).toContainText('Partly paid');
    await expect(row().getByRole('button', { name: /remaining: .*500\.00/ })).toBeVisible();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Clients' }).click();
    await expect(page.getByRole('main')).toContainText('Ramallah Bakery');
  });

  await step('Nothing reached the server after the first-visit check', async () => {
    expect(server.requests).toEqual(['GET /v1/me']);
  });
});

test('Signed out, add a client and a matter from the pickers, record money owed on the matter, reload, and both are there', { tag: '@portal.local.matter-owed' }, async ({ page, step }) => {
  const server = await signedOutServer(page);
  const table = page.getByRole('table', { name: 'Receivables' });
  const row = () => table.getByRole('row', { name: /Ramallah Bakery/ });

  await step('Open Receivables signed out', async () => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Receivables' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Receivables' })).toBeVisible();
  });

  await step('Add income, Owed, 900.00, Add client: Ramallah Bakery', async () => {
    await page.getByRole('button', { name: '+ Add income' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('radio', { name: 'Owed' }).click();
    await drawer.getByLabel('Amount').fill('900');
    const client = drawer.getByLabel('Client');
    await client.fill('Ramallah Bakery');
    await drawer.getByRole('option', { name: /Add client.*Ramallah Bakery/ }).click();
    await expect(client).toHaveValue('Ramallah Bakery');
  });

  await step('Under More details, type a matter nobody has and press Enter on Add matter: Menu design', async () => {
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('button', { name: /More details/ }).click();
    const matter = drawer.getByLabel('Matter (optional)');
    await matter.fill('Menu design');
    await expect(drawer.getByRole('option', { name: /Add matter.*Menu design/ })).toHaveAttribute('aria-selected', 'true');
    await matter.press('Enter');
    await expect(matter).toHaveValue('Menu design');
    // Saving the pick keeps the keyboard on the field (Apple design review A1)
    await expect(matter).toBeFocused();
  });

  await step('Save: the entry is listed under the client and the matter', async () => {
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toBeHidden();
    await expect(row()).toContainText('900.00');
    await expect(row()).toContainText('Menu design');
  });

  await step('Reload: the entry still names the client and the matter', async () => {
    await page.reload();
    await expect(row()).toContainText('Menu design');
    await expect(row()).toContainText('900.00');
  });

  await step('Nothing reached the server after the first-visit check', async () => {
    expect(server.requests).toEqual(['GET /v1/me']);
  });
});

test('Two tabs on this device see each other\'s saves', { tag: '@portal.local.two-tabs' }, async ({ page, step }) => {
  await signedOutServer(page);
  const other = await page.context().newPage();

  await step('Open Payments in two tabs', async () => {
    await openPayments(page);
    await openPayments(other);
  });

  await step('Add 10.00 received in the first tab: the second tab lists it without a reload', async () => {
    await addReceived(page, '10.00');
    await expect(paymentsTable(other)).toContainText('10.00');
  });

  await step('Add 20.00 received in the second tab: both tabs list both, numbered in turn', async () => {
    await addReceived(other, '20.00');
    for (const tab of [page, other]) {
      await expect(paymentsTable(tab)).toContainText('10.00');
      await expect(paymentsTable(tab)).toContainText('20.00');
      await expect(paymentsTable(tab)).toContainText(/PAY-\d{4}-0002/);
    }
  });
});

test('Download my records, clear the site\'s data, restore the file, and every record is back', { tag: '@portal.local.download-restore' }, async ({ page, step }) => {
  await signedOutServer(page);
  let file = '';

  await step('Add 75.00 received', async () => {
    await openPayments(page);
    await addReceived(page, '75.00');
    await expect(paymentsTable(page)).toContainText('75.00');
  });

  await step('Open Your data and download my records', async () => {
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Your data' }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my records' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^mutaba3a-records-\d{4}-\d{2}-\d{2}\.json$/);
    file = await download.path();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).kind).toBe('mutaba3a-local-records');
  });

  await step('Clear this site\'s data, then open the portal again: the payment is gone', async () => {
    // A same-origin page that doesn't run the app, so nothing holds the database open while it is deleted
    const script = await page.locator('script[type="module"]').first().getAttribute('src');
    await page.goto(script ?? '/');
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase('mut-local');
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    );
    await openPayments(page);
    await expect(page.getByText('75.00')).toHaveCount(0);
  });

  await step('Restore the downloaded file and replace: the payment is back', async () => {
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Your data' }).click();
    await page.getByTestId('your-data-file').setInputFiles(file);
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Replace everything on this device with the 1 record in this file?');
    await confirm.getByRole('button', { name: 'Replace' }).click();
    await expect(page.getByText('Records restored.')).toBeVisible();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Payments' }).click();
    await expect(paymentsTable(page)).toContainText('75.00');
  });
});

test('When a signed-in session ends, the portal offers Sign in or Continue on this device', { tag: '@portal.local.session-expired' }, async ({ page, step }) => {
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 1,
    payments: [payment(1, { customerId: customer(0).id, amount: '400.00', number: 'PAY-0001' })],
  });

  await step('Open Payments signed in', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await expect(paymentsTable(page)).toContainText('PAY-0001');
  });

  await step('The session ends on the server; open Receivables', async () => {
    api.signedIn = false;
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Receivables' }).click();
  });

  await step('Sign-in says so and offers both doors; nothing switched by itself', async () => {
    await expect(page).toHaveURL(/\/sign-in\?/);
    await expect(page.getByRole('note')).toHaveText("You've been signed out. Sign in again to continue.");
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue on this device' })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), MODE_KEY)).toBe('remote');
  });

  await step('Continue on this device: this device\'s own app, with none of the account\'s figures', async () => {
    await page.getByRole('button', { name: 'Continue on this device' }).click();
    await expect(page.getByRole('button', { name: /^Account/ })).toContainText('On this device');
    await expect(page.getByText('PAY-0001')).toHaveCount(0);
    await expect(page.getByText('Nour Studio')).toHaveCount(0);
  });
});
