import { test, expect } from '../../support/qa';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi, STORAGE, category, expense, libraryReceipt } from '../../support/portalApi';

/**
 * Expenses › Receipts (MUT-260, layout B): the receipts library's gallery, upload, the review page with its prefilled
 * expense form, and a filed receipt. The in-memory API (qa/support/portalApi.ts) plays MUT-255's /v1/receipts and
 * the bucket answers at its real origin with real 1×1 images (A8), so an inline original actually renders.
 */

const groceries = category(1, 'Groceries');
const travel = category(2, 'Travel');
const BASE = `/p/${OFFICE_A}/expenses`;

const phoneRead = {
  readerVersion: 'phone-1.4',
  date: { value: '2026-10-24', source: 'qr', confidence: 0.98 },
  totalMinor: { value: '8420', source: 'qr', confidence: 0.98 },
  currency: { value: 'ILS', source: 'qr', confidence: 0.98 },
  vendorName: { value: 'Shufersal', source: 'ocr', confidence: 0.9 },
};

function world() {
  const filedOn = expense(1, { amount: '212.00', vendor: 'Spinneys', occurredOn: '2026-10-20', categoryId: groceries.id });
  return new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    categories: [groceries, travel],
    expenses: [filedOn],
    vendors: [{ name: 'Yellow Cab', categoryId: travel.id }],
    receipts: [
      libraryReceipt(1, { filename: 'shufersal.jpg', mimeType: 'image/jpeg', suggested: phoneRead }),
      libraryReceipt(2, { filename: 'invoice-1182.pdf', mimeType: 'application/pdf', receivedOn: '2026-10-23' }),
      libraryReceipt(3, { filename: 'spinneys.png', mimeType: 'image/png', filingStatus: 'FILED', expenseId: filedOn.id, receivedOn: '2026-10-20' }),
    ],
  });
}

