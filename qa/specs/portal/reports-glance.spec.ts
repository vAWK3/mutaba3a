import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { FIRM, NEW_PROFILE, OFFICE_A, OFFICE_B, malafatFirm, office } from '../../support/portal';
import { FakeApi, todayInJerusalem, verdictBody, type FakeApiSeed, type StubVerdictLine } from '../../support/portalApi';

/**
 * The Reports Glance (MUT-448): one verdict across the person's profiles at /reports. The fake API answers
 * GET /v1/summaries/verdict with a canned body (verdictBody): the portal shows the verdict as the server sends it,
 * and MUT-447's server tests own its money rules. Dates are relative to today.
 */

const TODAY = todayInJerusalem();
const MONTH = TODAY.slice(0, 7);
const endOf = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const shift = (month: string, n: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const LAST = shift(MONTH, -1);
const thisMonth = { from: `${MONTH}-01`, to: endOf(MONTH), asOf: TODAY };
const lastMonth = { from: `${LAST}-01`, to: endOf(LAST), asOf: TODAY };

const OFFICE_C = '55555555-5555-4555-8555-555555555555';
const business: StubVerdictLine = { profileId: OFFICE_A, name: 'Nal Software', received: '10000.00', spent: '960.00' };
const personal: StubVerdictLine = { profileId: OFFICE_B, name: 'Personal', kind: 'PERSONAL', spent: '6350.00' };

function world(lines: StubVerdictLine[], seed: Partial<FakeApiSeed> = {}) {
  const profiles = lines.map((l) => office(l.profileId, l.name));
  return new FakeApi({ profiles, verdicts: { current: verdictBody(lines, { ...thisMonth, owed: '11500.00', overdueCount: 2 }) }, ...seed });
}

const ledger = (page: Page, name = 'Your profiles') => page.getByRole('list', { name });
const rows = (page: Page, name?: string) => ledger(page, name).getByRole('link');

async function openGlance(page: Page, api: FakeApi, language: 'en' | 'ar' = 'en') {
  await api.open(page, `/p/${OFFICE_A}/payments`, language);
  await page.getByRole('link', { name: language === 'ar' ? 'التقارير' : 'Reports', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\?back=/);
}

test('A business and a personal profile read as two rows, then kept and owed', { tag: '@portal.reports-glance.two-profiles' }, async ({ page, step }) => {
  const api = world([business, personal]);

  await step('Press the Reports icon on a business + personal account', async () => {
    await openGlance(page, api);
    await expect(page.locator('.hp-reports')).toHaveAttribute('aria-current', 'page');
  });

  await step('Two rows, net for the business and spent for the personal profile, then kept and owed', async () => {
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toHaveAccessibleName('Nal Software, net +₪9,040');
    await expect(rows(page).nth(1)).toHaveAccessibleName('Personal, spent ₪6,350');
    await expect(page.getByRole('region', { name: 'Kept' }).locator('.sr-only')).toHaveText('₪2,690');
    await expect(page.getByText('Still owed to you')).toBeVisible();
    await expect(page.getByText('2 overdue')).toBeVisible();
    // D4: this month is the server's pick, asked with no dates
    expect(api.last('GET', /^\/v1\/summaries\/verdict$/)?.query.toString()).toBe('');
  });
});

test('Five profiles read as five rows, and the kept figure is the server’s', { tag: '@portal.reports-glance.five-profiles' }, async ({ page, step }) => {
  const lines: StubVerdictLine[] = [
    business,
    { profileId: FIRM, name: 'Sader Law', received: '4200.00' },
    { profileId: OFFICE_C, name: 'elMokhtbr', shared: true, received: '1850.00' },
    { profileId: NEW_PROFILE, name: 'Barmajiyat', received: '650.00', spent: '3750.00' },
    personal,
  ];
  const api = new FakeApi({ profiles: lines.map((l) => office(l.profileId, l.name)), verdicts: { current: verdictBody(lines, { ...thisMonth, kept: '4480.00' }) } });

  await step('Open Reports on an account with five profiles', async () => {
    await openGlance(page, api);
  });

  await step('Five rows in the server’s order, one shared, and the server’s kept', async () => {
    await expect(rows(page)).toHaveCount(5);
    expect(await rows(page).evaluateAll((links) => links.map((l) => l.getAttribute('aria-label')?.split(',')[0]))).toEqual(['Nal Software', 'Sader Law', 'elMokhtbr', 'Barmajiyat', 'Personal']);
    await expect(rows(page).nth(2)).toHaveAccessibleName(/^elMokhtbr, shared, /);
    await expect(rows(page).nth(3)).toHaveAccessibleName('Barmajiyat, net −₪3,100');
    await expect(page.getByRole('region', { name: 'Kept' }).locator('.sr-only')).toHaveText('₪4,480');
  });

  await step('A business with no expenses reads "income only", never as profit (AC3)', async () => {
    await expect(rows(page).nth(1)).toHaveAccessibleName('Sader Law, income only +₪4,200');
    await expect(rows(page).nth(1).locator('.hp-glance-kind')).toHaveText('income only');
  });
});

test('In Arabic on a phone, the Glance reads right to left', { tag: '@portal.reports-glance.arabic' }, async ({ page, step }) => {
  const api = world([business, personal]);
  await page.setViewportSize({ width: 390, height: 844 });

  await step('Open Reports in Arabic at phone width', async () => {
    await openGlance(page, api, 'ar');
  });

  await step('RTL, «تبقّى لك», the month in Levantine Arabic and a › chevron on each row', async () => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'تبقّى لك' })).toBeVisible();
    const month = new Intl.DateTimeFormat('ar-PS', { month: 'long', timeZone: 'UTC' }).format(new Date(`${MONTH}-01T00:00:00Z`));
    await expect(page.locator('.hp-report-caption')).toContainText(month);
    await expect(rows(page, 'ملفاتك')).toHaveCount(2);
    await expect(rows(page, 'ملفاتك').nth(0).locator('.hp-glance-chevron')).toHaveText('›');
    await expect(rows(page, 'ملفاتك').nth(0).locator('.hp-glance-amount bdi')).toHaveCount(1);
  });
});

