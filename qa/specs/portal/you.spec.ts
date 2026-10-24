import { test, expect } from '../../support/qa';
import { attachScreenshot } from '../../support/brand';
import { OFFICE_A, OFFICE_B, office, signedOutServer } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * The You page (MUT-425, epic MUT-423): Profiles · Account · App, which replaced the profile switcher and the account
 * menu. Each row opens today's drawer by its URL key; switching profile from it is shell.switch-profile.
 */

const DAY = 24 * 60 * 60 * 1000;
const PHONE = { width: 375, height: 812 };

test('every row on the You page opens its drawer over the page, and Back closes it', { tag: '@portal.you.drawers' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Nour Accounting')] });

  await step('From Payments, open You › Account from the avatar', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await openYou(page, 'account');
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/you/account\\?from=payments$`));
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  });

  for (const [row, key, dialog] of [
    ['Billing', 'billing', 'Billing'],
    ['Your data', 'yourData', 'Your data'],
    ['Change password', 'changePassword', 'Change password'],
  ] as const) {
    await step(`${row} opens its drawer on the You page, and Back closes it`, async () => {
      await youRow(page, row).click();
      await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/you/account\\?from=payments&${key}=true`));
      await page.goBack();
      await expect(page.getByRole('dialog', { name: dialog })).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/you/account\\?from=payments$`));
    });
  }

  await step('On You › Profiles, New profile and Manage profiles do the same', async () => {
    await page.locator('nav.hp-section-tabs--segmented').getByRole('link').first().click();
    for (const [row, key, dialog] of [
      ['+ New profile', 'newProfile', 'New profile'],
      ['Manage profiles', 'manageProfiles', 'Profiles'],
    ] as const) {
      await youRow(page, row).click();
      await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/you\\?from=payments&${key}=true`));
      await page.goBack();
      await expect(page.getByRole('dialog', { name: dialog })).toHaveCount(0);
    }
  });
});

test('signed out on this device, the You page shows only what needs no account', { tag: '@portal.you.signed-out' }, async ({ page, step }) => {
  await signedOutServer(page);
  const main = page.getByRole('main');
  const rows = main.locator('.hp-you-row');

  await step('Open the portal with nobody signed in', async () => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  });

  await step('You › Account: On this device, then Sign in and Your data only', async () => {
    await openYou(page, 'account');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('On this device');
    await expect(main.locator('.hp-you-who small')).toHaveCount(0);
    await expect(rows).toHaveText(['Sign in', /^Your data/]);
  });

  await step('You › App: Language and the terms only', async () => {
    await openYou(page, 'app');
    await expect(rows).toHaveText([/^Language/, /^Terms of service/]);
    await expect(main.getByRole('switch')).toHaveCount(0);
  });

  await step('You › Profiles: no Hosted chip, no note about the local app, and nothing that needs an account', async () => {
    await openYou(page, 'profiles');
    await expect(main.getByText('Hosted', { exact: true })).toHaveCount(0);
    await expect(main.getByText(/stay in the MTB3A app on your device/)).toHaveCount(0);
    await expect(main.getByText(/Billing|Change password|Sign out|Malafat|iPhone|Android|Share anonymous usage/)).toHaveCount(0);
  });
});

test('on a 375px phone in Arabic, each part of the You page and the top bar fit without sideways scroll', { tag: '@portal.you.phone-rtl' }, async ({ page, step }) => {
  await page.setViewportSize(PHONE);
  const long = office(OFFICE_A, 'مكتب الحداد والشركاء للمحاماة والاستشارات القانونية');
  const api = new FakeApi({ profiles: [long, office(OFFICE_B, 'Nour Accounting')], locale: 'ar' });
  const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  await step('Open Payments on a profile with a long Arabic name: the top bar fits', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const side = page.locator('.hp-side');
    await expect(side).toBeVisible();
    expect(await side.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await noSidewaysScroll()).toBe(true);
  });

  for (const part of ['profiles', 'account', 'app'] as const) {
    await step(`You › ${part}: right to left, no sideways scroll`, async () => {
      await openYou(page, part);
      expect(await noSidewaysScroll()).toBe(true);
      await attachScreenshot(page, `portal-you-${part}-ar-375`);
    });
  }
});

test('a locked profile still opens the You page under the locked banner, and Billing is a press away', { tag: '@portal.you.locked' }, async ({ page, step }) => {
  const billing = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null } as const;
  const overview = {
    configured: true,
    subscription: null,
    canManage: false,
    trial: { startedAt: new Date(Date.now() - 31 * DAY).toISOString(), endsAt: new Date(Date.now() - 17 * DAY).toISOString(), lockAt: new Date(Date.now() - DAY).toISOString() },
    catalog: { ILS: { month: 4900, year: 49000 }, USD: { month: 1600, year: 16000 } },
    countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
    coveredProfileIds: [OFFICE_A],
  };
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), billing }], billingStanding: 'locked', billing: overview });

  await step('Open the locked profile: one page, Subscribe or download your records', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await expect(page.getByRole('heading', { name: 'Subscribe or download your records' })).toBeVisible();
  });

  await step('Open You › Account from the avatar: the page shows, under the locked banner', async () => {
    await openYou(page, 'account');
    await expect(page.getByRole('region', { name: 'Your plan' })).toContainText('Subscribe or download your records');
    await expect(youRow(page, 'Billing')).toContainText('Locked');
  });

  await step('Billing opens the Billing drawer', async () => {
    await youRow(page, 'Billing').click();
    await expect(page).toHaveURL(/billing=true/);
    await expect(page.getByRole('dialog', { name: 'Billing' })).toBeVisible();
  });
});
