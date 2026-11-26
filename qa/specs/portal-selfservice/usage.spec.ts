import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { person } from '../../support/agent';
import { chooseLanguage, grantPlan } from '../../support/selfService';

/**
 * MUT-735 (ADR-281): a finished scan is metered by the live dev API (support/selfservice-live.mjs), and GET /v1/billing
 * reports it against the plan's limit with its level. The billing screen's usage line is MUT-731's; this checks the
 * answer it will read, as the portal's own session asks for it.
 */
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'server', 'ocr', 'tests', 'fixtures', 'syn-025-en-photo.jpg');
const FILE_NAME = 'usage-receipt.jpg';

test('A finished receipt upload counts one scan this month, against Solo’s 100', { tag: '@portal-selfservice.usage.billing-usage' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const me = await person(page, { agentAccess: false });
  await grantPlan(me.id, 'SOLO');
  const billing = async () => (await (await page.request.get('/v1/billing')).json()).usage;

  await step('Before any upload, Billing reports this month with no scans, Solo’s limits, nothing near', async () => {
    const usage = await billing();
    expect(usage.plan).toBe('solo');
    expect(usage.month).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()));
    expect(usage.meters).toEqual([
      { meter: 'documents', used: 0, limit: 50, level: 'ok' },
      { meter: 'scans', used: 0, limit: 100, level: 'ok' },
    ]);
    expect(usage.businesses).toEqual({ used: 0, limit: 1 });
  });
  await step('Upload a receipt photo in Expenses › Receipts', async () => {
    await page.goto(`/p/${me.profileId}/expenses/receipts`);
    await page.getByTestId('receipts-upload-input').setInputFiles({ name: FILE_NAME, mimeType: 'image/jpeg', buffer: fs.readFileSync(FIXTURE) });
    await expect(page.getByRole('list', { name: 'Receipts' }).getByRole('link', { name: `Open ${FILE_NAME}` })).toBeVisible();
  });
  await step('Billing now reports one scan of 100; reloading the page counts nothing more', async () => {
    await expect.poll(async () => (await billing()).meters[1]).toEqual({ meter: 'scans', used: 1, limit: 100, level: 'ok' });
    await page.reload();
    await expect(page.getByRole('list', { name: 'Receipts' }).getByRole('link', { name: `Open ${FILE_NAME}` })).toBeVisible();
    expect((await billing()).meters).toEqual([
      { meter: 'documents', used: 0, limit: 50, level: 'ok' },
      { meter: 'scans', used: 1, limit: 100, level: 'ok' },
    ]);
  });
});
