import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome, openNewIncomeDrawer, switchToArabic, addSecondBusiness } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { ar } from '../../support/i18n';

// MUT-83 (ADR-049): Owed now on Home and on Clients always match. Income with
// no client is counted on both, shown on Clients as a muted "No client" row
// that opens the entries behind it.
test(
  "the Clients strip's Owed Now equals Home's, including a No client row",
  { tag: '@web.clients.owed-now-parity' },
  async ({ page, step }) => {
    await step('Log one income entry for a client and one with no client', async () => {
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });

      const drawer = await openNewIncomeDrawer(page);
      await drawer.getByLabel('What did you do?').fill('Walk-in job');
      await drawer.getByLabel(/^Amount/).fill('300');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    let home: string[] = [];
    await step('Open Home and read Owed Now', async () => {
      await page.goto('/app/');
      home = await page.getByRole('region', { name: 'Owed now' }).getByTestId('owed-now-amount').allTextContents();
      expect(home).toEqual(['$1,500']);
    });

    await step('Open Clients and find the "No client" row', async () => {
      await page.goto('/app/clients');
      const noClient = page.getByRole('link', { name: 'No client · 1 entry' });
      await expect(noClient).toBeVisible();
      const clientsOwedNow = await page
        .getByRole('region', { name: 'Owed now' })
        .getByTestId('owed-now-amount')
        .allTextContents();
      expect(clientsOwedNow).toEqual(home);
    });

    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'clients');
    });
  },
);

test(
  'the "No client" row opens Income filtered to that entry, with a clearable chip',
  { tag: '@web.clients.no-client-filter' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    const drawer = await openNewIncomeDrawer(page);
    await drawer.getByLabel(/^Amount/).fill('300');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();

    let chip = page.locator('button');
    await step('Click the "No client" row on Clients', async () => {
      await page.goto('/app/clients');
      await page.getByRole('link', { name: 'No client · 1 entry' }).click();

      await expect(page).toHaveURL(/\/app\/income\?.*client=none/);
      chip = page.getByRole('button', { name: 'Clear filter: No client' });
      await expect(chip).toBeVisible();
      const rows = page.getByRole('table').getByRole('row');
      await expect(rows).toHaveCount(2); // header + the one entry
      await expect(rows.nth(1)).toContainText('$300');
    });

    await step('Clear the filter chip', async () => {
      await chip.click();
      await expect(page).not.toHaveURL(/client=none/);
    });
  },
);

test("a client's profile shows their logged work", { tag: '@web.clients.profile' }, async ({ page, step }) => {
  await openFreshApp(page, '/income');
  await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });

  await step('Open the client from the Clients list', async () => {
    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'Acme Studio' }).first().click();
    await expect(page.getByRole('heading', { name: 'Work and billing' })).toBeVisible();
    await expect(page.getByText('Logo redesign')).toBeVisible();
  });

  await step('Check accessibility', async () => {
    await expectOnlyKnownAxeViolations(page, 'clientProfile');
  });
});

// MUT-84 (brief C1, ADR-050): on a wide window a client opens beside the
// list, like Mail. The run's 1280 × 720 window is exactly
// BREAKPOINTS.clientsSplit, so these specs see the split view; the resize
// spec narrows it to see the full-page profile.

/** A client's link in the list pane (the profile's own tables hold no client links) */
const clientLink = (page: Page, name: string) =>
  page.getByRole('main').getByRole('row').getByRole('link', { name, exact: true });
const profilePane = (page: Page, name = 'Client profile') => page.getByRole('region', { name });
/** Every client link in the list, in display order */
const listedClients = (page: Page) => page.getByRole('main').getByRole('row').getByRole('link');