test('Expenses › Receipts lists the receipts, To review by default with counts, and opens originals large', { tag: '@portal.receipts.gallery' }, async ({ page, step }) => {
  const api = world();
  const tabs = page.getByRole('navigation', { name: 'Expenses pages' });
  const grid = page.getByRole('list', { name: 'Receipts' });

  await step('AC1: Expenses shows a Receipts tab with its To-review count', async () => {
    await api.open(page, BASE);
    await expect(tabs.getByRole('link', { name: 'Receipts · 2 to review' })).toBeVisible();
    await tabs.getByRole('link', { name: 'Receipts · 2 to review' }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/receipts$`));
  });

  await step('AC1: the gallery lists To review, with the filter counts', async () => {
    await expect(grid.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('tab', { name: /To review\s*2/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Filed\s*1/ })).toBeVisible();
    expect(api.last('GET', /^\/v1\/receipts$/)?.query.get('filingStatus')).toBe('TO_REVIEW');
    // The image card's thumbnail is its signed original; the PDF card is a tile
    await expect(grid.locator('[data-status="to_review"] img')).toHaveCount(1);
    await expect(grid.getByRole('link', { name: 'Open invoice-1182.pdf' })).toContainText('PDF');
  });

  await step('AC1: Filed shows the expense on its card; All sends no filter', async () => {
    await page.getByRole('tab', { name: /Filed/ }).click();
    await expect(grid.getByRole('listitem')).toHaveCount(1);
    await expect(grid.getByText('Spinneys')).toBeVisible();
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(grid.getByRole('listitem')).toHaveCount(3);
    expect(api.last('GET', /^\/v1\/receipts$/)?.query.has('filingStatus')).toBe(false);
  });

  await step('AC1: an image receipt opens large, inline, with Open full size', async () => {
    await grid.getByRole('link', { name: 'Open shufersal.jpg' }).click();
    const img = page.getByRole('img', { name: 'Receipt shufersal.jpg' });
    await expect(img).toBeVisible();
    // It decoded: a real 1×1 image from the bucket
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
    await expect(page.getByRole('link', { name: 'Open full size' })).toHaveAttribute('href', /disposition=inline/);
  });

  await step('AC1: a PDF receipt shows in an iframe on an inline URL (A8)', async () => {
    await page.goto(`${BASE}/receipts`);
    await page.getByRole('link', { name: 'Open invoice-1182.pdf' }).click();
    const frame = page.locator('iframe.hp-receipt-pdf');
    await expect(frame).toHaveAttribute('src', new RegExp(`^${STORAGE}/library/.*disposition=inline`));
    const asked = api.calls('GET', /^\/v1\/receipts\/[^/]+\/download$/).filter((c) => c.path.includes(libraryReceipt(2).id));
    expect(asked.at(-1)?.query.get('disposition')).toBe('inline');
  });
});

test('Upload a receipt with no expense: it lands in To review', { tag: '@portal.receipts.upload' }, async ({ page, step }) => {
  const api = world();
  const grid = page.getByRole('list', { name: 'Receipts' });

  await step('Open Expenses › Receipts', async () => {
    await api.open(page, `${BASE}/receipts`);
    await expect(grid.getByRole('listitem')).toHaveCount(2);
  });

  await step('AC2: a text file is refused before anything is sent', async () => {
    await page.getByTestId('receipts-upload-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: 'notes.txt: receipts must be a PDF, JPEG or PNG file.' })).toBeVisible();
    expect(api.calls('POST', /^\/v1\/receipts\/uploads$/)).toHaveLength(0);
  });

  await step('AC2: Upload receipt sends a PNG: start, PUT to the bucket, complete', async () => {
    await page.getByTestId('receipts-upload-input').setInputFiles({ name: 'taxi.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
    await expect(grid.getByRole('link', { name: 'Open taxi.png' })).toBeVisible();
    const start = api.last('POST', /^\/v1\/receipts\/uploads$/);
    expect(start?.body).toMatchObject({ filename: 'taxi.png', mimeType: 'image/png', sizeBytes: 8 });
    expect(start?.headers['idempotency-key']).toBeTruthy();
    expect(api.storage.some((r) => r.method === 'PUT' && r.url.includes('/upload/'))).toBe(true);
    expect(api.calls('POST', /^\/v1\/receipts\/[^/]+\/complete$/)).toHaveLength(1);
  });

  await step('AC2: it is under To review, and the count went up', async () => {
    await expect(grid.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText('1 receipt added to To review')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Expenses pages' }).getByRole('link', { name: 'Receipts · 3 to review' })).toBeVisible();
  });
});

test('Review a receipt beside the prefilled form, use the vendor typeahead, and Approve to file it and move on', { tag: '@portal.receipts.review-approve' }, async ({ page, step }) => {
  const api = world();
  const first = libraryReceipt(1).id;
  const second = libraryReceipt(2).id;
  const vendor = page.getByLabel('Vendor');

  await step('AC3: open a To-review receipt the phone read', async () => {
    await api.open(page, `${BASE}/receipts`);
    await page.getByRole('link', { name: 'Open shufersal.jpg' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Review receipt' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Receipt shufersal.jpg' })).toBeVisible();
  });

  await step('AC3: the suggested fields are filled and marked "From the receipt"', async () => {
    await expect(page.getByLabel('Amount')).toHaveValue('84.20');
    await expect(page.getByLabel('Amount')).toHaveAttribute('data-suggested', 'true');
    await expect(page.getByLabel('Currency')).toHaveValue('ILS');
    await expect(page.getByLabel('Date')).toHaveValue('2026-10-24');
    await expect(vendor).toHaveValue('Shufersal');
    for (const field of ['amount', 'currency', 'date', 'vendor']) await expect(page.locator(`[data-hint-for="${field}"]`)).toHaveText('From the receipt');
  });

  await step('AC4: the vendor field suggests a saved vendor, and picking it prefills its category', async () => {
    await vendor.fill('yel');
    await expect(page.getByRole('option', { name: 'Yellow Cab', exact: true })).toBeVisible();
    await expect.poll(() => api.last('GET', /^\/v1\/vendors$/)?.query.get('q')).toBe('yel');
    await page.getByRole('option', { name: 'Yellow Cab', exact: true }).click();
    await expect(vendor).toHaveValue('Yellow Cab');
    await expect(page.getByLabel('Category')).toHaveValue(travel.id);
  });

  await step('AC3: Approve and file sends the expense, keyed, without the suggestion, and opens the next receipt', async () => {
    await page.getByRole('button', { name: 'Approve and file' }).click();
    await expect(page).toHaveURL(new RegExp(`/receipts/${second}$`));
    const approve = api.last('POST', new RegExp(`^/v1/receipts/${first}/approve$`));
    expect(approve?.body).toEqual({ occurredOn: '2026-10-24', amount: '84.20', currency: 'ILS', vendor: 'Yellow Cab', categoryId: travel.id });
    expect(approve?.headers['idempotency-key']).toBeTruthy();
    await expect(page.getByText('Filed', { exact: true })).toBeVisible();
    await expect(page.locator('iframe.hp-receipt-pdf')).toBeVisible();
  });

  await step('AC3: the last receipt filed goes back to the gallery, where it is gone from To review', async () => {
    await page.getByLabel('Amount').fill('99');
    await page.getByLabel('Category').selectOption({ label: 'Groceries' });
    await page.getByRole('button', { name: 'Approve and file' }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/receipts$`));
    await expect(page.getByRole('heading', { name: 'Nothing to review' })).toBeVisible();
  });
});

test('A filed receipt opens read-only with its expense, from a direct link', { tag: '@portal.receipts.filed' }, async ({ page, step }) => {
  const api = world();
  const filed = libraryReceipt(3).id;

  await step('Open a filed receipt by its link', async () => {
    await api.open(page, `${BASE}/receipts/${filed}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Filed receipt' })).toBeVisible();
  });

  await step('It shows the expense it is filed on, with Open expense and no Approve', async () => {
    await expect(page.getByText('Spinneys', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and file' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Open expense' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit expense' })).toBeVisible();
  });
});

test('With the receipts library off there is no Receipts tab, and its link says so', { tag: '@portal.receipts.unavailable' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], categories: [groceries] });

  await step('Open Expenses: the tabs are Expenses and Groups only', async () => {
    await api.open(page, BASE);
    const tabs = page.getByRole('navigation', { name: 'Expenses pages' });
    await expect(tabs.getByRole('link', { name: 'Groups' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: /Receipts/ })).toHaveCount(0);
  });

  await step('Open the Receipts link directly: it is not available', async () => {
    await page.goto(`${BASE}/receipts`);
    await expect(page.getByRole('heading', { name: "Receipts aren't available here" })).toBeVisible();
  });
});
