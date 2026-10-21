import { test, expect } from '../../support/qa';
import { FIRM, OFFICE_A, OFFICE_B, QA_USER_ID, customer, malafatFirm, office, type StubOwner, type StubProfile } from '../../support/portal';
import { FakeApi, apiError, category, receivable, todayInJerusalem, uid } from '../../support/portalApi';

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

test('The owner of a Business profile asks for firm features; it reads Requested, and a Personal profile never offers it', { tag: '@portal.profiles.firm-request' }, async ({ page, step }) => {
  const home = { ...office(OFFICE_B, 'Home'), type: 'PERSONAL' as const };
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Khatib Law'), home, malafatFirm()] });
  const list = page.getByRole('dialog', { name: 'Profiles' });
  const pane = page.getByRole('dialog', { name: 'Khatib Law' });
  const section = pane.getByRole('region', { name: 'Use this profile for a firm' });

  await step('Open Manage profiles and choose the Personal profile: no firm request', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await openManage(page);
    await list.getByRole('button', { name: /^Home/ }).click();
    await expect(page.getByRole('dialog', { name: 'Home' }).getByLabel('Name')).toHaveValue('Home');
    await expect(page.getByText('Use this profile for a firm')).toHaveCount(0);
  });

  await step('Go back and choose the Business profile: it offers firm features', async () => {
    await page.getByRole('button', { name: 'All profiles' }).click();
    await list.getByRole('button', { name: /^Khatib Law/ }).click();
    await expect(section).toContainText('Firm features are tools for running an office');
    await expect(section.getByRole('button', { name: 'Request firm features' })).toBeVisible();
  });

  await step('Request firm features: sent once with an Idempotency-Key, then Requested', async () => {
    await section.getByRole('button', { name: 'Request firm features' }).click();
    await expect(section).toContainText("Firm features show up here once they're turned on.");
    await expect(section).toContainText('Requested on');
    await expect(section.getByRole('button', { name: 'Request firm features' })).toHaveCount(0);
    const requests = api.calls('POST', new RegExp(`^/v1/profiles/${OFFICE_A}/firm-request$`));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers['idempotency-key']).toBeTruthy();
  });

  await step('Reopen the portal and the same profile: still Requested', async () => {
    await page.goto(`/p/${OFFICE_A}/clients?editProfile=${OFFICE_A}`);
    await expect(section).toContainText('Requested on');
    await expect(section.getByRole('button', { name: 'Request firm features' })).toHaveCount(0);
  });
});

// MUT-373 (ADR-163): co-owners. Basel created Sader & Haddad; the signed-in person (Nour) co-owns it, or created it
// and shares it with Lina. OFFICE_B is Nour's built-in personal profile, where a leave or a removal lands.
const BASEL = 'b1111111-1111-4111-8111-111111111111';
const LINA = 'c1111111-1111-4111-8111-111111111111';
const NOUR: StubOwner = { userId: QA_USER_ID, name: 'Nour Haddad', email: 'nour@office.ps', creator: true };
const personal: StubProfile = { ...office(OFFICE_B, 'Personal'), type: 'PERSONAL', personalDefault: true };
const sharedByBasel: StubProfile = {
  ...office(OFFICE_A, 'Sader & Haddad'),
  owners: [{ userId: BASEL, name: 'Basel Sader', email: 'basel@sader.ps', creator: true }, { ...NOUR, creator: false }],
};
const sharedWithLina: StubProfile = {
  ...office(OFFICE_A, 'Sader & Haddad'),
  owners: [NOUR, { userId: LINA, name: 'Lina Saleh', email: 'lina@sader.ps', creator: false }],
};

