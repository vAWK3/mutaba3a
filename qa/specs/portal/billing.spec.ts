import { test, expect } from '../../support/qa';
import { OFFICE_A, OFFICE_B, office } from '../../support/portal';
import { FakeApi, expense } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-362 (design review DR4/DR5): Settings › Billing on a server without Stripe or GA prices. The live sandbox
 * always has prices, so this state is shown with the API stubbed; the paying flows run in portal-live.
 */

const DAY = 24 * 60 * 60 * 1000;

test('Before Stripe or the GA prices are set, Billing says subscriptions open soon and offers no Subscribe', { tag: '@portal.billing.open-soon' }, async ({ page, step }) => {
  const trialEnds = new Date(Date.now() + 9 * DAY).toISOString();
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), billing: { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: trialEnds } }] });
  await api.open(page, `/p/${OFFICE_A}`);
  // After open: the later route wins over the fake's catch-all.
  await page.route('**/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: false,
        subscription: null,
        canManage: false,
        trial: { startedAt: new Date(Date.now() - 5 * DAY).toISOString(), endsAt: trialEnds, lockAt: new Date(Date.now() + 25 * DAY).toISOString() },
        catalog: { ILS: null, USD: null },
        countries: { consumer: [], customTaxId: ['IL', 'JO'] },
        coveredProfileIds: [OFFICE_A],
      }),
    }),
  );

  const drawer = await step('Open Billing from You › Account', async () => {
    await openYou(page, 'account');
    await youRow(page, 'Billing').click();
    return page.getByRole('dialog', { name: 'Billing' });
  });
  await step('See the trial first, and that subscriptions open soon', async () => {
    await expect(drawer.getByRole('heading', { name: '9 days left in your free trial' })).toBeVisible();
    await expect(drawer.getByText("Subscriptions open soon. We'll let you know before your trial ends.")).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Subscribe' })).toHaveCount(0);
    await expect(drawer.getByText(/₪|\$/)).toHaveCount(0);
  });
});

/**
 * MUT-361 (ADR-181): the lapse gate as the portal shows it. /v1/me carries each profile's billing and the person's
 * standing; Settings › Billing is stubbed so Subscribe can be offered. The server's own refusals run in portal-live.
 */
type Billing = { state: 'ACTIVE' | 'GRACE' | 'READ_ONLY' | 'LOCKED'; source: 'MALAFAT' | 'OPERATOR' | 'STRIPE' | 'TRIAL' | 'NONE'; tier: 'FREELANCER' | null; until: string | null };
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const PHONE = { width: 375, height: 812 };

/** GET /v1/billing with GA prices, covering these profiles (served by the fake from the first request). */
function billingOverview(coveredProfileIds: string[]) {
  return {
    configured: true,
    subscription: null,
    canManage: false,
    trial: { startedAt: inDays(-20), endsAt: inDays(-6), lockAt: inDays(10) },
    catalog: { ILS: { month: 4900, year: 49000 }, USD: { month: 1600, year: 16000 } },
    countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
    coveredProfileIds,
  };
}

function withReceipt() {
  const e = expense(1, { amount: '45.50', title: 'Office supplies' });
  return { ...e, receipts: [{ id: '66666666-0000-4000-8000-000000000001', expenseId: e.id, filename: 'supplies.pdf', mimeType: 'application/pdf', sizeBytes: 12, status: 'READY' as const, uploadedByUserId: '99999999-9999-4999-8999-999999999999', createdAt: '2026-10-01T09:00:00.000Z', completedAt: '2026-10-01T09:00:00.000Z' }] };
}

test('A profile whose trial ended is read-only, with Subscribe, the lock date and Download my records', { tag: '@portal.billing.read-only' }, async ({ page, step }) => {
  const billing: Billing = { state: 'READ_ONLY', source: 'TRIAL', tier: 'FREELANCER', until: inDays(10) };
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), billing }], expenses: [withReceipt()], billingStanding: 'read-only', billing: billingOverview([OFFICE_A]) });
  await api.open(page, `/p/${OFFICE_A}/expenses`);

  const banner = page.getByRole('region', { name: 'Your plan' });
  await step('Open Expenses on day 20 of a trial that never got a card', async () => {
    await expect(banner.getByText('This profile is read-only')).toBeVisible();
    await expect(banner.getByText(/Your free trial has ended\..*the profile locks until you subscribe\./)).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Download my records' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record expense' })).toHaveCount(0);
  });
  await step('Open an expense', async () => {
    await page.getByRole('table', { name: 'Expenses' }).getByText('Office supplies').click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('This profile is read-only, so nothing here can be changed.')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Add receipt' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Download' })).toBeEnabled();
    await expect(drawer.locator('input').first()).toBeDisabled();
    await drawer.getByRole('button', { name: 'Close' }).first().click();
  });
  await step('Press Subscribe on the banner', async () => {
    await banner.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page).toHaveURL(/billing=true/);
    await expect(page).toHaveURL(/step=subscribe/);
  });
});

