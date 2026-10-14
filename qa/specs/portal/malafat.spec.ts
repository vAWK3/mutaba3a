import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { OFFICE_A, OFFICE_B, malafatFirm, office, openSignedInPortal } from '../../support/portal';

/**
 * Malafat suggestions in the hosted portal (MUT-191, epic MUT-189). The portal
 * is signed in with every /v1 call stubbed (qa/support/portal.ts); the copy is
 * read from the portal's dictionaries so a wording change needs no spec change.
 */
const portalI18n = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/hosted/i18n');
type MalafatCopy = { hosted: { malafat: Record<'label' | 'businessCreated' | 'clientThreshold' | 'secondBusiness' | 'cta' | 'dismiss' | 'menuLink' | 'menuSwitch', string> } };
const copy = (language: 'en' | 'ar') => (JSON.parse(fs.readFileSync(path.join(portalI18n, `${language}.json`), 'utf8')) as MalafatCopy).hosted.malafat;
const EN = copy('en');
const AR = copy('ar');

test('the account menu offers Malafat after Sign out, and its switch turns suggestions off', { tag: '@portal.malafat.menu' }, async ({ page, step }) => {
  const stub = await openSignedInPortal(page, { profiles: [office(OFFICE_A, 'Nour Studio')], path: `/p/${OFFICE_A}` });

  await step('Open the account menu on an owned business profile', async () => {
    await page.getByRole('button', { name: /Account/ }).click();
  });

  const menu = page.getByRole('menu', { name: 'Account' });
  await step('Malafat sits after Sign out: a link with the portal referral, and the switch on', async () => {
    await expect(menu.locator('[role^="menuitem"]').first()).toHaveText('Sign out');
    const link = menu.getByRole('menuitem', { name: new RegExp(EN.menuLink) });
    await expect(link).toHaveAttribute('href', /\/en\/contact\?topic=mutaba3a&utm_source=mutaba3a&utm_medium=portal&utm_campaign=malafat-upsell&utm_content=settings/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(menu.getByRole('menuitemcheckbox', { name: EN.menuSwitch })).toHaveAttribute('aria-checked', 'true');
    await expectOnlyKnownAxeViolations(page, 'portalSignedIn', '[role="menu"]');
  });

  await step('Turn Malafat suggestions off; the menu stays open', async () => {
    await menu.getByRole('menuitemcheckbox', { name: EN.menuSwitch }).click();
    await expect(menu.getByRole('menuitemcheckbox', { name: EN.menuSwitch })).toHaveAttribute('aria-checked', 'false');
    expect(stub.malafatChanges).toEqual([{ off: true }]);
  });
});

test('Clients suggests Malafat to someone with two business profiles, never while searching, and a dismissal is kept', { tag: '@portal.malafat.clients' }, async ({ page, step }) => {
  const stub = await openSignedInPortal(page, {
    profiles: [office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Nour Accounting')],
    clients: 3,
    path: `/p/${OFFICE_A}/clients`,
  });
  const card = page.getByRole('group', { name: EN.label });

  await step('Open Clients on one of two business profiles', async () => {
    await expect(page.getByRole('table')).toBeVisible();
    await expect(card).toContainText('Running more than one office?');
    await expect(card.getByRole('link', { name: new RegExp(EN.cta) })).toHaveAttribute('href', /utm_medium=portal&utm_campaign=malafat-upsell&utm_content=second-business/);
    await expectOnlyKnownAxeViolations(page, 'portalSignedIn', '[role="group"]');
  });

  await step('Search the list: the suggestion steps aside', async () => {
    await page.getByPlaceholder('Search clients').fill('Client 1');
    await expect(card).toHaveCount(0);
    await page.getByPlaceholder('Search clients').fill('');
    await expect(card).toBeVisible();
  });

  await step("Choose Don't show this again: the card goes and the choice is saved for the account", async () => {
    await card.getByRole('button', { name: EN.dismiss }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByPlaceholder('Search clients')).toBeFocused();
    expect(stub.malafatChanges).toEqual([{ dismiss: ['business-profile', 'second-business'] }]);
  });

  await step('Reload: it stays gone', async () => {
    await page.reload();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(card).toHaveCount(0);
  });
});

test('in Arabic, Clients at ten active clients suggests Malafat right to left', { tag: '@portal.malafat.clients' }, async ({ page, step }) => {
  await openSignedInPortal(page, { profiles: [office(OFFICE_A, 'Nour Studio')], clients: 10, language: 'ar', path: `/p/${OFFICE_A}/clients` });
  await step('Open Clients with ten active clients, in Arabic', async () => {
    const card = page.getByRole('group', { name: AR.label });
    await expect(card).toHaveText(new RegExp(AR.clientThreshold.slice(0, 20)));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(card.getByRole('link', { name: new RegExp(AR.cta) })).toHaveAttribute('href', /\/ar\/contact\?.*utm_content=client-threshold/);
  });
});

test('See Malafat on the Clients card opens malafat.app in a new tab and retires the card', { tag: '@portal.malafat.clients' }, async ({ page, step }) => {
  await page.context().route('https://malafat.app/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Malafat</title>' }));
  const stub = await openSignedInPortal(page, { profiles: [office(OFFICE_A, 'Nour Studio')], clients: 10, path: `/p/${OFFICE_A}/clients` });
  const card = page.getByRole('group', { name: EN.label });

  await step('Choose See Malafat on the card', async () => {
    await expect(card).toBeVisible();
    const [tab] = await Promise.all([page.context().waitForEvent('page'), card.getByRole('link', { name: new RegExp(EN.cta) }).click()]);
    await tab.waitForLoadState();
    expect(tab.url()).toContain('https://malafat.app/en/contact?topic=mutaba3a&utm_source=mutaba3a&utm_medium=portal&utm_campaign=malafat-upsell&utm_content=client-threshold');
    await tab.close();
  });

  await step('Back on Clients: the card has gone and its moment is retired for the account', async () => {
    await expect(card).toHaveCount(0);
    expect(stub.malafatChanges).toEqual([{ dismiss: ['client-threshold'] }]);
  });
});

