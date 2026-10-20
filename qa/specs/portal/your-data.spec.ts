import type { Page, Route } from '@playwright/test';
import JSZip from 'jszip';
import { test, expect } from '../../support/qa';
import { OFFICE_A, OFFICE_B, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { encodeRecordsFileText, HOSTED_EXPORT_ORIGIN, RECORDS_FILE_KIND, SNAPSHOT_FIELDS } from '../../../server/src/records-file/codec';

/**
 * Your data, signed in (MUT-325): Download my records. The two export routes
 * are answered here with what the server writes, a profile's records file
 * and its receipt's bytes; the receipt is held until the spec lets it go, so
 * the progress (and Cancel) can be seen while the download runs.
 */

const PERSON = '33333333-3333-4333-8333-333333333333';
const RECEIPT = '44444444-4444-4444-8444-444444444444';
const RECEIPT_KEY = `org/${OFFICE_A}/expense-receipts/${RECEIPT}`;
const PDF = Buffer.from('%PDF-1.4 qa receipt bytes');
const AT = new Date('2026-10-15T09:00:00.000Z');

/** The records file the server writes for one profile (server/src/records-file), with one READY receipt on the first. */
function recordsFileOf(profileId: string, name: string): string {
  const maps = Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, new Map()])) as Record<string, Map<string, unknown>>;
  maps.orgs!.set(profileId, { id: profileId, name, slug: name.toLowerCase().replace(/\W+/g, '-'), defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', personalOwnerUserId: null, ownerUserId: PERSON, profileType: 'BUSINESS', version: 1, createdAt: AT });
  maps.people!.set(PERSON, { id: PERSON, email: 'local@device.invalid', displayName: 'Nour', passwordHash: null, locale: 'en', status: 'ACTIVE', failedSignIns: 0, lockedUntil: null, passwordChangedAt: AT, lastSignInAt: null, malafatSuggestions: null, createdAt: AT, updatedAt: AT });
  maps.members!.set(`${PERSON}:${profileId}`, { userId: PERSON, organizationId: profileId, createdAt: AT });
  if (profileId === OFFICE_A) {
    maps.expReceipts!.set(RECEIPT, { id: RECEIPT, organizationId: OFFICE_A, expenseId: RECEIPT, filename: 'taxi.pdf', mimeType: 'application/pdf', sizeBytes: PDF.byteLength, status: 'READY', storageKey: RECEIPT_KEY, uploadedByUserId: PERSON, requestId: null, createdAt: AT, completedAt: AT, deletedAt: null });
  }
  return encodeRecordsFileText({ formatVersion: 1, savedAt: AT, origin: HOSTED_EXPORT_ORIGIN }, maps as never);
}

/** Answers the export routes; the receipt waits for `release()`. Call after `api.open`: the later route wins over its catch-all. */
async function serveExport(page: Page) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const names: Record<string, string> = { [OFFICE_A]: 'Nour Studio', [OFFICE_B]: 'Haddad Law' };
  const asked: string[] = [];
  await page.route('**/v1/records-export**', async (route: Route) => {
    const url = new URL(route.request().url());
    const profileId = route.request().headers()['x-mutaba3a-profile'] ?? '';
    asked.push(`${url.pathname} ${profileId}`);
    if (url.pathname === '/v1/records-export') return route.fulfill({ status: 200, contentType: 'application/json', body: recordsFileOf(profileId, names[profileId] ?? 'Profile') });
    await held;
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment' }, body: PDF }).catch(() => undefined);
  });
  return { release, asked };
}

async function openYourData(page: Page) {
  await page.getByRole('button', { name: /^Account/ }).click();
  await page.getByRole('menuitem', { name: 'Your data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your data' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Signed in, download my records from Your data, with progress, as one export file local mode restores', { tag: '@portal.your-data.download-signed-in' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Haddad Law')] });
  let server: Awaited<ReturnType<typeof serveExport>> = { release: () => {}, asked: [] };
  let dialog = page.getByRole('dialog', { name: 'Your data' });

  await step('Sign in with two profiles and open Your data from the account menu', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    server = await serveExport(page);
    dialog = await openYourData(page);
    await expect(page).toHaveURL(/yourData=true/);
    await expect(dialog.getByRole('checkbox', { name: 'Nour Studio' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Haddad Law' })).toBeChecked();
    await expect(dialog.getByText(/an export, not a backup/)).toBeVisible();
  });

  const downloading = page.waitForEvent('download');
  await step('Keep both profiles ticked and press Download my records', async () => {
    await dialog.getByRole('button', { name: 'Download my records' }).click();
  });

  await step('Watch the progress while the receipt file comes in', async () => {
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    await expect(dialog.getByText('Receipt files: 0 of 1')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download my records' })).toBeDisabled();
    server.release();
  });

  await step('The download is one export zip with both profiles and the receipt file, and a toast says so', async () => {
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^mutaba3a-export-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = await JSZip.loadAsync(await (await import('node:fs/promises')).readFile((await download.path())!));
    const records = JSON.parse(await zip.file('records.json')!.async('string')) as { kind: string; origin: string; maps: { orgs: { $map: Array<[string, unknown]> } } };
    expect(records.kind).toBe(RECORDS_FILE_KIND);
    expect(records.origin).toBe(HOSTED_EXPORT_ORIGIN);
    expect(records.maps.orgs.$map.map(([id]) => id).sort()).toEqual([OFFICE_A, OFFICE_B].sort());
    expect(Buffer.from(await zip.file(`receipts/${RECEIPT_KEY}`)!.async('uint8array'))).toEqual(PDF);
    await expect(page.getByText('Records downloaded.')).toBeVisible();
    expect(server.asked).toEqual(expect.arrayContaining([`/v1/records-export ${OFFICE_A}`, `/v1/records-export ${OFFICE_B}`, `/v1/records-export/receipts/${RECEIPT} ${OFFICE_A}`]));
  });
});

test('Cancel a signed-in download partway, and nothing is saved', { tag: '@portal.your-data.download-cancel' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
  let dialog = page.getByRole('dialog', { name: 'Your data' });
  let downloaded = false;
  page.on('download', () => (downloaded = true));

  await step('Sign in, open Your data and press Download my records', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await serveExport(page);
    dialog = await openYourData(page);
    await dialog.getByRole('button', { name: 'Download my records' }).click();
    await expect(dialog.getByText('Receipt files: 0 of 1')).toBeVisible();
  });

  await step('While a receipt file is still coming, press Cancel', async () => {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  await step('The drawer says nothing was saved, no file downloads, and Download is offered again', async () => {
    await expect(dialog.getByText('Download cancelled. Nothing was saved.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download my records' })).toBeEnabled();
    // The export saves only after its last receipt; the receipt never came, so no file can follow.
    expect(downloaded).toBe(false);
  });
});
