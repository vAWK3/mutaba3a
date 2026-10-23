import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { enableOptionalArea, openNewIncomeDrawer } from '../../support/app';
import { LANGUAGE_KEYS } from '../../support/i18n';

/**
 * Opens a fresh install and leaves the first-run Welcome dialog up. Unlike
 * openFreshApp it never presses "Skip for now": these specs test the paths the
 * dialog offers. It chooses English the same way openFreshApp does (MUT-209).
 */
async function openFirstRun(page: Page, path = '/'): Promise<Locator> {
  await page.addInitScript((keys) => {
    if (localStorage.getItem(keys.chosen) === null) {
      localStorage.setItem(keys.language, 'en');
      localStorage.setItem(keys.chosen, '1');
    }
  }, LANGUAGE_KEYS);
  await page.goto(`/app${path}`);
  return page.getByRole('dialog', { name: 'Welcome to MTB3A' });
}

/** The sidebar's business switcher, named by the business it shows. */
function businessSwitcher(page: Page, name: RegExp): Locator {
  return page.getByRole('complementary').getByRole('button', { name });
}

/** One numbered circle of Get Started's step indicator. */
function stepNumber(page: Page, n: number): Locator {
  return page.getByRole('main').getByText(String(n), { exact: true });
}

test('Set Up Now names the first business', { tag: '@web.onboarding.welcome-set-up' }, async ({ page, step }) => {
  let welcome = page.locator('[role="dialog"]');
  const drawer = page.getByRole('dialog').filter({ hasText: 'New Business Profile' });

  await step('Open a fresh install', async () => {
    welcome = await openFirstRun(page);
    await expect(welcome).toBeVisible();
    await expect(welcome).toContainText('What is a Business Profile?');
    await expect(welcome.getByRole('button', { name: 'Set Up Now' })).toBeVisible();
  });

  await step('Click Set Up Now', async () => {
    await welcome.getByRole('button', { name: 'Set Up Now' }).click();
    await expect(drawer).toBeVisible();
    await expect(welcome).toBeHidden();
  });

  await step('Cancel the drawer: the welcome comes back', async () => {
    await drawer.getByRole('button', { name: 'Cancel' }).click();
    await expect(drawer).toBeHidden();
    await expect(welcome).toBeVisible();
  });

  await step('Set Up Now again, name the business and save', async () => {
    await welcome.getByRole('button', { name: 'Set Up Now' }).click();
    await drawer.getByLabel(/Business Name \(Arabic\)/).fill('Nour Studio');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(welcome).toBeHidden();
  });

  await step('The sidebar works in Nour Studio, and the welcome stays gone after a reload', async () => {
    await expect(businessSwitcher(page, /Nour Studio/)).toBeVisible();
    await page.reload();
    await expect(businessSwitcher(page, /Nour Studio/)).toBeVisible();
    await expect(welcome).toBeHidden();
  });

  await step('Settings lists Nour Studio as the default business', async () => {
    await page.goto('/app/settings');
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Nour Studio', exact: true })).toBeVisible();
    await expect(main.getByText('Default', { exact: true })).toBeVisible();
  });
});

test('Skip for now, then Get Started adds the first client', { tag: '@web.onboarding.get-started' }, async ({ page, step }) => {
  await step('Open a fresh install and click Skip for now', async () => {
    const welcome = await openFirstRun(page);
    await welcome.getByRole('button', { name: 'Skip for now' }).click();
    await expect(welcome).toBeHidden();
  });

  await step('The app works in a USD "Default Profile"', async () => {
    await expect(businessSwitcher(page, /Default Profile/)).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: /^Exchange rate: \$1 =/ })).toBeVisible();
  });

  await step('Home shows Get Started with two numbered steps', async () => {
    await expect(page.getByRole('heading', { name: 'Get Started' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add Your First Client' })).toBeVisible();
    await expect(stepNumber(page, 1)).toBeVisible();
    await expect(stepNumber(page, 2)).toBeVisible();
    // Projects is off on a fresh install, so there is no project step (TD-027)
    await expect(stepNumber(page, 3)).toHaveCount(0);
  });

  await step('Click Add Client, name the client and save', async () => {
    await page.getByRole('main').getByRole('button', { name: 'Add Client' }).click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'New Client' });
    await expect(drawer).toBeVisible();
    await drawer.getByPlaceholder('Client name...').fill('Acme Studio');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
  });

  await step('Home leaves Get Started for the dashboard, and the client is on Clients', async () => {
    await expect(page.getByRole('heading', { name: 'Get Started' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Owed now' })).toBeVisible();
    await page.goto('/app/clients');
    await expect(page.getByRole('link', { name: 'Acme Studio' }).first()).toBeVisible();
  });
});

test('with Projects on, Get Started counts three steps, and Skip for now sticks', { tag: '@web.onboarding.get-started-skip' }, async ({ page, step }) => {
  await step('Open a fresh install, skip the welcome, and turn Projects on in Settings', async () => {
    const welcome = await openFirstRun(page);
    await welcome.getByRole('button', { name: 'Skip for now' }).click();
    await expect(welcome).toBeHidden();
    await enableOptionalArea(page, 'Projects');
  });

  await step('Home shows Get Started with three numbered steps', async () => {
    await page.goto('/app/');
    await expect(page.getByRole('heading', { name: 'Get Started' })).toBeVisible();
    for (const n of [1, 2, 3]) await expect(stepNumber(page, n)).toBeVisible();
  });

  await step('Click Skip for now', async () => {
    await page.getByRole('main').getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('heading', { name: 'Get Started' })).toBeHidden();
    await expect(page.getByText('Nothing to track yet')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Add income' })).toBeVisible();
  });

  await step('Reload: Home stays on the empty state, with no welcome', async () => {
    await page.reload();
    await expect(page.getByText('Nothing to track yet')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Get Started' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Welcome to MTB3A' })).toHaveCount(0);
  });
});

