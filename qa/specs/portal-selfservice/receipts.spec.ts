import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { person } from '../../support/agent';
import { chooseLanguage, grantCoverage, grantFeature, liveState } from '../../support/selfService';

/**
 * MUT-441 (AC8): our own server reads an uploaded receipt, against the live dev API (support/selfservice-live.mjs) and
 * the receipt-ocr sidecar it starts. The upload is a synthetic MUT-253 fixture (an English bookshop receipt photo:
 * 52.470 JOD on 2026-06-25). The API waits QA_READ_DELAY_MS before reading, as a queued task would, so the
 * "Reading…" states are on screen before the fields fill.
 */

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'server', 'ocr', 'tests', 'fixtures', 'syn-025-en-photo.jpg');
const FILE_NAME = 'bookshop-receipt.jpg';
/** The read itself (delay, sidecar, extraction) plus the review page's 3 s poll; well under its 2-minute give-up. */
const READ_TIMEOUT_MS = 60_000;

test.beforeEach(async ({ page }) => {
  await chooseLanguage(page, 'en');
});

test('I upload a receipt photo and the server reads it; the review page fills in the amount and date', { tag: '@portal-selfservice.receipts.server-reading' }, async ({ page, step }) => {
  expect(liveState().ocr, 'the env runs the receipt-ocr sidecar (Tesseract on PATH: brew install tesseract)').toBe(true);
  const me = await person(page, { agentAccess: false });
  // The live API gates writes on billing (ADR-181); the operator grants the pilot's receipt reading (D3).
  await grantCoverage(me.id);
  await grantFeature(me.id, 'receipt_reading');
  const grid = page.getByRole('list', { name: 'Receipts' });
  const card = grid.getByRole('link', { name: `Open ${FILE_NAME}` });

  await step('Open Expenses › Receipts', async () => {
    await page.goto(`/p/${me.profileId}/expenses/receipts`);
    await expect(page.getByTestId('receipts-upload-input')).toBeAttached();
  });
  await step('Upload a photo of a bookshop receipt', async () => {
    await page.getByTestId('receipts-upload-input').setInputFiles({ name: FILE_NAME, mimeType: 'image/jpeg', buffer: fs.readFileSync(FIXTURE) });
    await expect(card).toBeVisible();
  });
  await step('The new card says "Reading…"', async () => {
    await expect(card).toContainText('Reading…');
  });
  await step('Open the receipt while the server reads it', async () => {
    await card.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Review receipt' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Reading the receipt…' })).toBeVisible();
    await expect(page.getByLabel('Amount')).toBeEditable();
  });
  await step('The amount and date fill in from the receipt', async () => {
    await expect(page.getByLabel('Amount')).toHaveValue('52.470', { timeout: READ_TIMEOUT_MS });
    await expect(page.getByLabel('Currency')).toHaveValue('JOD');
    await expect(page.getByLabel('Date')).toHaveValue('2026-06-25');
    await expect(page.getByLabel('Amount')).toHaveAttribute('data-suggested', 'true');
    await expect(page.getByLabel('Date')).toHaveAttribute('data-suggested', 'true');
    await expect(page.getByText('Reading the receipt…')).toHaveCount(0);
  });
});

/** MUT-540 (ADR-244): the same bookshop photo turned 90° (`sips -r 90`), lying on its side. */
const SIDEWAYS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'receipts', 'syn-025-en-photo-sideways.jpg');
const SIDEWAYS_NAME = 'bookshop-receipt-sideways.jpg';