test('a new business profile opens with a one-line Malafat note', { tag: '@portal.malafat.created' }, async ({ page, step }) => {
  await openSignedInPortal(page, { profiles: [office(OFFICE_A, 'Nour Studio')], path: `/p/${OFFICE_A}` });

  await step('Create a Business profile from the profile switcher', async () => {
    await page.getByRole('button', { name: /Switch profile/ }).click();
    await page.getByRole('menuitem', { name: /New profile/ }).click();
    const drawer = page.getByRole('dialog', { name: 'New profile' });
    await drawer.getByLabel('Name').fill('Nour Legal');
    await drawer.getByRole('radio', { name: /^Business/ }).check();
    await drawer.getByRole('button', { name: 'Create profile' }).click();
  });

  await step('Land on the new profile: the note is there, above the page, once', async () => {
    const note = page.getByRole('group', { name: EN.label });
    await expect(note).toContainText(EN.businessCreated.slice(0, 40));
    await expect(note.getByRole('link', { name: new RegExp(EN.cta) })).toHaveAttribute('href', /utm_content=business-profile/);
    await expect(page.getByRole('dialog', { name: 'New profile' })).toHaveCount(0);
  });

  await step('Go to Clients and back to the overview: the note is not shown again, and Clients adds no second suggestion', async () => {
    await page.getByRole('link', { name: 'Clients' }).first().click();
    await expect(page.getByPlaceholder('Search clients')).toBeVisible();
    await expect(page.getByRole('group', { name: EN.label })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('group', { name: EN.label })).toHaveCount(0);
  });
});

test('someone already on Malafat sees no Malafat suggestion, in the menu or on Clients', { tag: '@portal.malafat.none' }, async ({ page, step }) => {
  await openSignedInPortal(page, { profiles: [malafatFirm(), office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Nour Accounting')], clients: 12, path: `/p/${OFFICE_A}/clients` });

  await step('Someone in a Malafat-fed firm opens Clients on their own office: no card', async () => {
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('group', { name: EN.label })).toHaveCount(0);
  });

  await step('Open the account menu on that same office: Sign out, and no Malafat item', async () => {
    await page.getByRole('button', { name: /Account/ }).click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await expect(menu.getByText(/Malafat/)).toHaveCount(0);
  });
});