/** The client id a list link opens */
async function clientIdOf(link: Locator): Promise<string> {
  const href = (await link.getAttribute('href')) ?? '';
  const id = /\/clients\/([^/?#]+)/.exec(href)?.[1];
  if (!id) throw new Error(`no client id in ${href}`);
  return id;
}

/** Three clients whose owed order (the default sort) is the reverse of their name order */
async function logThreeClients(page: Page) {
  await openFreshApp(page, '/income');
  await logIncome(page, { title: 'Logo redesign', amount: '300', client: 'Acme Studio' });
  await logIncome(page, { title: 'Brand book', amount: '800', client: 'Beta Labs' });
  await logIncome(page, { title: 'Site audit', amount: '1200', client: 'Cedar Co' });
}

/** The client is open beside the list: its link is the current page, the top bar and profile show it */
async function expectOpenBeside(page: Page, name: string, profileName?: string) {
  await expect(clientLink(page, name)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(profilePane(page, profileName)).toBeVisible();
}

test(
  'on a wide window a client opens beside the list, and the arrow keys walk the clients',
  { tag: '@web.clients.split-view' },
  async ({ page, step }) => {
    await logThreeClients(page);
    const cedar = clientLink(page, 'Cedar Co');
    const beta = clientLink(page, 'Beta Labs');
    const profile = profilePane(page);

    await step('Open Clients and click Cedar Co', async () => {
      await page.goto('/app/clients');
      await expect(listedClients(page)).toHaveText(['Cedar Co', 'Beta Labs', 'Acme Studio']);
      await cedar.click();
      await expect(page).toHaveURL(new RegExp(`/clients/${await clientIdOf(cedar)}`));
      await expectOpenBeside(page, 'Cedar Co');
      await expect(profile.getByRole('heading', { name: 'Work and billing' })).toBeVisible();
      await expect(beta).toBeVisible();
      await expect(cedar).toBeFocused();
    });

    await step('Press ↓ to open the next client', async () => {
      await page.keyboard.press('ArrowDown');
      await expect(page).toHaveURL(new RegExp(`/clients/${await clientIdOf(beta)}`));
      await expectOpenBeside(page, 'Beta Labs');
      await expect(beta).toBeFocused();
      await expect(cedar).not.toHaveAttribute('aria-current', 'page');
      await expect(profile.getByText('Brand book')).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Showing Beta Labs' })).toBeAttached();
    });

    await step('Press ↑ to go back to Cedar Co', async () => {
      await page.keyboard.press('ArrowUp');
      await expect(page).toHaveURL(new RegExp(`/clients/${await clientIdOf(cedar)}`));
      await expectOpenBeside(page, 'Cedar Co');
      await expect(cedar).toBeFocused();
    });

    await step('Press Enter to move into the profile, then Escape to come back', async () => {
      await page.keyboard.press('Enter');
      await expect(profile).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(cedar).toBeFocused();
    });

    await step('Press → to move into the profile, then ← to come back', async () => {
      await page.keyboard.press('ArrowRight');
      await expect(profile).toBeFocused();
      await page.keyboard.press('ArrowLeft');
      await expect(cedar).toBeFocused();
    });

    await step('Check accessibility with both panes showing', async () => {
      await expectOnlyKnownAxeViolations(page, 'clientsSplit');
    });

    await step('Go Back: the walk is one history entry, so the full list returns', async () => {
      await page.goBack();
      await expect(page).toHaveURL(/\/app\/clients\/?$/);
      await expect(profile).toBeHidden();
      await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    });
  },
);

test(
  'a deep link to a client with a sort opens both panes, sorted, and the walk keeps the sort',
  { tag: '@web.clients.split-view-deep-link' },
  async ({ page, step }) => {
    await logThreeClients(page);
    await page.goto('/app/clients');
    const betaId = await clientIdOf(clientLink(page, 'Beta Labs'));
    const cedarId = await clientIdOf(clientLink(page, 'Cedar Co'));

    await step('Open Beta Labs from a link sorted by name', async () => {
      await page.goto(`/app/clients/${betaId}?sort=name&dir=asc`);
      await expectOpenBeside(page, 'Beta Labs');
      await expect(profilePane(page).getByText('Brand book')).toBeVisible();
      await expect(listedClients(page)).toHaveText(['Acme Studio', 'Beta Labs', 'Cedar Co']);
      // The page opened on Beta Labs, so there is no change to announce
      await expect(page.getByRole('status').filter({ hasText: 'Showing' })).toHaveCount(0);
    });

    await step('Focus Beta Labs in the list and press ↓', async () => {
      await clientLink(page, 'Beta Labs').focus();
      await page.keyboard.press('ArrowDown');
      // Cedar Co comes after Beta Labs by name (by amount owed it would be first)
      await expect(page).toHaveURL(new RegExp(`/clients/${cedarId}\\?.*sort=name`));
      await expect(page).toHaveURL(/dir=asc/);
      await expectOpenBeside(page, 'Cedar Co');
      await expect(listedClients(page)).toHaveText(['Acme Studio', 'Beta Labs', 'Cedar Co']);
    });
  },
);

test(
  'resizing across the breakpoint keeps the open profile as it was',
  { tag: '@web.clients.split-view-resize' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    await logIncome(page, { title: 'Brand book', amount: '800', client: 'Beta Labs' });
    const profile = profilePane(page);
    const workSearch = profile.getByPlaceholder('Search...');

    await step('Open Acme Studio beside the list and search its work for "Logo"', async () => {
      await page.goto('/app/clients');
      await clientLink(page, 'Acme Studio').click();
      await expectOpenBeside(page, 'Acme Studio');
      await workSearch.fill('Logo');
      await expect(profile.getByText('Logo redesign')).toBeVisible();
    });

    await step('Narrow the window to 375 px: the profile fills the page', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(clientLink(page, 'Beta Labs')).toBeHidden();
      await expect(profile).toBeVisible();
      await expect(workSearch).toHaveValue('Logo');
    });

    await step('Widen it back to 1280 px: the list returns beside the same profile', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(clientLink(page, 'Beta Labs')).toBeVisible();
      await expect(workSearch).toHaveValue('Logo');
      await expect(profile.getByText('Logo redesign')).toBeVisible();
    });
  },
);

test(
  'in Arabic the list sits on the right and ← moves into the profile',
  { tag: '@web.clients.split-view-rtl' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    await logIncome(page, { title: 'Brand book', amount: '800', client: 'Beta Labs' });
    const acme = clientLink(page, 'Acme Studio');
    const profile = profilePane(page, ar.clients.split.profile);

    await step('Switch to Arabic, open Clients and click Acme Studio', async () => {
      await switchToArabic(page);
      await page.goto('/app/clients');
      await acme.click();
      await expectOpenBeside(page, 'Acme Studio', ar.clients.split.profile);
    });

    await step('Check the list is on the right of the profile', async () => {
      const list = await acme.boundingBox();
      const pane = await profile.boundingBox();
      if (!list || !pane) throw new Error('panes not laid out');
      expect(list.x).toBeGreaterThanOrEqual(pane.x + pane.width);
    });

    await step('Press ← to move into the profile, then → to come back', async () => {
      await expect(acme).toBeFocused();
      await page.keyboard.press('ArrowLeft');
      await expect(profile).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(acme).toBeFocused();
    });
  },
);


test('with a second business, Clients shows one Malafat suggestion; its link opens Malafat and retires it for good (MUT-190)', { tag: '@web.clients.malafat' }, async ({ page, context, step }) => {
  const main = page.getByRole('main');
  const card = main.getByRole('group', { name: 'A suggestion for law firms and accounting offices' });
  const search = main.getByPlaceholder('Search clients...');
  // Never reach the real site from QA: answer for it
  await context.route('https://malafat.app/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Malafat</title>' }));

  await step('Two businesses and a client in the working one; the Settings note is dismissed first', async () => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Retainer', amount: '500', client: 'Nour Legal' });
    await addSecondBusiness(page, 'مكتب المحاماة');
    // The note right after adding speaks for this event; reload so the Clients card is the one in play
    await page.reload();
  });

  await step('The Clients list shows one suggestion, tagged for the second business; none while searching', async () => {
    await page.goto('/app/clients');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Running more than one office?');
    await expect(card.getByRole('link')).toHaveAttribute('href', /utm_medium=web-local&utm_campaign=malafat-upsell&utm_content=second-business/);
    await search.fill('Nour');
    await expect(card).toHaveCount(0);
    await search.fill('');
    await expect(card).toBeVisible();
  });

  await step('Its link opens Malafat in a new tab, and the card goes', async () => {
    const opened = context.waitForEvent('page');
    await card.getByRole('link').click();
    const malafat = await opened;
    await expect(malafat).toHaveURL(/^https:\/\/malafat\.app\/en\/contact\?topic=mutaba3a&.*utm_content=second-business/);
    await malafat.close();
    await expect(card).toHaveCount(0);
  });

  await step('It stays gone after a reload: the click retired it', async () => {
    await page.reload();
    await expect(main.getByRole('table')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(card).toHaveCount(0);
  });
});

test(
  'Add Client names a client, refusing an empty name, and lists it',
  { tag: '@web.clients.add-client' },
  async ({ page, step }) => {
    await step('Open a fresh install at /clients', async () => {
      await openFreshApp(page, '/clients');
    });

    const drawer = page.getByRole('dialog').filter({ hasText: 'New Client' });
    await step('Click Add Client, then Save with the name empty', async () => {
      await page.getByRole('button', { name: 'Add Client' }).click();
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer.getByText('Name is required')).toBeVisible();
      await expect(drawer).toBeVisible();
    });

    await step('Type "Acme Studio" and Save', async () => {
      await drawer.getByPlaceholder('Client name...').fill('Acme Studio');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByRole('link', { name: 'Acme Studio' }).first()).toBeVisible();
    });
  },
);