/** PORTAL_LANGUAGE_KEY in src/hosted/i18n/HostedLanguageProvider.tsx */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

test('Signed out on this device, the Glance runs on the records kept in the browser', { tag: '@portal.reports-glance.local-mode' }, async ({ page, step }) => {
  const requests: string[] = [];
  await page.context().route('**/v1/**', async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) });
  });
  await page.context().addInitScript(([key, value]) => localStorage.setItem(key, value), [PORTAL_LANGUAGE_KEY, 'en'] as const);

  await step('Signed out, record income, then press the Reports icon', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await page.getByRole('link', { name: '+ Add income' }).click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('radio', { name: 'Received' }).click();
    await drawer.getByLabel('Amount').fill('250.00');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toBeHidden();
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
  });

  await step('The Glance shows what was kept from the browser’s records, and nothing reached the server', async () => {
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('.hp-glance-hero .sr-only')).toHaveText('₪250');
    await expect(rows(page)).toHaveCount(1);
    expect(requests.filter((path) => path.startsWith('/v1/summaries'))).toEqual([]);
  });
});

test('A month where more went out than came in says so', { tag: '@portal.reports-glance.negative-month' }, async ({ page, step }) => {
  const api = world([business, { ...personal, spent: '12000.00' }]);

  await step('Open Reports for a month with more spent than received', async () => {
    await openGlance(page, api);
  });

  await step('Kept is negative, in rose, with its sentence', async () => {
    await expect(page.getByRole('region', { name: 'Kept' }).locator('.sr-only')).toHaveText('-₪2,960');
    await expect(page.locator('.hp-glance-figure')).toHaveClass(/is-negative/);
    await expect(page.getByText('Spent more than came in')).toBeVisible();
  });
});

