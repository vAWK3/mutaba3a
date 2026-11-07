import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A } from '../../support/portal';
import { BAKERY, ClientBooksApi, RANA, RENT, STUDIO } from '../../support/clientBooksApi';

/**
 * MUT-562 (layout C): the accountant's Client books desk on MUT-575's routes, over an in-memory API. The list, the
 * empty state, a client's book (read-only, whole-month periods, type filter, totals per currency), a row's receipt,
 * and a client whose owner stopped sharing. Downloads wait for MUT-314.
 */

const PHONE = { width: 375, height: 812 };

test('Client books lists every client book, and an ended one fades until removed', { tag: '@portal.client-books.list' }, async ({ page, step }) => {
  const api = new ClientBooksApi();

  await step('Open Client books from the corner', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await page.getByRole('link', { name: 'Client books' }).click();
    await expect(page).toHaveURL(/\/client-books$/);
    const rows = page.getByRole('table', { name: 'Client books' }).getByRole('row');
    await expect(rows.nth(1)).toContainText('Rana Haddad');
    await expect(rows.nth(1)).toContainText('Studio');
    await expect(rows.nth(1)).toContainText('23');
    await expect(page.getByRole('navigation', { name: 'Client books or my books' })).toBeVisible();
  });

  await step('See an ended client, Remove it and confirm', async () => {
    const ended = page.getByRole('table', { name: 'Client books' }).getByRole('row').filter({ hasText: 'Bakery' });
    await expect(ended).toHaveClass(/hp-row-ended/);
    await expect(ended).toContainText('No longer shared');
    await ended.getByRole('button', { name: 'Remove Bakery from your client books' }).click();
    await ended.getByRole('group').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('table', { name: 'Client books' }).getByText('Bakery')).toHaveCount(0);
    expect(api.calls('DELETE', `/v1/clients/${BAKERY}`)).toHaveLength(1);
  });

  await step('Open it in Arabic at 375 px', async () => {
    await page.setViewportSize(PHONE);
    const arabic = new ClientBooksApi();
    await arabic.open(page, '/client-books', 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'دفاتر العملاء' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'Client books, Arabic, 375');
  });
});

test('With no client books, the desk says how a client invites you', { tag: '@portal.client-books.empty' }, async ({ page, step }) => {
  await step('Open Client books with no clients', async () => {
    const api = new ClientBooksApi({ clients: [] });
    await api.open(page, '/client-books');
    await expect(page.getByRole('heading', { name: 'No client books yet' })).toBeVisible();
    await expect(page.getByText(/invite you from MTB3A › their profile › Sharing/)).toBeVisible();
  });
});