test('A co-owner sees the shared profile named for their partner, owns it fully, and its Owners section lists both', { tag: '@portal.profiles.co-owner-write' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [sharedByBasel, personal], clients: 1 });
  const pane = page.getByRole('dialog', { name: 'Sader & Haddad' });
  const owners = pane.getByRole('region', { name: 'Owners' });

  await step('Open the switcher: the shared profile names Basel, beside your own personal profile and nothing of his', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await page.getByRole('button', { name: /^Switch profile/ }).click();
    await expect(page.getByRole('menuitemradio', { name: /Sader & Haddad/ })).toContainText('Business · Shared with Basel Sader');
    // Each keeps a private personal profile: yours is listed, Basel's never is.
    await expect(page.getByRole('menuitemradio')).toHaveCount(2);
    await expect(page.getByRole('menuitemradio', { name: /Personal/ })).toContainText('Personal');
    await page.keyboard.press('Escape');
  });

  await step('Open Manage profiles: the list explains the count, and the shared profile reads the same', async () => {
    await openManage(page);
    const list = page.getByRole('dialog', { name: 'Profiles' });
    await expect(list).toContainText("Profiles shared with you don't count.");
    await expect(list.getByRole('button', { name: /^Sader & Haddad/ })).toContainText('Business · Shared with Basel Sader');
    await list.getByRole('button', { name: /^Sader & Haddad/ }).click();
  });

  await step('Its Owners section lists Basel as creator and you; there is no Remove, Leave is at its foot', async () => {
    const rows = owners.getByRole('listitem');
    await expect(rows.nth(0)).toContainText('Basel Sader');
    await expect(rows.nth(0)).toContainText('Created this profile');
    await expect(rows.nth(1)).toContainText('Nour Haddad');
    await expect(rows.nth(1)).toContainText('You');
    await expect(owners.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
    await expect(owners.getByRole('button', { name: 'Leave Sader & Haddad' })).toBeVisible();
    await expect(pane.getByRole('radio', { name: /Personal/ })).toBeDisabled();
    await expect(pane).toContainText('A shared profile stays Business.');
  });

  await step('Close the drawer and add a received income on the shared profile', async () => {
    await page.getByRole('button', { name: 'Close' }).click();
    await page.locator('[data-income-add]').click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await expect(drawer.getByRole('radio', { name: 'Received' })).toHaveAttribute('aria-checked', 'true');
    await drawer.getByLabel('Amount').fill('300');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toHaveCount(0);
    expect(api.last('POST', /^\/v1\/income$/)?.headers['x-mutaba3a-profile']).toBe(OFFICE_A);
  });
});

test('The creator removes a co-owner after an in-place confirm; the row goes and a toast says so', { tag: '@portal.profiles.co-owner-remove' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [sharedWithLina, personal] });
  const pane = page.getByRole('dialog', { name: 'Sader & Haddad' });
  const owners = pane.getByRole('region', { name: 'Owners' });

  await step('Open the shared profile in Manage profiles: the creator gets Remove, never Leave', async () => {
    await api.open(page, `/p/${OFFICE_B}/clients?editProfile=${OFFICE_A}`);
    await expect(owners.getByRole('listitem')).toHaveCount(2);
    await expect(owners.getByRole('button', { name: /^Leave/ })).toHaveCount(0);
  });

  await step('Remove on Lina’s row opens the confirm under it, naming her', async () => {
    await owners.getByRole('button', { name: 'Remove Lina Saleh' }).click();
    const confirm = owners.getByRole('group', { name: 'Remove Lina Saleh?' });
    await expect(confirm).toContainText('Lina Saleh loses access to Sader & Haddad. What they recorded stays.');
    await confirm.getByRole('button', { name: 'Remove Lina Saleh' }).click();
  });

  await step('The removal goes once with an Idempotency-Key; the toast says so and her row is gone', async () => {
    await expect(page.getByTestId('toast-live')).toHaveText('Lina Saleh removed from Sader & Haddad');
    await expect(owners.getByRole('listitem')).toHaveCount(1);
    await expect(owners).toContainText('Only you own this profile.');
    const deletes = api.calls('DELETE', new RegExp(`^/v1/profiles/${OFFICE_A}/owners/${LINA}$`));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.headers['idempotency-key']).toBeTruthy();
  });
});

test('A co-owner leaves the open shared profile and lands on their personal profile with a toast', { tag: '@portal.profiles.co-owner-leave' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [sharedByBasel, personal] });
  const pane = page.getByRole('dialog', { name: 'Sader & Haddad' });
  const owners = pane.getByRole('region', { name: 'Owners' });

  await step('On the shared profile, open it in Manage profiles', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients?editProfile=${OFFICE_A}`);
    await expect(owners).toBeVisible();
  });

  await step('Leave opens a confirm that says what stays, and Save steps aside', async () => {
    await owners.getByRole('button', { name: 'Leave Sader & Haddad' }).click();
    const confirm = owners.getByRole('group', { name: 'Leave Sader & Haddad?' });
    await expect(confirm).toContainText("You'll lose access to Sader & Haddad. What you recorded stays.");
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await confirm.getByRole('button', { name: 'Leave Sader & Haddad' }).click();
  });

  await step('The portal lands on the personal profile, the drawer is closed, and a toast says so', async () => {
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}`));
    await expect(page.getByTestId('toast-live')).toHaveText('You left Sader & Haddad');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText("This profile isn't available")).toHaveCount(0);
    await page.getByRole('button', { name: /^Switch profile/ }).click();
    await expect(page.getByRole('menuitemradio', { name: /Sader & Haddad/ })).toHaveCount(0);
  });
});

