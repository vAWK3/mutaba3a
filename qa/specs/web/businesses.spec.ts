import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome, addSecondBusiness, localDateFromToday, openNewIncomeDrawer } from '../../support/app';

// openFreshApp's "Skip for now" makes the first business, "Default Profile" (USD)
const FIRST = 'Default Profile';
const SECOND = 'Nour Design';

/** The sidebar's business switcher, named by the business it shows. */
function switcher(page: Page): Locator {
  return page.getByRole('complementary').getByRole('button', { name: new RegExp(`${FIRST}|${SECOND}|All businesses`) });
}

/** Picks a business (or All businesses) from the sidebar's switcher. */
async function switchTo(page: Page, name: string): Promise<void> {
  await switcher(page).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(switcher(page)).toHaveAccessibleName(new RegExp(name));
}

/**
 * The top bar's "which business is this" indicator, shown once there are two businesses: its badge
 * and name, titled with the name. The top bar comes first in the page, before any list that names it.
 */
function topBarBusiness(page: Page, name: string): Locator {
  return page.getByRole('main').getByTitle(name, { exact: true }).first();
}

test('add a second business from Settings', { tag: '@web.businesses.create' }, async ({ page, step }) => {
  const drawer = page.getByRole('dialog').filter({ hasText: 'New Business Profile' });

  await step('Open a fresh install: one business, and the top bar does not name it', async () => {
    await openFreshApp(page, '/');
    await expect(switcher(page)).toHaveAccessibleName(new RegExp(FIRST));
    await expect(topBarBusiness(page, FIRST)).toHaveCount(0);
  });

  await step('Open Settings: Businesses lists Default Profile', async () => {
    await page.goto('/app/settings');
    await expect(page.getByRole('main').getByRole('button', { name: FIRST, exact: true })).toBeVisible();
  });

  await step('Click + Add Profile, name it, pick ILS as its currency and save', async () => {
    await page.getByRole('main').getByRole('button', { name: '+ Add Profile' }).click();
    await expect(drawer).toBeVisible();
    await drawer.getByLabel(/Business Name \(Arabic\)/).fill(SECOND);
    await drawer.getByLabel('Default currency').selectOption('ILS');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
  });

  await step('Settings lists both businesses; the first stays the default', async () => {
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: SECOND, exact: true })).toBeVisible();
    await expect(main.getByText('Default', { exact: true })).toHaveCount(1);
  });

  await step('The sidebar switcher lists both, and the app still works in the first', async () => {
    await expect(switcher(page)).toHaveAccessibleName(new RegExp(FIRST));
    await expect(topBarBusiness(page, FIRST)).toBeVisible();
    await switcher(page).click();
    await expect(page.getByRole('complementary').getByRole('option')).toHaveCount(2);
    await expect(page.getByRole('option', { name: new RegExp(SECOND) })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  await step('Switch to the new business: new income starts in ILS, filed in it', async () => {
    await switchTo(page, SECOND);
    await page.goto('/app/income');
    const income = await openNewIncomeDrawer(page);
    // The drawer's details summary: status · currency · date · business
    await expect(income).toContainText(new RegExp(`· ILS · .* · ${SECOND}`));
  });
});

test('each business shows only its own entries', { tag: '@web.businesses.switch' }, async ({ page, step }) => {
  const main = page.getByRole('main');

  await step('With two businesses, log Logo redesign in the first', async () => {
    await openFreshApp(page, '/income');
    await addSecondBusiness(page, SECOND);
    await page.goto('/app/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    await expect(main.getByRole('row', { name: /Logo redesign/ })).toBeVisible();
  });

  await step('Switch to the second business: its Income list is empty, and the top bar names it', async () => {
    await switchTo(page, SECOND);
    await expect(topBarBusiness(page, SECOND)).toBeVisible();
    // Its badge: the business's initial, named for assistive tech
    await expect(main.getByLabel(SECOND, { exact: true }).first()).toHaveText('N');
    await expect(main.getByRole('row', { name: /Logo redesign/ })).toHaveCount(0);
  });

  await step('Log Brand book there', async () => {
    await logIncome(page, { title: 'Brand book', amount: '800', client: 'Beta Labs' });
    await expect(main.getByRole('row', { name: /Brand book/ })).toBeVisible();
  });

  await step('Reload: the app is still in the second business', async () => {
    await page.reload();
    await expect(switcher(page)).toHaveAccessibleName(new RegExp(SECOND));
    await expect(main.getByRole('row', { name: /Brand book/ })).toBeVisible();
  });

  await step('Switch back to the first: only Logo redesign', async () => {
    await switchTo(page, FIRST);
    await expect(topBarBusiness(page, FIRST)).toBeVisible();
    await expect(main.getByRole('row', { name: /Logo redesign/ })).toBeVisible();
    await expect(main.getByRole('row', { name: /Brand book/ })).toHaveCount(0);
  });
});

test('under All businesses, + Add asks which business first', { tag: '@web.businesses.quick-picker' }, async ({ page, step }) => {
  const main = page.getByRole('main');
  const add = main.getByRole('button', { name: 'Add', exact: true });
  const picker = page.getByRole('listbox', { name: 'Choose profile' });

  await step('With two businesses, choose All businesses on Home', async () => {
    await openFreshApp(page, '/');
    await addSecondBusiness(page, SECOND);
    await page.goto('/app/');
    await switchTo(page, 'All businesses');
    await expect(topBarBusiness(page, 'All businesses')).toBeVisible();
  });

  await step('Click Add, then Income: a business picker opens on the first choice', async () => {
    await add.click();
    await page.getByRole('menuitem', { name: 'Income' }).click();
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('option')).toHaveCount(2);
    await expect(picker.getByRole('option').first()).toBeFocused();
  });

  await step('Arrow down moves to the next business; Escape closes it and returns focus to Add', async () => {
    await page.keyboard.press('ArrowDown');
    await expect(picker.getByRole('option').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(add).toBeFocused();
    await expect(page.getByRole('dialog').filter({ hasText: 'New Income' })).toHaveCount(0);
  });

  await step('Again, and pick the second business: the drawer opens for it', async () => {
    await add.click();
    await page.getByRole('menuitem', { name: 'Income' }).click();
    await picker.getByRole('option', { name: new RegExp(SECOND) }).click();
    await expect(picker).toBeHidden();
    const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel('What did you do?').fill('Site audit');
    await drawer.getByLabel(/^Amount/).fill('500');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
  });

  await step('The entry is filed in the second business', async () => {
    await page.goto('/app/income');
    await switchTo(page, SECOND);
    await expect(main.getByRole('row', { name: /Site audit/ })).toBeVisible();
    await switchTo(page, FIRST);
    await expect(main.getByRole('row', { name: /Site audit/ })).toHaveCount(0);
  });
});

// MUT-89 (ADR-051): Home and Clients can read every business at once, tagging each row with its business.
test('All businesses on Home and Clients tags each row with its business', { tag: '@web.businesses.all-businesses' }, async ({ page, step }) => {
  const main = page.getByRole('main');
  const dueSoon = localDateFromToday(3);

  await step('Log an entry due soon in each of two businesses', async () => {
    await openFreshApp(page, '/income');
    await addSecondBusiness(page, SECOND);
    await page.goto('/app/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio', dueDate: dueSoon });
    await switchTo(page, SECOND);
    await logIncome(page, { title: 'Brand book', amount: '800', client: 'Beta Labs', dueDate: dueSoon });
  });

  await step('Income offers no All businesses: it works in one business', async () => {
    await switcher(page).click();
    await expect(page.getByRole('option', { name: /All businesses/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  await step('On Home choose All businesses: both entries show, each tagged with its business', async () => {
    await page.goto('/app/');
    await switchTo(page, 'All businesses');
    const attention = main.getByRole('region', { name: 'Needs Attention' });
    await expect(attention).toContainText('Acme Studio');
    await expect(attention).toContainText('Beta Labs');
    await expect(attention).toContainText(FIRST);
    await expect(attention).toContainText(SECOND);
  });

  await step('Clients keeps All businesses and tags each client', async () => {
    await page.goto('/app/clients');
    await expect(topBarBusiness(page, 'All businesses')).toBeVisible();
    await expect(main.getByRole('row', { name: /Acme Studio/ })).toContainText(FIRST);
    await expect(main.getByRole('row', { name: /Beta Labs/ })).toContainText(SECOND);
  });

  await step('Pick a business: All businesses turns off and Clients shows only its client', async () => {
    await switchTo(page, FIRST);
    await expect(main.getByRole('row', { name: /Acme Studio/ })).toBeVisible();
    await expect(main.getByRole('row', { name: /Beta Labs/ })).toHaveCount(0);
  });
});

test('a client billed by two businesses shows an entry count for each', { tag: '@web.businesses.shared-client' }, async ({ page, step }) => {
  const main = page.getByRole('main');

  await step('Log an entry for Acme Studio in each of two businesses', async () => {
    await openFreshApp(page, '/income');
    await addSecondBusiness(page, SECOND);
    await page.goto('/app/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    await switchTo(page, SECOND);
    await logIncome(page, { title: 'Brand book', amount: '800', client: 'Acme Studio' });
  });

  await step("Open Clients: Acme Studio's row counts its entries in each business", async () => {
    await page.goto('/app/clients');
    const row = main.getByRole('row', { name: /Acme Studio/ });
    await expect(row).toHaveCount(1);
    await expect(row.getByTitle(FIRST)).toHaveText('D1 entries');
    await expect(row.getByTitle(SECOND)).toHaveText('N1 entries');
  });
});