test('A client book reads one client, read-only, by whole months and type', { tag: '@portal.client-books.client' }, async ({ page, step }) => {
  const api = new ClientBooksApi();

  await step('Open Rana Haddad · Studio', async () => {
    await api.open(page, `/client-books/${STUDIO}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad · Studio' })).toBeVisible();
    await expect(page.getByText(/Read-only · since/)).toBeVisible();
    const totals = page.getByRole('region', { name: /Totals for/ });
    await expect(totals.getByText('Spent')).toHaveCount(2);
    await expect(page.getByRole('table', { name: 'Entries' }).getByText('Office rent')).toBeVisible();
    const feed = api.calls('GET', '/v1/profile-entries').at(-1)!;
    expect(feed.headers['x-mutaba3a-profile']).toBe(STUDIO);
    expect(feed.query.getAll('kinds')).toEqual(['expense', 'received']);
  });

  await step('Pick this quarter', async () => {
    await page.getByRole('radio', { name: 'This quarter' }).click();
    await expect(page).toHaveURL(/preset=quarter/);
    const feed = api.calls('GET', '/v1/profile-entries').at(-1)!;
    expect(feed.query.get('occurredFrom')).toMatch(/-01$/);
  });

  await step('Show income only', async () => {
    await page.getByRole('checkbox', { name: 'Expenses' }).uncheck();
    await expect(page).toHaveURL(/kind=income/);
    await expect(page.getByRole('table', { name: 'Entries' }).getByText('Brand identity')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Entries' }).getByText('Office rent')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Expenses' }).check();
  });

  await step('Only with a receipt', async () => {
    await page.getByRole('checkbox', { name: 'Only with a receipt' }).check();
    await expect(page).toHaveURL(/receipts=only/);
    await expect(page.getByRole('table', { name: 'Entries' }).getByText('Office rent')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Entries' }).getByText('Brand identity')).toHaveCount(0);
  });

  await step('Look for write controls, and try a drawer key in the address', async () => {
    await expect(page.getByRole('button', { name: /add|new|edit|delete/i })).toHaveCount(0);
    await page.goto(`/client-books/${STUDIO}?newExpense=1&newIncome=true`);
    await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad · Studio' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(api.log.filter((call) => call.method !== 'GET' && call.headers['x-mutaba3a-profile'] === STUDIO)).toEqual([]);
  });
});

test("A row's receipt opens in a pane, previewed inline", { tag: '@portal.client-books.receipt' }, async ({ page, step }) => {
  const api = new ClientBooksApi();

  await step("Open a row's receipt", async () => {
    await api.open(page, `/client-books/${STUDIO}`);
    await page.getByRole('table', { name: 'Entries' }).getByRole('button', { name: 'Office rent' }).click();
    const pane = page.getByRole('dialog', { name: 'Receipt' });
    await expect(pane.getByRole('img', { name: /rent.png/ })).toBeVisible();
    expect(api.calls('GET', `/v1/expenses/${RENT}/receipts/88888888-8888-4888-8888-888888888888/download`)[0]!.query.get('disposition')).toBe('inline');
  });

  await step('Download the receipt', async () => {
    await page.getByRole('dialog', { name: 'Receipt' }).getByRole('button', { name: 'Download receipt' }).click();
    await expect.poll(() => api.calls('GET', `/v1/expenses/${RENT}/receipts/88888888-8888-4888-8888-888888888888/download`).some((c) => c.query.get('disposition') === null)).toBe(true);
  });

  await step('The pane is a sheet at 375 px', async () => {
    await page.setViewportSize(PHONE);
    await api.open(page, `/client-books/${STUDIO}?entry=${RENT}`);
    await expect(page.getByRole('dialog', { name: 'Receipt' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Receipt pane, 375');
  });
});

test('When the owner stops sharing, the book says so and the list shows the faded row', { tag: '@portal.client-books.revoked' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ clients: [{ ...RANA }] });

  await step('Read after the owner stops', async () => {
    await api.open(page, `/client-books/${STUDIO}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad · Studio' })).toBeVisible();
    api.revoked = true;
    await page.getByRole('radio', { name: 'This year' }).click();
    await expect(page.getByRole('heading', { name: 'No longer shared' })).toBeVisible();
    await expect(page.getByText('Rana Haddad stopped sharing Studio with you.', { exact: false })).toBeVisible();
  });

  await step('Back to Client books', async () => {
    await page.getByRole('link', { name: 'Back to Client books' }).click();
    const row = page.getByRole('table', { name: 'Client books' }).getByRole('row').filter({ hasText: 'Studio' });
    await expect(row).toContainText('No longer shared');
  });
});

test('A client book downloads its period: the Excel report and the receipts, and a row its last month', { tag: '@portal.client-books.download' }, async ({ page, step }) => {
  const api = new ClientBooksApi();

  await step('Open Download on a client book for months July to September', async () => {
    await api.open(page, `/client-books/${STUDIO}?preset=custom&from=2026-07&to=2026-09`);
    await page.getByRole('button', { name: 'Download' }).click();
    await expect(page.getByText('12 entries')).toBeVisible();
    await expect(page.getByText('11 receipts · about 4 MB')).toBeVisible();
    const mints = api.calls('GET', '/v1/period-downloads/ticket');
    expect(mints.map((m) => [m.query.get('type'), m.query.get('from'), m.query.get('to')])).toEqual([
      ['report', '2026-07', '2026-09'],
      ['receipts', '2026-07', '2026-09'],
    ]);
    expect(new Set(mints.map((m) => m.query.get('asOf'))).size).toBe(1);
  });

  await step('Download the Excel report', async () => {
    await page.getByRole('button', { name: 'Excel report' }).click();
    await expect.poll(() => api.streamed.length).toBe(1);
    expect(api.streamed[0]!.ticket).toMatch(/^report-ticket/);
    await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad · Studio' })).toBeVisible();
  });

  await step('Over the zip cap, Receipts is off with a hint', async () => {
    const capped = new ClientBooksApi({ zipTooLarge: true });
    await capped.open(page, `/client-books/${STUDIO}`);
    await page.getByRole('button', { name: 'Download' }).click();
    await expect(page.getByText('Too large for one download. Pick a shorter period.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Receipts (zip)' })).toBeDisabled();
  });

  await step("Download a row's last month from the list", async () => {
    const list = new ClientBooksApi();
    await list.open(page, '/client-books');
    await page.getByRole('button', { name: /^Download the Excel report for .*, Studio$/ }).click();
    await expect.poll(() => list.streamed.length).toBe(1);
    const mint = list.calls('GET', '/v1/period-downloads/ticket')[0]!;
    expect(mint.query.get('type')).toBe('report');
    expect(mint.query.get('from')).toBe(mint.query.get('to'));
  });
});