test('From day 30 an unpaid trial is locked to one page, Subscribe or download your records', { tag: '@portal.billing.locked' }, async ({ page, step }) => {
  const billing: Billing = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), billing }], expenses: [withReceipt()], billingStanding: 'locked', billing: billingOverview([OFFICE_A]) });
  await api.open(page, `/p/${OFFICE_A}/expenses`);

  await step('Sign in on day 31', async () => {
    await expect(page.getByRole('heading', { name: 'Subscribe or download your records' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /sections/i })).toHaveCount(0);
    expect(api.calls('GET', /\/v1\/expenses$/)).toHaveLength(0);
  });
  await step('Press Download my records', async () => {
    await page.getByRole('button', { name: 'Download my records' }).click();
    await expect(page).toHaveURL(/yourData=true/);
    await expect(page.getByRole('dialog', { name: 'Your data' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Your data' }).getByRole('button', { name: 'Close' }).first().click();
  });
  await step('Press Subscribe', async () => {
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page).toHaveURL(/step=subscribe/);
  });
});

test('The locked screen and the read-only banner read right to left in Arabic on a 375px phone', { tag: '@portal.billing.locked-arabic-phone' }, async ({ page, step }) => {
  await page.setViewportSize(PHONE);
  const locked: Billing = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };
  const readOnly: Billing = { state: 'READ_ONLY', source: 'NONE', tier: null, until: null };
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'استوديو نور'), billing: locked }, { ...office(OFFICE_B, 'مكتب المحاماة'), billing: readOnly }], billingStanding: 'read-only', billing: billingOverview([OFFICE_A, OFFICE_B]) });
  await api.open(page, `/p/${OFFICE_A}`, 'ar');
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  await step('Look at the locked profile', async () => {
    await expect(page.getByRole('heading', { name: 'اشترك أو نزّل سجلاتك' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    const subscribe = page.getByRole('button', { name: 'اشترك' });
    const download = page.getByRole('button', { name: 'نزّل سجلاتي' });
    const [a, b] = [await subscribe.boundingBox(), await download.boundingBox()];
    expect(a && b && Math.abs(a.width - b.width) < 2 && a.y < b.y).toBe(true);
    expect(await noSideScroll()).toBe(true);
  });
  await step('Switch to the read-only one', async () => {
    await page.goto(`/p/${OFFICE_B}`);
    const banner = page.getByRole('region', { name: 'خطتك' });
    await expect(banner.getByText('هذا الملف للقراءة فقط')).toBeVisible();
    await expect(banner.getByRole('button', { name: 'اشترك' })).toBeVisible();
    expect(await noSideScroll()).toBe(true);
  });
});

test('A failed payment shows a warning with Update your card, and nothing is refused', { tag: '@portal.billing.grace' }, async ({ page, step }) => {
  const billing: Billing = { state: 'GRACE', source: 'STRIPE', tier: 'FREELANCER', until: inDays(3) };
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), billing }], billingStanding: 'open', billing: billingOverview([OFFICE_A]) });
  await api.open(page, `/p/${OFFICE_A}/expenses`);
  const banner = page.getByRole('region', { name: 'Your plan' });

  await step('Open Expenses while Stripe retries a failed payment', async () => {
    await expect(banner.getByText("We couldn't take your last payment")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record expense' }).first()).toBeVisible();
  });
  await step('Press Update your card', async () => {
    await banner.getByRole('button', { name: 'Update your card' }).click();
    await expect(page.getByRole('dialog', { name: 'Billing' })).toBeVisible();
  });
});

test('A cancelled subscription leaves the profile read-only for good, and says it never locks', { tag: '@portal.billing.paid-lapse' }, async ({ page, step }) => {
  const billing: Billing = { state: 'READ_ONLY', source: 'STRIPE', tier: 'FREELANCER', until: null };
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), billing }], billingStanding: 'read-only', billing: billingOverview([OFFICE_A]) });
  await api.open(page, `/p/${OFFICE_A}/receivables`);

  await step('Open Receivables after the subscription ended', async () => {
    const banner = page.getByRole('region', { name: 'Your plan' });
    await expect(banner.getByText(/Your subscription has ended\..*Nothing is deleted\./)).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Subscribe' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add income' })).toHaveCount(0);
  });
});
