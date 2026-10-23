import { test, expect } from '../../support/qa';
import { addSecondBusiness, logIncome, openFreshApp, switchToArabic } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { ar } from '../../support/i18n';

test(
  'switches the language to Arabic (right-to-left) and back',
  { tag: '@web.settings.language' },
  async ({ page, step }) => {
    await openFreshApp(page, '/settings');
    const main = page.getByRole('main');
    const html = page.locator('html');
    // Language is a radiogroup named by its row label since MUT-139, not a heading
    await expect(main.getByRole('radiogroup', { name: 'Language' })).toBeVisible();

    // Found through main, not the group: the group's name turns Arabic with the page
    await step('Click العربية', async () => {
      const arabic = main.getByRole('radio', { name: 'العربية' });
      await arabic.click();
      await expect(arabic).toHaveAttribute('aria-checked', 'true');
      await expect(html).toHaveAttribute('lang', 'ar');
      await expect(html).toHaveAttribute('dir', 'rtl');
    });

    await step('Click English', async () => {
      const english = main.getByRole('radio', { name: 'English' });
      await english.click();
      await expect(english).toHaveAttribute('aria-checked', 'true');
      await expect(html).toHaveAttribute('lang', 'en');
      await expect(html).toHaveAttribute('dir', 'ltr');
    });

    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'settings');
    });
  },
);

test(
  'switches between the dark, light and system themes',
  { tag: '@web.settings.theme' },
  async ({ page, step }) => {
    await openFreshApp(page, '/settings');
    // Theme is a radiogroup since MUT-139. Scoped to it, so the sidebar's theme
    // toggle button ("Theme: System") is never the one clicked.
    const theme = page.getByRole('main').getByRole('radiogroup', { name: 'Theme' });
    const html = page.locator('html');
    await expect(theme).toBeVisible();

    await step('Click Dark', async () => {
      const dark = theme.getByRole('radio', { name: 'Dark', exact: true });
      await dark.click();
      await expect(dark).toHaveAttribute('aria-checked', 'true');
      await expect(html).toHaveAttribute('data-theme', 'dark');
    });

    await step('Click Light', async () => {
      const light = theme.getByRole('radio', { name: 'Light', exact: true });
      await light.click();
      await expect(light).toHaveAttribute('aria-checked', 'true');
      await expect(html).toHaveAttribute('data-theme', 'light');
    });

    await step('Click System', async () => {
      // System drops the attribute and lets prefers-color-scheme decide
      const system = theme.getByRole('radio', { name: 'System', exact: true });
      await system.click();
      await expect(system).toHaveAttribute('aria-checked', 'true');
      await expect(html).not.toHaveAttribute('data-theme');
    });
  },
);

test('Your data exports one business', { tag: '@web.settings.export' }, async ({ page, step }) => {
  await openFreshApp(page, '/settings');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Your data' })).toBeVisible();

  await step('Open Export a business', async () => {
    await main.getByRole('button', { name: 'Export…' }).click();
    await expect(page.getByRole('dialog', { name: 'Export a business' })).toBeVisible();
  });

  await step('Export the default profile', async () => {
    const dialog = page.getByRole('dialog', { name: 'Export a business' });
    // CSV is the format the dialog picks first
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export Default Profile' }).click();
    expect((await download).suggestedFilename()).toMatch(/^mtb3a-Default-Profile-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});


test('Settings offers Malafat, says so once after a second business, and the switch turns suggestions off (MUT-190)', { tag: '@web.settings.malafat' }, async ({ page, step }) => {
  const main = page.getByRole('main');
  const note = main.getByRole('group', { name: 'A suggestion for your new business' });
  const clientsCard = main.getByRole('group', { name: 'A suggestion for law firms and accounting offices' });
  const rowText = 'For law firms and accounting offices: Malafat manages your clients, documents and fee agreements, and connects to an MTB3A hosted account.';

  await step('The MTB3A + Malafat row has one link to Malafat, tagged for Settings', async () => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Retainer', amount: '500', client: 'Nour Legal' });
    await page.goto('/app/settings');
    await expect(main.getByText('MTB3A + Malafat')).toBeVisible();
    await expect(main.getByText(rowText)).toBeVisible();
    const link = main.getByRole('link', { name: /See Malafat/ });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', /malafat\.app\/en\/contact\?topic=mutaba3a&utm_source=mutaba3a&utm_medium=web-local&utm_campaign=malafat-upsell&utm_content=settings/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.locator('.go-hosted-card')).toBeVisible();
  });

  await step('After a second business, the row becomes a note about it, and the Go hosted card steps aside', async () => {
    await addSecondBusiness(page, 'مكتب المحاسبة');
    await expect(note).toBeVisible();
    await expect(main.getByRole('link', { name: /See Malafat/ })).toHaveCount(1);
    await expect(note.getByRole('link')).toHaveAttribute('href', /utm_content=business-profile/);
    await expect(page.locator('.go-hosted-card')).toHaveCount(0);
  });

  await step('Dismissing it brings the row back with focus on its link', async () => {
    await note.getByRole('button', { name: "Don't show this again" }).click();
    await expect(note).toHaveCount(0);
    await expect(main.getByText(rowText)).toBeVisible();
    await expect(main.getByRole('link', { name: /See Malafat/ })).toBeFocused();
  });

  await step('The dismissal was saved: after a reload, Clients shows no second-business card either', async () => {
    await page.goto('/app/clients');
    await expect(main.getByRole('table')).toBeVisible();
    // The card waits for the settings read, which can land after the table: give it the time it would need to appear
    await page.waitForTimeout(1000);
    await expect(clientsCard).toHaveCount(0);
  });

  await step('The switch turns suggestions off and stays off; the row stays', async () => {
    await page.goto('/app/settings');
    const toggle = main.getByRole('switch', { name: 'Show Malafat suggestions' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.reload();
    await expect(main.getByRole('switch', { name: 'Show Malafat suggestions' })).toHaveAttribute('aria-checked', 'false');
    await expect(main.getByText(rowText)).toBeVisible();
  });

  await step('In Arabic the row reads right to left and links to Malafat in Arabic', async () => {
    await switchToArabic(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(main.getByText('متابعة + Malafat')).toBeVisible();
    await expect(main.getByRole('link', { name: /اطّلع على Malafat/ })).toHaveAttribute('href', /malafat\.app\/ar\/contact/);
  });
});

test.describe('in an English browser where nobody chose a language', () => {
  test.use({ locale: 'en-US' });

  test('the web app opens in Arabic until a person chooses, and English sticks once chosen (MUT-209)', { tag: '@web.settings.arabic-default' }, async ({ page, step }) => {
    const html = page.locator('html');

    await step('A first visit opens in Arabic, right to left, welcome included', async () => {
      await page.goto('/app/');
      await expect(html).toHaveAttribute('lang', 'ar');
      await expect(html).toHaveAttribute('dir', 'rtl');
      const welcome = page.getByRole('dialog', { name: ar.welcome.title });
      await expect(welcome).toBeVisible();
      await welcome.getByRole('button', { name: ar.onboarding.skip }).click();
      await expect(welcome).toBeHidden();
    });

    await step('Choosing English in Settings switches the app, and it stays English after a reload', async () => {
      await page.goto('/app/settings');
      await page.getByRole('main').getByRole('radio', { name: 'English' }).click();
      await expect(html).toHaveAttribute('lang', 'en');
      await page.reload();
      await expect(html).toHaveAttribute('lang', 'en');
      await expect(html).toHaveAttribute('dir', 'ltr');
    });
  });
});

