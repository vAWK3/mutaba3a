import { test, expect, uniq } from '../../support/qa';
import { openFreshApp, enableOptionalArea } from '../../support/app';
import type { Locator, Page } from '@playwright/test';

// Projects is an optional area (ADR-032): off on a fresh install, so every test
// turns it on in Settings › Advanced features first, as a user would.

/** Opens the top bar's "+ Add" menu and picks one of its items. */
async function addFromTopBar(page: Page, item: 'Income' | 'Client' | 'Project'): Promise<void> {
  await page.getByRole('main').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** Adds a client through the + Add menu's Client drawer. */
async function addClient(page: Page, name: string): Promise<void> {
  await addFromTopBar(page, 'Client');
  const drawer = page.getByRole('dialog').filter({ hasText: 'New Client' });
  await drawer.getByPlaceholder('Client name...').fill(name);
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** A drawer's native select, found by the placeholder option it carries (its label is not tied to it). */
function selectWithPlaceholder(page: Page, drawer: Locator, placeholder: string): Locator {
  return drawer.getByRole('combobox').filter({ has: page.locator('option', { hasText: placeholder }) });
}

/** Creates a project for `client` in the New Project drawer, opened from the + Add menu. */
async function addProject(page: Page, project: { name: string; client: string; field: string }): Promise<void> {
  await addFromTopBar(page, 'Project');
  const drawer = page.getByRole('dialog').filter({ hasText: 'New Project' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('Project name...').fill(project.name);
  await selectWithPlaceholder(page, drawer, 'Select client...').selectOption({ label: project.client });
  await selectWithPlaceholder(page, drawer, 'Select field...').selectOption({ label: project.field });
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/**
 * Logs income against a project, picking the project first in the drawer's
 * project typeahead (More details). Picking it fills in the project's client.
 */
async function logIncomeForProject(
  page: Page,
  drawer: Locator,
  entry: { title: string; amount: string; project?: string; client: string },
): Promise<void> {
  await drawer.getByLabel('What did you do?').fill(entry.title);
  await drawer.getByLabel(/^Amount/).fill(entry.amount);
  await drawer.getByRole('button', { name: 'More details' }).click();
  const projectField = drawer.getByPlaceholder('Select project...');
  if (entry.project) {
    await projectField.click();
    await projectField.pressSequentially(entry.project.slice(0, 6));
    await page.getByRole('option', { name: entry.project }).click();
  }
  await expect(projectField).toHaveValue(entry.project ?? '');
  // The client follows the project (useClientProjectCascade)
  await expect(drawer.getByPlaceholder('Search or create client...')).toHaveValue(entry.client);
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** Opens one amount's currency breakdown and returns the USD line's text. */
async function usdBreakdown(page: Page, trigger: Locator): Promise<Locator> {
  await trigger.click();
  // The breakdown is portalled to <body>: its USD row is the label's parent
  return page.getByText('USD', { exact: true }).last().locator('xpath=..');
}

test(
  'turn on Projects and create a project for a client in the drawer',
  { tag: '@web.projects.create' },
  async ({ page, step }) => {
    const client = uniq('Northwind');
    const project = uniq('Brand refresh');

    await step('Turn on Projects in Settings', async () => {
      await openFreshApp(page, '/');
      await enableOptionalArea(page, 'Projects');
    });

    await step('Open Projects from the sidebar', async () => {
      await page.getByRole('navigation').getByRole('link', { name: 'Projects' }).click();
      await expect(page).toHaveURL(/\/app\/projects$/);
      await expect(page.getByText('No projects found')).toBeVisible();
    });

    await step('Add a client', async () => {
      await addClient(page, client);
    });

    await step('Create a project for the client from + Add › Project', async () => {
      await addProject(page, { name: project, client, field: 'Design' });
    });

    await step('See the project in the Projects index with its client and field', async () => {
      const row = page.getByRole('row').filter({ hasText: project });
      await expect(row).toBeVisible();
      await expect(row).toContainText(client);
      await expect(row).toContainText('Design');
      await expect(page.getByText('1 project', { exact: true })).toBeVisible();
    });
  },
);

test(
  'income logged against a project shows in its totals on the Projects index',
  { tag: '@web.projects.index-totals' },
  async ({ page, step }) => {
    const client = uniq('Northwind');
    const project = uniq('Brand refresh');

    await step('Turn on Projects and create a project for a client', async () => {
      await openFreshApp(page, '/');
      await enableOptionalArea(page, 'Projects');
      await page.goto('/app/projects');
      await addClient(page, client);
      await addProject(page, { name: project, client, field: 'Development' });
    });

    await step('Log $1,200 of income, picking the project in the drawer', async () => {
      await addFromTopBar(page, 'Income');
      const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
      await logIncomeForProject(page, drawer, { title: 'Homepage build', amount: '1200', project, client });
    });

    await step("Open the Unpaid amount's currency breakdown on the project's row", async () => {
      await page.goto('/app/projects');
      const row = page.getByRole('row').filter({ hasText: project });
      await expect(row).toBeVisible();
      // Columns: Received, Unpaid, Expenses, Net
      const usd = await usdBreakdown(page, row.getByRole('button', { name: 'Show currency breakdown' }).nth(1));
      await expect(usd).toContainText('$1,200');
    });
  },
);

test(
  'the project detail lists the income logged against it, and adds more with the project prefilled',
  { tag: '@web.projects.detail' },
  async ({ page, step }) => {
    const client = uniq('Northwind');
    const project = uniq('Brand refresh');

    await step('Turn on Projects, create a project and log income against it', async () => {
      await openFreshApp(page, '/');
      await enableOptionalArea(page, 'Projects');
      await page.goto('/app/projects');
      await addClient(page, client);
      await addProject(page, { name: project, client, field: 'Consulting' });
      await addFromTopBar(page, 'Income');
      const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
      await logIncomeForProject(page, drawer, { title: 'Discovery workshop', amount: '800', project, client });
    });

    await step('Open the project from the Projects index', async () => {
      await page.goto('/app/projects');
      await page.getByRole('link', { name: project }).click();
      await expect(page).toHaveURL(/\/app\/projects\/[\w-]+$/);
      await expect(page.getByRole('heading', { level: 1, name: project })).toBeVisible();
      await expect(page.getByRole('main')).toContainText(client);
    });

    await step('Add Transaction from the project: the drawer has the project and client filled in', async () => {
      await page.getByRole('main').getByRole('button', { name: 'Add Transaction' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
      await expect(drawer).toBeVisible();
      await drawer.getByLabel('What did you do?').fill('Follow-up session');
      await drawer.getByLabel(/^Amount/).fill('200');
      await drawer.getByRole('button', { name: 'More details' }).click();
      await expect(drawer.getByPlaceholder('Select project...')).toHaveValue(project);
      await expect(drawer.getByPlaceholder('Search or create client...')).toHaveValue(client);
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    await step('Open the Transactions tab and see both entries', async () => {
      await page.getByRole('main').getByRole('button', { name: 'Transactions', exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: 'Discovery workshop' })).toContainText('$800');
      await expect(page.getByRole('row').filter({ hasText: 'Follow-up session' })).toContainText('$200');
    });

    await step("The project's Unpaid total covers both", async () => {
      const usd = await usdBreakdown(
        page,
        page.getByRole('main').getByRole('button', { name: 'Show currency breakdown' }).nth(1),
      );
      await expect(usd).toContainText('$1,000');
    });
  },
);
