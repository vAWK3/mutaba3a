import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Opens an app route on a fresh install: every test starts with an empty
 * IndexedDB, so the welcome dialog always appears once the profile query
 * answers, and "Skip for now" creates the default (USD) profile.
 *
 * Wait for the dialog rather than checking isVisible() once: under parallel
 * load it can mount after that check and swallow the next click.
 */
export async function openFreshApp(page: Page, path = '/'): Promise<void> {
  await page.goto(`/app${path}`);
  const welcome = page.getByRole('dialog', { name: 'Welcome to Mutaba3a' });
  await welcome.getByRole('button', { name: 'Skip for now' }).click();
  await expect(welcome).toBeHidden();
}

/** Opens a new income entry from the top bar's "+ Add" menu, which every page has. */
export async function openNewIncomeDrawer(page: Page): Promise<Locator> {
  await page.getByRole('main').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Income' }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
  await expect(drawer).toBeVisible();
  return drawer;
}

/**
 * Logs one entry for a new client through the drawer and waits for it to
 * close. A `dueDate` (YYYY-MM-DD) puts it on Home's Needs attention when it is
 * past or within 7 days.
 */
export async function logIncome(
  page: Page,
  entry: { title: string; amount: string; client: string; dueDate?: string },
): Promise<void> {
  const drawer = await openNewIncomeDrawer(page);
  await drawer.getByLabel('What did you do?').fill(entry.title);
  await drawer.getByLabel(/^Amount/).fill(entry.amount);

  // The only option is "create <client>", already highlighted: Enter picks it,
  // and the field is busy until the client exists.
  const client = drawer.getByPlaceholder('Search or create client...');
  await client.click();
  await client.pressSequentially(entry.client);
  await page.keyboard.press('Enter');
  await expect(client).toHaveValue(entry.client);
  await expect(client).not.toHaveAttribute('aria-busy', 'true');

  if (entry.dueDate) {
    await drawer.getByRole('button', { name: 'More details' }).click();
    await drawer.getByLabel('Due Date').fill(entry.dueDate);
  }

  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** The local calendar date `days` from today, as YYYY-MM-DD (ADR-022). */
export function localDateFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Switches the app to Arabic from Settings' language control (a radio group since MUT-139), as a user would, and waits for the page to turn right-to-left. */
export async function switchToArabic(page: Page): Promise<void> {
  await page.goto('/app/settings');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

/**
 * Turns on an optional area (ADR-032: all off on a fresh install) from Settings,
 * by its English switch label. Call it before switching to Arabic.
 */
export async function enableOptionalArea(page: Page, label: 'Expenses' | 'Planning' | 'Retainers' | 'Insights' | 'Projects'): Promise<void> {
  await page.goto('/app/settings');
  const toggle = page.getByRole('switch', { name: label, exact: true });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}
