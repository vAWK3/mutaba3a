import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';

/**
 * MUT-291: records carried from the old web app (and from the old address) to the new address, across three real
 * browser origins (qa/support/carry-over.mjs): the old web app, the portal as the old address, the portal as the new
 * one. Every /v1 request is answered here as the API answers nobody signed in (401), so both portals run signed out
 * on the real local backend; the carry-over itself is real end to end: the pop-up, the messages, the server's rules
 * replayed in the page, the totals check, Restore.
 */

const OLD_APP = 'http://127.0.0.1:5183';
const OLD_ADDRESS = 'http://127.0.0.1:5187';
const NEW_ADDRESS = 'http://127.0.0.1:5188';

/** PORTAL_LANGUAGE_KEY (src/hosted/i18n/HostedLanguageProvider.tsx), and the free app's LANGUAGE_STORAGE_KEY / LANGUAGE_CHOSEN_KEY. */
const LANGUAGE_KEYS: Array<[string, string]> = [
  ['mutaba3a-portal-language', 'en'],
  ['mutaba3a-language', 'en'],
  ['mutaba3a-language-chosen', '1'],
];

/** Nobody signed in, everywhere, in English. */
async function signedOutInEnglish(context: BrowserContext) {
  await context.route('**/v1/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) }));
  await context.addInitScript((keys) => keys.forEach(([key, value]) => localStorage.setItem(key, value)), LANGUAGE_KEYS);
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * The old web app's own database, written through its own Dexie module (the dev server serves it), from its landing
 * page so the app's gate hasn't run yet: a business with a client, money received, money still owed, an expense
 * from a saved vendor and a recurring expense rule.
 */
async function oldAppWithRecords(page: Page) {
  await page.goto(`${OLD_APP}/`);
  await page.evaluate(
    async ({ received, owed, spent }) => {
      const { db } = await import('/src/db/database.ts');
      const at = new Date().toISOString();
      const stamps = { createdAt: at, updatedAt: at };
      await db.businessProfiles.add({ id: 'qa-b1', name: 'QA Studio', defaultCurrency: 'ILS', isDefault: true, ...stamps });
      await db.clients.add({ id: 'qa-c1', name: 'Amman Studio', profileId: 'qa-b1', ...stamps });
      await db.transactions.bulkAdd([
        { id: 'qa-t1', kind: 'income', status: 'paid', title: 'Logo', amountMinor: 10_000, currency: 'ILS', occurredAt: received, paidAt: received, clientId: 'qa-c1', profileId: 'qa-b1', ...stamps },
        { id: 'qa-t2', kind: 'income', status: 'unpaid', title: 'Website', amountMinor: 25_000, currency: 'USD', occurredAt: owed, clientId: 'qa-c1', profileId: 'qa-b1', ...stamps },
      ]);
      await db.paymentRecords.add({ id: 'qa-r1', transactionId: 'qa-t1', amountMinor: 10_000, paidAt: received, ...stamps });
      await db.vendors.add({ id: 'qa-v1', profileId: 'qa-b1', canonicalName: 'Office Depot', aliases: [], ...stamps });
      await db.expenses.add({ id: 'qa-e1', profileId: 'qa-b1', vendorId: 'qa-v1', title: 'Paper', amountMinor: 2_500, currency: 'ILS', occurredAt: spent, ...stamps });
      await db.recurringRules.add({ id: 'qa-rr1', profileId: 'qa-b1', title: 'Rent', amountMinor: 100_000, currency: 'ILS', frequency: 'monthly', startDate: spent, endMode: 'noEnd', isPaused: false, ...stamps });
    },
    { received: daysAgo(20), owed: daysAgo(10), spent: daysAgo(5) },
  );
}

/** The new address's summary, for the records just carried. */
async function expectCarriedSummary(receiver: Page) {
  await expect(receiver.getByRole('heading', { name: 'Your records from the old app' })).toBeVisible();
  const counts = receiver.getByTestId('carry-over-counts');
  await expect(counts).toContainText('Clients1');
  await expect(counts).toContainText('Expenses1');
  const totals = receiver.getByTestId('carry-over-totals');
  await expect(totals.locator('tr[data-currency="ILS"] td[data-field="paid"]')).toContainText('100.00');
  await expect(totals.locator('tr[data-currency="ILS"] td[data-field="expenses"]')).toContainText('25.00');
  await expect(totals.locator('tr[data-currency="USD"] td[data-field="outstanding"]')).toContainText('250.00');
}

test('The old web app\'s records arrive on the new address with the same totals, and the summary lists what didn\'t come', { tag: '@carry-over.carry.free-app' }, async ({ page, step }) => {
  await signedOutInEnglish(page.context());

  await step('In the old web app, have a business with a client, money received and owed, an expense, a saved vendor and a recurring rule', async () => {
    await oldAppWithRecords(page);
  });

  await step('Open the old app: it asks first, naming how many records this browser holds', async () => {
    await page.goto(`${OLD_APP}/app/`);
    await expect(page.getByRole('heading', { name: 'MTB3A has a new address' })).toBeVisible();
    await expect(page.getByText(/This browser holds 4 records from this app/)).toBeVisible();
  });

  let receiver!: Page;
  await step('Choose Carry my records over', async () => {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Carry my records over' }).click();
    receiver = await popup;
  });

  await step('On the new address, check the counts and the totals per currency', async () => {
    await expectCarriedSummary(receiver);
  });

  await step('Open Not carried: the saved vendor list and the recurring rule are listed', async () => {
    const notCarried = receiver.getByTestId('carry-over-not-carried');
    await notCarried.locator('summary').click();
    await expect(notCarried.locator('li[data-code="vendors"]')).toBeVisible();
    await expect(notCarried.locator('li[data-code="recurring-rules"]')).toBeVisible();
  });

  await step('Choose Save on this device', async () => {
    await receiver.getByRole('button', { name: 'Save on this device' }).click();
    await expect(receiver.getByRole('heading', { name: 'Your records are here.' })).toBeVisible();
  });

  await step('Back in the old app: the records are on the new address; keep using it, under the banner', async () => {
    await page.bringToFront();
    await expect(page.getByText('Your records are on the new address.')).toBeVisible();
    await expect(page.getByTestId('carry-over-arrived')).toContainText('Arrived: clients 1, income entries 2, expenses 1.');
    await page.getByRole('button', { name: 'Keep using the old app for now' }).click();
    await expect(page.getByTestId('carry-over-banner')).toContainText("Changes you make here won't follow.");
  });
});

test('When the new address can\'t be reached, the old app\'s records file restores on the new address with the same summary', { tag: '@carry-over.carry.fallback' }, async ({ page, step }, testInfo) => {
  await signedOutInEnglish(page.context());
  await page.context().addInitScript((origin) => {
    // A browser that blocks the pop-up, on the old app's origin only.
    if (window.location.origin === origin) window.open = () => null;
  }, OLD_APP);

  await step('Have records in the old web app, in a browser that blocks the pop-up', async () => {
    await oldAppWithRecords(page);
    await page.goto(`${OLD_APP}/app/`);
  });

  await step('Choose Carry my records over: the new page can\'t be reached', async () => {
    await page.getByRole('button', { name: 'Carry my records over' }).click();
    await expect(page.getByRole('alert')).toContainText("The new page couldn't be reached.");
    await expect(page.getByRole('link', { name: 'Open the new address' })).toHaveAttribute('href', `${NEW_ADDRESS}/carry-over/receive`);
  });

  const file = testInfo.outputPath('free-app-backup.json');
  await step('Download my records file', async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my records file' }).click();
    await (await download).saveAs(file);
  });

  await step('On the new address, choose that file: the same counts and totals, before Save', async () => {
    await page.goto(`${NEW_ADDRESS}/carry-over/receive`);
    await expect(page.getByRole('heading', { name: 'Bring your records from a file' })).toBeVisible();
    await page.getByTestId('carry-over-file').setInputFiles(file);
    await expectCarriedSummary(page);
    await expect(page.getByRole('button', { name: 'Save on this device' })).toBeVisible();
  });
});

test('Keep using the old app opens it for now, and the next visit asks again', { tag: '@carry-over.carry.keep-old' }, async ({ page, step }) => {
  await signedOutInEnglish(page.context());

  await step('Have records in the old web app', async () => {
    await oldAppWithRecords(page);
  });

  await step('Open it and choose Keep using the old app for now: it opens with its records', async () => {
    await page.goto(`${OLD_APP}/app/`);
    await page.getByRole('button', { name: 'Keep using the old app for now' }).click();
    await expect(page.getByTestId('carry-over-screen')).toBeHidden();
    await expect(page.getByRole('navigation').first()).toBeVisible();
  });

  await step('Open the old app again in a new tab: it asks again', async () => {
    const tab = await page.context().newPage();
    await tab.goto(`${OLD_APP}/app/`);
    await expect(tab.getByRole('heading', { name: 'MTB3A has a new address' })).toBeVisible();
  });
});

test('Carrying into a device that already has records warns, offers a download first, and replaces only on a second confirm', { tag: '@carry-over.carry.replace-existing' }, async ({ page, step }) => {
  await signedOutInEnglish(page.context());

  await step('Have records on the new address already', async () => {
    await page.goto(`${NEW_ADDRESS}/`);
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Payments' }).click();
    await page.getByRole('button', { name: '+ Add income' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('radio', { name: 'Received' }).click();
    await drawer.getByLabel('Amount').fill('99.00');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toBeHidden();
  });

  await step('Carry the old web app\'s records over', async () => {
    await oldAppWithRecords(page);
    await page.goto(`${OLD_APP}/app/`);
  });
  let receiver!: Page;
  await step('Choose Carry my records over', async () => {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Carry my records over' }).click();
    receiver = await popup;
    await expectCarriedSummary(receiver);
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
    await receiver.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Payments' }).click();
    await expect(receiver.getByRole('table', { name: 'Payments' })).toContainText('100.00');
    await expect(receiver.getByText('99.00')).toHaveCount(0);
  });
});

test('The old address\'s signed-out records go to the new address, and the old link\'s page opens there', { tag: '@carry-over.carry.portal-host' }, async ({ page, step }) => {
  await signedOutInEnglish(page.context());

  let paymentsPath = '';
  await step('Signed out on the old address, add money received', async () => {
    await page.goto(`${OLD_ADDRESS}/`);
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Payments' }).click();
    await page.getByRole('button', { name: '+ Add income' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('radio', { name: 'Received' }).click();
    await drawer.getByLabel('Amount').fill('321.00');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toBeHidden();
    paymentsPath = new URL(page.url()).pathname;
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

test('Opening the old app with nothing in it goes straight to the new address', { tag: '@carry-over.carry.empty' }, async ({ page, step }) => {
  await signedOutInEnglish(page.context());

  await step('Open the old web app in a browser with nothing in it: the new address opens', async () => {
    await page.goto(`${OLD_APP}/app/`);
    await page.waitForURL(`${NEW_ADDRESS}/**`);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  });
});

test('From a home-screen install, the old app leads with the file, which restores on the new address', { tag: '@carry-over.carry.installed' }, async ({ page, step }, testInfo) => {
  await signedOutInEnglish(page.context());
  await page.context().addInitScript((origin) => {
    // Opened from the home screen: display-mode is standalone, on the old app's origin.
    if (window.location.origin !== origin) return;
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query === '(display-mode: standalone)' ? ({ ...real(query), matches: true } as MediaQueryList) : real(query));
  }, OLD_APP);

  await step('Have records in the old web app, opened from the home screen', async () => {
    await oldAppWithRecords(page);
    await page.goto(`${OLD_APP}/app/`);
  });

  await step('The old app explains the file path and offers no one-click carry-over', async () => {
    await expect(page.getByTestId('carry-over-installed')).toContainText('You opened MTB3A from your home screen.');
    await expect(page.getByRole('button', { name: 'Carry my records over' })).toHaveCount(0);
  });

  const file = testInfo.outputPath('free-app-backup.json');
  await step('Download my records file', async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my records file' }).click();
    await (await download).saveAs(file);
  });

  await step('On the new address, choose that file and save', async () => {
    await page.goto(`${NEW_ADDRESS}/carry-over/receive`);
    await page.getByTestId('carry-over-file').setInputFiles(file);
    await expectCarriedSummary(page);
    await page.getByRole('button', { name: 'Save on this device' }).click();
    await expect(page.getByRole('heading', { name: 'Your records are here.' })).toBeVisible();
  });
});