test('A row opens that profile’s Reports for the same period, and Back returns', { tag: '@portal.reports-glance.row-drilldown' }, async ({ page, step }) => {
  const api = world([business, personal], { verdicts: { current: verdictBody([business, personal], thisMonth), [`${LAST}-01`]: verdictBody([business, personal], lastMonth) } });

  await step('Step to last month, then tap the business row', async () => {
    await openGlance(page, api);
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page).toHaveURL(new RegExp(`at=${LAST}-01`));
    await rows(page).nth(0).click();
  });

  await step('That profile’s Reports opens for last month; Back returns to the Glance', async () => {
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/reports\\?period=month&at=${LAST}-01`));
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/reports\?/);
    await expect(rows(page)).toHaveCount(2);
  });
});

test('On a desktop the Glance is one centred column with a hint toward each profile’s charts', { tag: '@portal.reports-glance.desktop-layout' }, async ({ page, step }) => {
  const api = world([business, personal]);
  await page.setViewportSize({ width: 1280, height: 900 });

  await step('Open Reports at 1280px wide', async () => {
    await openGlance(page, api);
  });

  await step('With reduced motion the kept figure shows its final value at once, no count-up (AC5)', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
    // Read at once: with motion the figure would still be counting up (0.6 s)
    expect(await page.locator('.hp-glance-figure .hp-countup').textContent()).toBe('₪2,690');
  });

  await step('The ledger is at most 560px wide and centred, the hint under it', async () => {
    const box = (await page.locator('.hp-glance').boundingBox())!;
    const main = (await page.getByRole('main').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(560);
    expect(Math.abs(box.x - main.x - (main.x + main.width - (box.x + box.width)))).toBeLessThan(2);
    await expect(page.getByText('Open a profile for its charts')).toBeVisible();
  });
});

test('With nothing on record, the Glance starts the first payment or expense', { tag: '@portal.reports-glance.first-run' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nal Software')] });

  await step('Open Reports on an account with no records', async () => {
    await openGlance(page, api);
  });

  await step('The first-run block, with its actions and no ledger', async () => {
    await expect(page.getByRole('heading', { name: 'Your reports start with your first payment or expense' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record expense' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Your profiles' })).toHaveCount(0);
  });
});

test('With nothing open, the owed line says nothing is owed', { tag: '@portal.reports-glance.owed-zero' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nal Software'), office(OFFICE_B, 'Personal')], verdicts: { current: verdictBody([business, { ...personal, spent: '0.00' }], thisMonth) } });

  await step('Open Reports with no open Owed entries', async () => {
    await openGlance(page, api);
  });

  await step('“Nothing owed to you”, with no overdue count', async () => {
    await expect(page.locator('.hp-glance-owed')).toHaveText('Nothing owed to you');
    await expect(page.locator('.hp-glance-overdue')).toHaveCount(0);
  });

  await step('A profile with nothing this period says "Nothing recorded", never a blank (AC3)', async () => {
    await expect(rows(page).nth(1)).toHaveAccessibleName('Personal, spent Nothing recorded');
    await expect(rows(page).nth(1).locator('.hp-glance-nothing')).toHaveText('Nothing recorded');
  });
});

test('A firm you staff, which no total counts, still opens its own Reports from the Glance', { tag: '@portal.reports-glance.staff-firm' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nal Software'), malafatFirm()], verdicts: { current: verdictBody([business], thisMonth) } });

  await step('Press the Reports icon on an account that owns a profile and staffs a Malafat firm', async () => {
    await openGlance(page, api);
  });

  await step('The firm sits under the ledger as “Not in this total”, and its row opens its own Reports', async () => {
    const outside = page.getByRole('list', { name: 'Not in this total' });
    await expect(outside.getByRole('link')).toHaveCount(1);
    await outside.getByRole('link', { name: 'Haddad & Partners, not in this total' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${FIRM}/reports\\?`));
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  });
});