// ?demo=1 is the internal sales-demo switch. Show Demo seeds three sample businesses, shows a summary,
// and Get Started opens the first of them (MUT-220; the summary itself is onboarding.demo-summary).
test('demo mode seeds sample businesses, freezes time and resets', { tag: '@web.onboarding.demo-mode' }, async ({ page, step }) => {
  const demo = page.getByRole('dialog', { name: 'Activate Demo Mode' });
  const banner = page.getByRole('banner').filter({ hasText: 'Demo Mode' });
  const sampleBusiness = page.getByRole('option', { name: /شركة التقنية المتقدمة/ });

  await step('Open /?demo=1 on a fresh install and skip the welcome', async () => {
    const welcome = await openFirstRun(page, '/?demo=1');
    await welcome.getByRole('button', { name: 'Skip for now' }).click();
    await expect(welcome).toBeHidden();
    await expect(page).toHaveURL(/\/app\/$/);
  });

  await step('Read what the demo will create', async () => {
    await expect(demo).toBeVisible();
    await expect(demo).toContainText('3 business profiles');
    await expect(demo).toContainText('10 clients with contact info');
    await expect(demo).toContainText('60+ transactions (6 months history)');
  });

  await step('Click Show Demo, then Get Started on the summary', async () => {
    await demo.getByRole('button', { name: 'Show Demo' }).click();
    await demo.getByRole('button', { name: 'Get Started' }).click({ timeout: 30_000 });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(demo).toBeHidden();
  });

  await step('The app is on a sample business: its clients are there', async () => {
    await expect(businessSwitcher(page, /Default Profile/)).toHaveCount(0);
    await page.goto('/app/clients');
    await expect(page.getByRole('link', { name: 'مطعم الشرق' }).first()).toBeVisible();
  });

  await step('Click Freeze Time, then Real Time', async () => {
    await banner.getByRole('button', { name: 'Freeze Time' }).click();
    await expect(banner).toContainText('Time: Jan 15, 2025');
    await banner.getByRole('button', { name: 'Real Time' }).click();
    await expect(banner).not.toContainText('Time:');
  });

  await step('Click Reset and confirm', async () => {
    page.once('dialog', (dialog) => void dialog.accept());
    await banner.getByRole('button', { name: 'Reset' }).click();
    await expect(banner).toBeHidden();
  });

  await step('The sample is gone: only Default Profile is left, with no clients', async () => {
    await page.goto('/app/clients');
    await expect(page.getByText('No clients found')).toBeVisible();
    await businessSwitcher(page, /Default Profile/).click();
    await expect(page.getByRole('complementary').getByRole('option')).toHaveCount(1);
    await expect(sampleBusiness).toHaveCount(0);
  });
});

test('after Show Demo, a summary opens the app on a sample business', { tag: '@web.onboarding.demo-summary' }, async ({ page, step }) => {
  const demo = page.getByRole('dialog', { name: 'Activate Demo Mode' });

  await step('Open /?demo=1 on a fresh install, skip the welcome, and click Show Demo', async () => {
    const welcome = await openFirstRun(page, '/?demo=1');
    await welcome.getByRole('button', { name: 'Skip for now' }).click();
    await demo.getByRole('button', { name: 'Show Demo' }).click();
  });

  await step('Read the Demo Mode Activated summary and click Get Started', async () => {
    await expect(demo).toContainText('Demo Mode Activated', { timeout: 20_000 });
    await expect(demo).toContainText('Clients');
    await demo.getByRole('button', { name: 'Get Started' }).click();
  });

  await step('The app reloads on a sample business, with its data on Home', async () => {
    await expect(businessSwitcher(page, /Default Profile/)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Owed now' })).not.toContainText('Nothing owed');
  });
});

// MUT-78: the landing page's "Open the web app" link carries ?sample=1.
test('the landing page sample opens with no dialogs and leaves cleanly', { tag: '@web.onboarding.sample' }, async ({ page, step }) => {
  const bar = page.getByRole('region', { name: 'Sample data' });

  await step('Open /?sample=1 on a fresh install', async () => {
    await openFirstRun(page, '/?sample=1');
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar).toContainText("You're looking at sample data.");
  });

  await step('The sample business is open, with money owed, and no welcome', async () => {
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.getByRole('dialog', { name: 'Welcome to MTB3A' })).toHaveCount(0);
    await expect(businessSwitcher(page, /شركة التقنية المتقدمة/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Owed now' })).not.toContainText('Nothing owed');
  });

  await step('Add an income entry while looking around', async () => {
    const drawer = await openNewIncomeDrawer(page);
    await drawer.getByLabel(/^Amount/).fill('150');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
  });

  await step('Click Start with your own: it asks first, and Keep looking keeps the sample', async () => {
    await bar.getByRole('button', { name: 'Start with your own' }).click();
    await expect(bar.getByRole('alert')).toHaveText('This also removes the 1 thing you added while looking around.');
    await bar.getByRole('button', { name: 'Keep looking' }).click();
    await expect(bar).toContainText("You're looking at sample data.");
  });

  await step('Click Start with your own, then Start fresh', async () => {
    await bar.getByRole('button', { name: 'Start with your own' }).click();
    await bar.getByRole('button', { name: 'Start fresh' }).click();
    await expect(bar).toBeHidden();
  });

  await step('The app is back at its first run', async () => {
    await expect(page.getByRole('dialog', { name: 'Welcome to MTB3A' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Get Started' })).toBeVisible();
  });
});
