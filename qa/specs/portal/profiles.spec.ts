import { test, expect } from '../../support/qa';
import { FIRM, OFFICE_A, OFFICE_B, malafatFirm, office } from '../../support/portal';
import { FakeApi, apiError, uid } from '../../support/portalApi';

/**
 * Hosted profiles (MUT-183): New profile and Manage profiles, both drawers on
 * the shell, opened from the profile switcher. The in-memory API
 * (qa/support/portalApi.ts) keeps each profile's version, so a PATCH with a
 * stale If-Match is refused as the server refuses it.
 */

async function openManage(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^Switch profile/ }).click();
  await page.getByRole('menuitem', { name: 'Manage profiles' }).click();
  await expect(page.getByRole('dialog', { name: 'Profiles' })).toBeVisible();
  await expect(page).toHaveURL(/manageProfiles=true/);
}

test('Edit a profile’s name and currency; a change made elsewhere first asks for Reload', { tag: '@portal.profiles.edit' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Nour Accounting'), malafatFirm()] });
  const pane = page.getByRole('dialog', { name: 'Nour Studio' });

  await step('Open Manage profiles from the switcher', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await openManage(page);
    const list = page.getByRole('dialog', { name: 'Profiles' });
    await expect(list).toContainText("You've used 2 of 6 profiles");
    await expect(list.getByRole('button', { name: /Nour Studio/ })).toContainText('Open now');
    await expect(list.getByRole('button', { name: /Nour Accounting/ })).toContainText('Business');
    await expect(list.getByText('Managed in Malafat. Change it there.')).toBeVisible();
  });

  await step('Choose Nour Studio: name, currency, the time zone as a fact, and Save waits for a change', async () => {
    await page.getByRole('dialog', { name: 'Profiles' }).getByRole('button', { name: /Nour Studio/ }).click();
    await expect(page).toHaveURL(new RegExp(`editProfile=${OFFICE_A}`));
    await expect(pane.getByLabel('Name')).toHaveValue('Nour Studio');
    await expect(pane.getByLabel('Currency')).toHaveValue('ILS');
    await expect(pane).toContainText('Asia/Jerusalem');
    await expect(pane.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
  });

  await step('Meanwhile it is renamed on the phone; rename it here and save: refused, with Reload', async () => {
    api.editedElsewhere(OFFICE_A, { name: 'Nour Studio Ltd' });
    await pane.getByLabel('Name').fill('Nour Design Studio');
    await pane.getByLabel('Currency').selectOption('USD');
    await pane.getByRole('button', { name: 'Save' }).click();
    await expect(pane.getByRole('alert')).toContainText('This profile was changed elsewhere. Reload to see the latest, then save again.');
    expect(api.last('PATCH', /^\/v1\/profiles\//)?.headers['if-match']).toBe('1');
  });

  await step('Reload: the form shows the name it has now', async () => {
    await pane.getByRole('button', { name: 'Reload' }).click();
    await expect(pane.getByLabel('Name')).toHaveValue('Nour Studio Ltd');
    await expect(pane.getByRole('alert')).toHaveCount(0);
  });

  await step('Rename and change the currency again, and save', async () => {
    await pane.getByLabel('Name').fill('Nour Design Studio');
    await pane.getByLabel('Currency').selectOption('USD');
    await pane.getByRole('button', { name: 'Save' }).click();
    const patch = api.last('PATCH', /^\/v1\/profiles\//);
    await expect.poll(() => patch?.headers['if-match']).toBe('2');
    expect(patch?.body).toEqual({ name: 'Nour Design Studio', defaultCurrency: 'USD' });
  });

  await step('Back on the list: saved, under its new name and currency, and the switcher says so too', async () => {
    const list = page.getByRole('dialog', { name: 'Profiles' });
    await expect(page.getByTestId('toast-live')).toHaveText(/Profile saved/);
    await expect(list.getByRole('button', { name: /Nour Design Studio/ })).toContainText('USD');
    await expect(page.getByRole('button', { name: 'Switch profile: Nour Design Studio' })).toBeVisible();
  });
});

test('Change a profile’s type: the cards say what each seeds, the confirm counts what loses its category, and the note leads to Expenses', { tag: '@portal.profiles.type-change' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Nour Accounting')], uncategorizedOnTypeChange: 3 });
  const pane = page.getByRole('dialog', { name: 'Nour Accounting' });
  const cards = pane.getByRole('radiogroup', { name: 'Profile type' });

  await step('Open Nour Accounting in Manage profiles', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await openManage(page);
    await page.getByRole('dialog', { name: 'Profiles' }).getByRole('button', { name: /Nour Accounting/ }).click();
    await expect(cards.getByRole('radio', { name: /Business/ })).toBeChecked();
    await expect(cards).toContainText('Groceries, rent, car, health…');
    await expect(cards).toContainText('Office rent, software, travel, taxes…');
  });

  await step('Choose Personal and save: asked first, with the count', async () => {
    await cards.getByRole('radio', { name: /Personal/ }).check();
    await pane.getByRole('button', { name: 'Save' }).click();
    await expect(pane.getByRole('heading', { name: 'Switch to Personal?' })).toBeFocused();
    await expect(pane).toContainText("This profile's expense categories will be replaced with the Personal set.");
    await expect(pane).toContainText('3 expenses will become uncategorized.');
    expect(api.last('GET', /\/type-change$/)?.query.get('to')).toBe('PERSONAL');
    expect(api.calls('PATCH', /^\/v1\/profiles\//)).toHaveLength(0);
  });

  await step('Back returns to the form; Save and Switch to Personal sends the one change', async () => {
    await pane.getByRole('button', { name: 'Back' }).click();
    await expect(pane.getByRole('button', { name: 'Save' })).toBeFocused();
    await pane.getByRole('button', { name: 'Save' }).click();
    await pane.getByRole('button', { name: 'Switch to Personal' }).click();
    await expect.poll(() => api.calls('PATCH', /^\/v1\/profiles\//).length).toBe(1);
    expect(api.last('PATCH', /^\/v1\/profiles\//)?.body).toEqual({ type: 'PERSONAL' });
  });

  await step('The list notes the change and how many expenses lost a category', async () => {
    const list = page.getByRole('dialog', { name: 'Profiles' });
    await expect(list.getByRole('note')).toContainText('Now Personal. 3 expenses are uncategorized.');
    await expect(list.getByRole('button', { name: /Nour Accounting/ })).toContainText('Personal');
  });

  await step('Open Expenses from the note', async () => {
    await page.getByRole('link', { name: 'Open Expenses' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}/expenses$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Expenses' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test('New profile: name and type are asked for, the zone can be changed, and the new profile opens', { tag: '@portal.profiles.create' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
  const drawer = page.getByRole('dialog', { name: 'New profile' });

  await step('Choose + New profile in the switcher', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await page.getByRole('button', { name: /^Switch profile/ }).click();
    await page.getByRole('menuitem', { name: '+ New profile' }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('Currency')).toHaveValue('ILS');
  });

  await step('Create it empty: the name and the type are asked for', async () => {
    await drawer.getByRole('button', { name: 'Create profile' }).click();
    await expect(drawer.getByText('Enter a name')).toBeVisible();
    await expect(drawer.getByText('Choose Personal or Business')).toBeVisible();
    expect(api.calls('POST', /^\/v1\/profiles$/)).toHaveLength(0);
  });

  await step('Name it Home, Personal, in JOD, and change the zone to Asia/Amman', async () => {
    await drawer.getByLabel('Name').fill('Home');
    await drawer.getByRole('radio', { name: /Personal/ }).check();
    await drawer.getByLabel('Currency').selectOption('JOD');
    await drawer.getByRole('button', { name: 'Change' }).click();
    await expect(drawer.getByLabel('Time zone')).toBeFocused();
    await drawer.getByLabel('Time zone').selectOption('Asia/Amman');
  });

  await step('The server refuses at the cap: the drawer says so and stops offering Create', async () => {
    api.once('POST', /^\/v1\/profiles$/, apiError(409, 'CONFLICT', { reason: 'PROFILE_LIMIT', limit: 6 }));
    await drawer.getByRole('button', { name: 'Create profile' }).click();
    await expect(drawer.getByRole('note')).toContainText("You've reached your limit of 6 profiles.");
    await expect(drawer.getByRole('button', { name: 'Create profile' })).toHaveAttribute('aria-disabled', 'true');
  });

  await step('Close and open it again (a slot freed up), then create', async () => {
    await drawer.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: /^Switch profile/ }).click();
    await page.getByRole('menuitem', { name: '+ New profile' }).click();
    await drawer.getByLabel('Name').fill('Home');
    await drawer.getByRole('radio', { name: /Personal/ }).check();
    await drawer.getByLabel('Currency').selectOption('JOD');
    await drawer.getByRole('button', { name: 'Change' }).click();
    await drawer.getByLabel('Time zone').selectOption('Asia/Amman');
    await drawer.getByRole('button', { name: 'Create profile' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('The new profile opens, and the server got exactly what was chosen', async () => {
    await expect(page.getByTestId('toast-live')).toHaveText(/Home is ready/);
    await expect(page.getByRole('button', { name: 'Switch profile: Home' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    const post = api.last('POST', /^\/v1\/profiles$/);
    expect(post?.body).toEqual({ name: 'Home', type: 'PERSONAL', defaultCurrency: 'JOD', timezone: 'Asia/Amman' });
    expect(post?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

test('A Malafat-fed profile cannot be edited here, and at the cap New profile says why it does nothing', { tag: '@portal.profiles.limits' }, async ({ page, step }) => {
  const owned = Array.from({ length: 6 }, (_, i) => office(uid(0x4, i + 1), `Office ${i + 1}`));
  const api = new FakeApi({ profiles: [...owned, malafatFirm()] });

  await step('Open the switcher with six owned profiles', async () => {
    await api.open(page, `/p/${owned[0].id}`);
    await page.getByRole('button', { name: /^Switch profile/ }).click();
    const newProfile = page.getByRole('menuitem', { name: /New profile/ });
    await expect(newProfile).toHaveAttribute('aria-disabled', 'true');
    await expect(newProfile).toContainText("You've used 6 of 6 profiles");
  });

  await step('Choosing New profile (it stays focusable) opens nothing', async () => {
    await page.getByRole('menuitem', { name: /New profile/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'New profile' })).toHaveCount(0);
    await expect(page).not.toHaveURL(/newProfile/);
    await page.keyboard.press('Escape');
  });

  await step('Manage profiles: the Malafat firm is locked, with the reason', async () => {
    await openManage(page);
    const list = page.getByRole('dialog', { name: 'Profiles' });
    await expect(list.getByRole('button', { name: /Haddad & Partners/ })).toHaveCount(0);
    await expect(list.getByRole('listitem').filter({ hasText: 'Haddad & Partners' })).toContainText('Managed in Malafat. Change it there.');
    await expect(list.getByRole('button', { name: '+ New profile' })).toHaveAttribute('aria-disabled', 'true');
  });

  await step('A link to edit the firm shows the list instead', async () => {
    await page.goto(`/p/${owned[0].id}?editProfile=${FIRM}`);
    await expect(page.getByRole('dialog', { name: 'Profiles' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Haddad & Partners' })).toHaveCount(0);
  });
});