test('Someone removed while working on the shared profile lands on their personal profile with a banner naming it', { tag: '@portal.profiles.co-owner-removed' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [sharedByBasel, personal], clients: 1 });

  await step('Work on the shared profile’s Clients', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await expect(page.getByRole('button', { name: /^Switch profile/ })).toContainText('Sader & Haddad');
  });

  await step('Meanwhile Basel removes you; open Expenses', async () => {
    api.removedElsewhere(OFFICE_A);
    await page.getByRole('link', { name: 'Expenses' }).first().click();
  });

  await step('The portal moves to the personal profile with a banner naming the shared one; Close dismisses it', async () => {
    const banner = page.getByText('You no longer have access to Sader & Haddad. What you recorded stays.');
    await expect(banner).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}`));
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(banner).toHaveCount(0);
  });
});

test('A co-owner adds a client, records a payment and an expense, and renames the shared profile', { tag: '@portal.profiles.co-owner-full-rights' }, async ({ page, step }) => {
  const C1 = customer(0).id;
  const api = new FakeApi({
    profiles: [sharedByBasel, personal],
    clients: 1,
    categories: [category(1, 'Office supplies')],
    receivables: [receivable(1, { customerId: C1, gross: '500.00', dueDate: '2026-10-30' })],
  });
  const asShared = (method: string, path: RegExp) => api.last(method, path)?.headers['x-mutaba3a-profile'];

  await step('On Basel’s shared profile, add income for a client nobody has, with Add client', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await page.getByRole('button', { name: '+ Add income' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('radio', { name: 'Owed' }).click();
    await drawer.getByLabel('Client').fill('Ramallah Bakery');
    await drawer.getByRole('option', { name: /Add client.*Ramallah Bakery/ }).click();
    await drawer.getByLabel('Amount').fill('900');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toHaveCount(0);
    expect(asShared('POST', /^\/v1\/customers$/)).toBe(OFFICE_A);
    expect(asShared('POST', /^\/v1\/income$/)).toBe(OFFICE_A);
  });

  await step('Record a payment on Client 1’s open entry', async () => {
    await page.getByRole('table', { name: 'Receivables' }).getByRole('button', { name: /^Record payment for Client 1/ }).click();
    const drawer = page.getByRole('dialog', { name: /Record payment/ });
    await expect(drawer.getByLabel('Paid on')).toHaveValue(todayInJerusalem());
    await drawer.getByRole('button', { name: 'Record payment' }).click();
    await expect(drawer).toHaveCount(0);
    expect(asShared('POST', /\/settle$/)).toBe(OFFICE_A);
  });

  await step('Record an expense', async () => {
    await page.goto(`/p/${OFFICE_A}/expenses`);
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Record expense' });
    await drawer.getByLabel('Amount').fill('12.50');
    await drawer.getByLabel('Category').selectOption({ label: 'Office supplies' });
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    expect(asShared('POST', /^\/v1\/expenses$/)).toBe(OFFICE_A);
  });

  await step('Rename the shared profile in Manage profiles; the switcher shows the new name', async () => {
    await page.goto(`/p/${OFFICE_A}/expenses?editProfile=${OFFICE_A}`);
    const pane = page.getByRole('dialog', { name: 'Sader & Haddad' });
    await pane.getByLabel('Name').fill('S&H Studio');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('toast-live')).toHaveText('Profile saved');
    const patch = api.last('PATCH', new RegExp(`^/v1/profiles/${OFFICE_A}$`));
    expect(patch?.body).toEqual({ name: 'S&H Studio' });
    await expect(page.getByRole('button', { name: /^Switch profile/ })).toContainText('S&H Studio');
  });
});
