import fs from 'node:fs';
import type { Page } from '@playwright/test';
import JSZip from 'jszip';
import { test, expect } from '../../support/qa';
import { MODE_KEY, OFFICE_A, customer, office, signedOutServer } from '../../support/portal';
import { FakeApi, payment } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * The portal signed out, on this device (MUT-286, ADR-097). Nothing is
 * stubbed but the server's one answer: every /v1 request is a 401, as the API
 * gives with nobody signed in. Everything else is the real local backend, the
 * server's own routes running in the page over this browser's IndexedDB.
 */

async function openPayments(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Paid' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Paid' })).toBeVisible();
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

/** Clear this site's data: both local databases (records and, since MUT-287, receipt files), from a same-origin page that doesn't run the app, so nothing holds them open. */
async function clearSiteData(page: Page) {
  const script = await page.locator('script[type="module"]').first().getAttribute('src');
  await page.goto(script ?? '/');
  await page.evaluate(() =>
    Promise.all(
      ['mut-local', 'mut-local-blobs'].map(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          }),
      ),
    ),
  );
}

/** PUBLIC_FX_PATH (src/hosted/local/fxSource.ts): the one request signed-out mode sends for the ≈ line. */
/** hosted.expenses.drawer.receipts.downloadFailed (src/hosted/i18n/en.json). */
const DOWNLOAD_FAILED = "Couldn't prepare the download. Try again.";
const PUBLIC_FX = '**/v1/public/fx-rates';
/** FX_MEMORY_KEY (src/hosted/local/fxSource.ts): the last public snapshot this device read, reused for an hour. */
const FX_MEMORY_KEY = 'mut-local-fx';
// Dated yesterday: the local backend refuses a snapshot older than MAX_RATE_AGE_DAYS, so a fixed date goes stale.
const RATE_DAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
const PUBLIC_FX_SNAPSHOT = { rateDate: RATE_DAY.toISOString().slice(0, 10), perEur: { USD: 1.1208, ILS: 3.4769 }, fetchedAt: new Date().toISOString(), source: 'live' };
/** How the ≈ line names that date in English, e.g. "Oct 17, 2026". */
const RATE_DAY_LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(RATE_DAY);

/** One of the four destinations (MUT-424): its page is titled with the tab's word. */
async function openSection(page: Page, destination: 'Owed' | 'Paid' | 'Spent' | 'Clients') {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: destination }).click();
  await expect(page.getByRole('heading', { level: 1, name: destination })).toBeVisible();
}