test('A receipt photographed on its side is turned and read; the review page fills in the amount and date', { tag: '@portal-selfservice.receipts.sideways-photo' }, async ({ page, step }) => {
  expect(liveState().ocr, 'the env runs the receipt-ocr sidecar (Tesseract on PATH: brew install tesseract)').toBe(true);
  const me = await person(page, { agentAccess: false });
  await grantCoverage(me.id);
  await grantFeature(me.id, 'receipt_reading');
  const card = page.getByRole('list', { name: 'Receipts' }).getByRole('link', { name: `Open ${SIDEWAYS_NAME}` });

  await step('Open Expenses › Receipts', async () => {
    await page.goto(`/p/${me.profileId}/expenses/receipts`);
    await expect(page.getByTestId('receipts-upload-input')).toBeAttached();
  });
  await step('Upload the bookshop receipt photo lying on its side', async () => {
    await page.getByTestId('receipts-upload-input').setInputFiles({ name: SIDEWAYS_NAME, mimeType: 'image/jpeg', buffer: fs.readFileSync(SIDEWAYS) });
    await expect(card).toBeVisible();
  });
  await step('Open the receipt and wait for the reading to finish', async () => {
    await card.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Review receipt' })).toBeVisible();
  });
  await step('The amount and date fill in from the receipt, as for the upright photo', async () => {
    await expect(page.getByLabel('Amount')).toHaveValue('52.470', { timeout: READ_TIMEOUT_MS });
    await expect(page.getByLabel('Currency')).toHaveValue('JOD');
    await expect(page.getByLabel('Date')).toHaveValue('2026-06-25');
    await expect(page.getByLabel('Amount')).toHaveAttribute('data-suggested', 'true');
    await expect(page.getByLabel('Date')).toHaveAttribute('data-suggested', 'true');
    await expect(page.getByText('Reading the receipt…')).toHaveCount(0);
  });
});

/** MUT-590: a vendor-made invoice PDF (synthetic; its label and amount drawn apart on one line), read from its text layer. */
const VENDOR_PDF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'server', 'ocr', 'tests', 'fixtures', 'syn-vendor-invoice-en.pdf');
const VENDOR_PDF_NAME = 'studio-invoice.pdf';

test("I upload an invoice PDF a vendor's software made and the server reads it; the review page fills in the amount, date and vendor", { tag: '@portal-selfservice.receipts.vendor-pdf' }, async ({ page, step }) => {
  expect(liveState().ocr, 'the env runs the receipt-ocr sidecar (Tesseract on PATH: brew install tesseract)').toBe(true);
  const me = await person(page, { agentAccess: false });
  await grantCoverage(me.id);
  await grantFeature(me.id, 'receipt_reading');
  const card = page.getByRole('list', { name: 'Receipts' }).getByRole('link', { name: `Open ${VENDOR_PDF_NAME}` });

  await step('Open Expenses › Receipts', async () => {
    await page.goto(`/p/${me.profileId}/expenses/receipts`);
    await expect(page.getByTestId('receipts-upload-input')).toBeAttached();
  });
  await step("Upload a design studio's invoice PDF", async () => {
    await page.getByTestId('receipts-upload-input').setInputFiles({ name: VENDOR_PDF_NAME, mimeType: 'application/pdf', buffer: fs.readFileSync(VENDOR_PDF) });
    await expect(card).toBeVisible();
  });
  await step('Open the receipt and wait for the reading to finish', async () => {
    await card.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Review receipt' })).toBeVisible();
    await expect(page.getByLabel('Amount')).toHaveValue('200.00', { timeout: READ_TIMEOUT_MS });
  });
  await step('The amount, date and vendor are filled in from the receipt', async () => {
    await expect(page.getByLabel('Currency')).toHaveValue('USD');
    await expect(page.getByLabel('Date')).toHaveValue('2026-11-09');
    const vendor = page.getByLabel('Vendor', { exact: true });
    await expect(vendor).toHaveValue('Studio Shubak Ltd');
    for (const field of ['Amount', 'Date']) await expect(page.getByLabel(field)).toHaveAttribute('data-suggested', 'true');
    // The vendor picker's mark sits on its wrapper.
    await expect(page.locator('[data-suggested="true"]').filter({ has: vendor })).toHaveCount(1);
    await expect(page.getByText('Reading the receipt…')).toHaveCount(0);
  });
});