/** A page one level in (MUT-424): the destination, then its row at the bottom of the page. */
async function openOneLevelIn(page: Page, destination: 'Owed' | 'Paid' | 'Clients', row: string, heading: string) {
  await openSection(page, destination);
  await page.getByRole('navigation', { name: `More in ${destination}` }).getByRole('link', { name: new RegExp(`^${row}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

/** Record an expense from the Expenses list. The first real category: a local person's categories are seeded in its language. */
async function recordExpense(page: Page, { amount, title, currency }: { amount: string; title: string; currency?: string }) {
  await page.getByRole('button', { name: 'Record expense' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Record expense' });
  await drawer.getByLabel('Amount').fill(amount);
  if (currency) await drawer.getByLabel('Currency').selectOption(currency);
  await drawer.getByLabel('Category').selectOption({ index: 1 });
  await drawer.getByLabel('Title').fill(title);
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: new RegExp(title) })).toBeVisible();
}

test('A first visit chooses this device on the welcome and opens the app in Arabic, with nothing sent but one check', { tag: '@portal.local.first-visit' }, async ({ page, step }) => {
  const server = await signedOutServer(page, null, null);

  await step('Open the portal for the first time, with nobody signed in, and choose this device on the welcome (MUT-513)', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'جرّبها على هذا الجهاز' }).click();
    await expect(page.getByRole('navigation', { name: 'الأقسام' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'المستحق' })).toBeVisible();
    await expect(page.getByLabel('البريد الإلكتروني')).toHaveCount(0);
  });

  await step('The nav has the same four destinations as signed in (MUT-424)', async () => {
    const links = page.getByRole('navigation', { name: 'الأقسام' }).getByRole('link');
    await expect(links).toHaveText(['المستحق', 'المدفوع', 'المصروف', 'العملاء']);
  });

  await step('You is this device\'s: Sign in, Your data and What is MTB3A?, then Language and the terms, nothing that needs an account', async () => {
    await openYou(page, 'account');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('على هذا الجهاز');
    const rows = page.getByRole('main').locator('.hp-you-row');
    await expect(rows).toHaveText(['تسجيل الدخول', /^بياناتك/, 'ما هي متابعة؟']);
    // MUT-324: the terms are a link in either mode; MUT-425: on You › App, beside the language
    await openYou(page, 'app');
    await expect(rows).toHaveText([/^اللغة/, /^شروط الخدمة/]);
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

  await step('Nothing reached the server (this browser chose this device already, MUT-513)', async () => {
    expect(server.requests).toEqual([]);
  });
});

test('Signed out, add a client from the picker, record money owed and part of it paid, reload, and both are there', { tag: '@portal.local.owed-part-paid' }, async ({ page, step }) => {
  const server = await signedOutServer(page);
  const table = page.getByRole('table', { name: 'Receivables' });
  const row = () => table.getByRole('row', { name: /Ramallah Bakery/ });

  await step('Open Receivables signed out', async () => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Owed' }).click();
    await page.getByRole('navigation', { name: 'More in Owed' }).getByRole('link', { name: /^Receivables/ }).click();
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

  await step('Nothing reached the server (this browser chose this device already, MUT-513)', async () => {
    expect(server.requests).toEqual([]);
  });
});

test('Signed out, add a client and a matter from the pickers, record money owed on the matter, reload, and both are there', { tag: '@portal.local.matter-owed' }, async ({ page, step }) => {
  const server = await signedOutServer(page);
  const table = page.getByRole('table', { name: 'Receivables' });
  const row = () => table.getByRole('row', { name: /Ramallah Bakery/ });

  await step('Open Receivables signed out', async () => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Owed' }).click();
    await page.getByRole('navigation', { name: 'More in Owed' }).getByRole('link', { name: /^Receivables/ }).click();
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

  await step('Nothing reached the server (this browser chose this device already, MUT-513)', async () => {
    expect(server.requests).toEqual([]);
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

test('Download my records, clear the site\'s data, restore the file, and every record and receipt is back', { tag: '@portal.local.download-restore' }, async ({ page, step }) => {
  await signedOutServer(page);
  let file = '';

  await step('Add 75.00 received', async () => {
    await openPayments(page);
    await addReceived(page, '75.00');
    await expect(paymentsTable(page)).toContainText('75.00');
  });

  await step('Record an expense, Ink, with a PDF receipt', async () => {
    await openSection(page, 'Spent');
    await recordExpense(page, { amount: '30.00', title: 'Ink' });
    await page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Ink/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit expense' });
    await drawer.locator('input[type="file"]').setInputFiles({ name: 'ink.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ink') });
    await expect(drawer.getByRole('listitem').filter({ hasText: 'ink.pdf' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  await step('Open Your data and download my records', async () => {
    await openYou(page, 'account');
    await youRow(page, 'Your data').click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Download my records' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^mtb3a-records-\d{4}-\d{2}-\d{2}\.zip$/);
    file = await download.path();
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    expect(JSON.parse(await zip.file('records.json')!.async('string')).kind).toBe('mutaba3a-local-records');
    const receipts = zip.file(/^receipts\//);
    expect(receipts).toHaveLength(1);
    expect(await receipts[0]!.async('string')).toBe('%PDF-1.4 ink');
  });

  await step('Clear this site\'s data, then open the portal again: the payment is gone', async () => {
    await clearSiteData(page);
    await openPayments(page);
    await expect(page.getByText('75.00')).toHaveCount(0);
  });

  await step('Restore the downloaded file and replace: the payment is back', async () => {
    await openYou(page, 'account');
    await youRow(page, 'Your data').click();
    await page.getByTestId('your-data-file').setInputFiles(file);
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Replace everything on this device with the 2 records in this file?');
    await confirm.getByRole('button', { name: 'Replace' }).click();
    await expect(page.getByText('Records restored.')).toBeVisible();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Paid' }).click();
    await expect(paymentsTable(page)).toContainText('75.00');
  });

  await step('The expense\'s receipt downloads again, byte for byte', async () => {
    await openSection(page, 'Spent');
    await page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Ink/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit expense' });
    const [download] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('ink.pdf');
    expect(fs.readFileSync(await download.path(), 'utf8')).toBe('%PDF-1.4 ink');
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

  await step('The session ends on the server; open Owed', async () => {
    api.signedIn = false;
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Owed' }).click();
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
    // The island names this device's own profile now (MUT-426)
    await expect(page.locator('.hp-island')).toHaveAttribute('aria-label', /^You · /);
    await expect(page.getByText('PAY-0001')).toHaveCount(0);
    await expect(page.getByText('Nour Studio')).toHaveCount(0);
  });
});

test('Signed out, record an expense, attach a PDF receipt, reload, and download it by its name', { tag: '@portal.local.expense-receipt' }, async ({ page, step }) => {
  const server = await signedOutServer(page);
  const drawer = page.getByRole('dialog', { name: 'Edit expense' });
  const receipt = '%PDF-1.4 taxi receipt';

  await step('Open Expenses signed out and record 45.00, Taxi to court', async () => {
    await page.goto('/');
    await openSection(page, 'Spent');
    await recordExpense(page, { amount: '45.00', title: 'Taxi to court' });
  });

  await step('Open it and attach taxi-receipt.pdf', async () => {
    await page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Taxi to court/ }).click();
    await drawer.locator('input[type="file"]').setInputFiles({ name: 'taxi-receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from(receipt) });
    await expect(drawer.getByRole('listitem').filter({ hasText: 'taxi-receipt.pdf' })).toBeVisible();
  });

  await step('Reload, open the expense again, and download the receipt', async () => {
    await page.reload();
    await expect(drawer.getByRole('listitem').filter({ hasText: 'taxi-receipt.pdf' })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('taxi-receipt.pdf');
    expect(fs.readFileSync(await download.path(), 'utf8')).toBe(receipt);
  });

  await step('Nothing reached the server (this browser chose this device already, MUT-513)', async () => {
    expect(server.requests).toEqual([]);
  });
});

test('Signed out and online, a trip group in two currencies shows the ≈ line; offline it hides', { tag: '@portal.local.fx-line' }, async ({ page, step }) => {
  const server = await signedOutServer(page);
  let online = true;
  await page.context().route(PUBLIC_FX, async (route) => {
    server.requests.push(`GET ${new URL(route.request().url()).pathname}`);
    if (online) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PUBLIC_FX_SNAPSHOT) });
    else await route.abort('internetdisconnected');
  });

  await step('Record 40.00 USD and 120.00 ILS today', async () => {
    await page.goto('/');
    await openSection(page, 'Spent');
    await recordExpense(page, { amount: '40.00', title: 'Airport taxi', currency: 'USD' });
    await recordExpense(page, { amount: '120.00', title: 'Hotel night', currency: 'ILS' });
  });

  await step('Create a group from today, Amman trip, and land on it', async () => {
    await page.getByRole('navigation', { name: 'Expenses pages' }).getByRole('link', { name: 'Groups' }).click();
    await page.getByRole('button', { name: 'New group' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New group' });
    await drawer.getByLabel('Name').fill('Amman trip');
    await drawer.getByLabel('Still going (no end date yet)').check();
    await drawer.getByRole('button', { name: 'Create group' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Amman trip' })).toBeVisible();
  });

  await step('The headline keeps both currencies and the ≈ line names the ECB rate date', async () => {
    const headline = page.getByRole('group', { name: 'Total spent' });
    await expect(headline).toContainText('$40.00');
    await expect(headline).toContainText('120.00');
    await expect(page.getByText(`at today's ECB rate (${RATE_DAY_LABEL})`, { exact: false })).toBeVisible();
  });

  await step('Go offline and reload: the ≈ line stays, from the rates this device remembers', async () => {
    online = false;
    await page.reload();
    await expect(page.getByRole('group', { name: 'Total spent' })).toContainText('$40.00');
    await expect(page.getByText(`at today's ECB rate (${RATE_DAY_LABEL})`, { exact: false })).toBeVisible();
  });

  await step('On a device that remembers no rates, offline: the ≈ line hides and the totals stay', async () => {
    await page.evaluate((key) => localStorage.removeItem(key), FX_MEMORY_KEY);
    await page.reload();
    await expect(page.getByRole('group', { name: 'Total spent' })).toContainText('$40.00');
    await expect(page.getByText(/at today's ECB rate/)).toHaveCount(0);
  });

  await step('Only the public rates reached the server', async () => {
    expect([...new Set(server.requests)]).toEqual(['GET /v1/public/fx-rates']);
  });
});

test('Signed out, log a conversion, reload, and edit it', { tag: '@portal.local.conversion' }, async ({ page, step }) => {
  const server = await signedOutServer(page);
  const table = page.getByRole('table', { name: 'Conversions' });

  await step('Open Conversions signed out and log 1000 USD to 3700 ILS', async () => {
    await page.goto('/');
    await openOneLevelIn(page, 'Paid', 'Currency conversions', 'Conversions');
    await page.getByRole('button', { name: 'Log conversion' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Log conversion' });
    await drawer.getByLabel('From amount').fill('1000');
    await drawer.getByLabel('From currency').selectOption('USD');
    await drawer.getByLabel('To amount').fill('3700');
    await drawer.getByLabel('Notes').fill('Rent transfer');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toBeHidden();
    await expect(table.getByRole('row', { name: /Rent transfer/ })).toBeVisible();
  });

  await step('Reload, open it, change the to amount to 3650 and save', async () => {
    await page.reload();
    await table.getByRole('row', { name: /Rent transfer/ }).getByRole('button').first().click();
    const drawer = page.getByRole('dialog', { name: 'Edit conversion' });
    await expect(drawer.getByLabel('To amount')).toHaveValue('3700.00');
    await drawer.getByLabel('To amount').fill('3650');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toBeHidden();
    await expect(table.getByRole('row', { name: /Rent transfer/ })).toContainText('3,650.00');
  });

  await step('Nothing reached the server (this browser chose this device already, MUT-513)', async () => {
    expect(server.requests).toEqual([]);
  });
});

test('Signed out, Documents opens on its empty state, not an error', { tag: '@portal.local.documents-empty' }, async ({ page, step }) => {
  const server = await signedOutServer(page);

  await step('Open Documents signed out', async () => {
    await page.goto('/');
    await openOneLevelIn(page, 'Clients', 'Documents', 'Documents');
  });

  await step('It says there are no documents yet, with no error', async () => {
    await expect(page.getByRole('heading', { name: 'No documents on this profile yet' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(server.requests).toEqual([]);
  });
});

test('Restore an older backup without receipt files: the confirm says which receipts will have no file', { tag: '@portal.local.restore-missing-receipts' }, async ({ page, step }) => {
  await signedOutServer(page);
  let file = '';

  await step('Record an expense, Ink, with a PDF receipt', async () => {
    await page.goto('/');
    await openSection(page, 'Spent');
    await recordExpense(page, { amount: '30.00', title: 'Ink' });
    await page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Ink/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit expense' });
    await drawer.locator('input[type="file"]').setInputFiles({ name: 'ink.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ink') });
    await expect(drawer.getByRole('listitem').filter({ hasText: 'ink.pdf' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  await step('Keep only records.json from the download, as an older .json backup holds no receipt files', async () => {
    await openYou(page, 'account');
    await youRow(page, 'Your data').click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Download my records' }).click();
    const zip = await JSZip.loadAsync(fs.readFileSync(await (await downloading).path()));
    file = `${await (await downloading).path()}.json`;
    fs.writeFileSync(file, await zip.file('records.json')!.async('string'));
  });

  await step('Clear this site\'s data and restore that .json', async () => {
    await clearSiteData(page);
    await page.goto('/');
    await openYou(page, 'account');
    await youRow(page, 'Your data').click();
    await page.getByTestId('your-data-file').setInputFiles(file);
  });

  await step('Before anything is replaced, the confirm says the receipt file is missing', async () => {
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText("1 receipt file isn't in this file. That receipt will be restored without its file.");
    await confirm.getByRole('button', { name: 'Replace' }).click();
    await expect(page.getByText('Records restored.')).toBeVisible();
  });

  await step('The expense and its receipt are back; the receipt has no file to download', async () => {
    await openSection(page, 'Spent');
    await page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Ink/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit expense' });
    await expect(drawer.getByRole('listitem').filter({ hasText: 'ink.pdf' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Download' }).click();
    await expect(page.getByText(DOWNLOAD_FAILED)).toBeVisible();
  });
});

