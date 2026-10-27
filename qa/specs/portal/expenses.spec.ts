import type { Page } from '@playwright/test';
import { test, expect, type Step } from '../../support/qa';
import { OFFICE_A, customer, office, type StubProfile } from '../../support/portal';
import { traceIconScale, readIconScale } from '../../support/motion';
import { switchLanguage } from '../../support/you';
import { FakeApi, STORAGE, apiError, category, ceilingOf, daysAfter, expense, project, todayInJerusalem } from '../../support/portalApi';

/**
 * Expenses in the portal (MUT-44): the list, the Record/Edit expense drawer and
 * receipts on a saved expense (start → PUT to the signed bucket URL → complete).
 * The in-memory API (qa/support/portalApi.ts) records every write, and the
 * bucket is stubbed at its real origin, the one the portal's CSP allows.
 */

const C1 = customer(0).id;
const office_ = category(1, 'Office supplies');
const travel = category(2, 'Travel');

/**
 * Save an expense on `profile` and follow the save-feedback icon's pop until it
 * settles at scale 1 (MUT-338). The preset is the profile's: BUSINESS is
 * restrained, PERSONAL is playful.
 */
async function saveExpenseAndTraceIcon(page: Page, step: Step, profile: StubProfile) {
  const api = new FakeApi({ profiles: [profile], clients: 1, categories: [office_] });
  const drawer = page.getByRole('dialog', { name: 'Record expense' });

  await step('Open Expenses and add a new expense', async () => {
    await api.open(page, `/p/${profile.id}/expenses`);
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    await expect(drawer).toBeVisible();
  });

  await step('Save it', async () => {
    await drawer.getByLabel('Amount').fill('12.50');
    await drawer.getByLabel('Category').selectOption({ label: 'Office supplies' });
    await traceIconScale(page);
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });

  const notice = page.getByRole('status');
  await expect(notice).toBeVisible();
  await expect(notice.locator('[data-part]').first()).toBeVisible();
  await expect.poll(async () => (await readIconScale(page)).last).toBe(1);
  return readIconScale(page);
}

test('a successful expense save shows the animated save-feedback icon in the saved notice', { tag: '@portal.expenses.save-feedback-animation' }, async ({ page, step }) => {
  const trace = await saveExpenseAndTraceIcon(page, step, { ...office(OFFICE_A, 'Nour Studio'), firm: true, role: 'OWNER' });
  // A profile with firm features on (MUT-300) is restrained: it grows from nothing and never overshoots
  expect(trace.min).toBeLessThan(0.5);
  expect(trace.max).toBeLessThanOrEqual(1);
});

test('on a business profile without firm features the save-feedback icon still plays the playful pop', { tag: '@portal.expenses.save-feedback-business-playful' }, async ({ page, step }) => {
  const trace = await saveExpenseAndTraceIcon(page, step, office(OFFICE_A, 'Nour Studio'));
  // Restrained goes by MUT-300's firm switch, not by the profile type (MUT-338 comment 12272)
  expect(trace.min).toBeLessThan(0.5);
  expect(trace.max).toBeGreaterThan(1.02);
});

test('on a personal profile the save-feedback icon plays the playful pop', { tag: '@portal.expenses.save-feedback-personal' }, async ({ page, step }) => {
  const trace = await saveExpenseAndTraceIcon(page, step, { ...office(OFFICE_A, 'Personal'), type: 'PERSONAL' });
  // Playful overshoots past full size before settling (MMotion.overshoot)
  expect(trace.min).toBeLessThan(0.5);
  expect(trace.max).toBeGreaterThan(1.02);
  // It pops from the icon's centre, not its top-left corner
  expect(trace.maxOffCenter).toBeLessThan(0.5);
});

test('with Reduce Motion on the save-feedback icon shows settled, with no pop', { tag: '@portal.expenses.save-feedback-reduced-motion' }, async ({ page, step }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const trace = await saveExpenseAndTraceIcon(page, step, { ...office(OFFICE_A, 'Personal'), type: 'PERSONAL' });
  // Even the playful preset paints full size from its first frame
  expect(trace.min).toBe(1);
  expect(trace.max).toBe(1);
});

test('Record an expense: the drawer says what is missing, a currency’s own decimals are accepted, and the expense is listed', { tag: '@portal.expenses.create' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, categories: [office_, travel] });
  const drawer = page.getByRole('dialog', { name: 'Record expense' });

  await step('Open Expenses: nothing yet', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await expect(page.getByRole('heading', { name: 'No expenses recorded on this profile yet' })).toBeVisible();
  });

  await step('Choose Record expense and save it empty', async () => {
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/newExpense=true/);
    await expect(drawer.getByLabel('Date')).toHaveValue(todayInJerusalem());
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByText('Enter a valid amount')).toBeVisible();
    await expect(drawer.getByText('Required')).toBeVisible();
  });

  await step('12.345 is too precise for USD, and fine in JOD', async () => {
    await drawer.getByLabel('Amount').fill('12.345');
    await drawer.getByLabel('Category').selectOption({ label: 'Office supplies' });
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByText('Enter a valid amount')).toBeVisible();
    await drawer.getByLabel('Currency').selectOption('JOD');
  });

  await step('Add a title, a vendor and Client 1, then save', async () => {
    await drawer.getByLabel('Title').fill('Printer paper');
    await drawer.getByLabel('Vendor').fill('Office Depot');
    await drawer.getByPlaceholder('Search for a client').fill('Client 1');
    await drawer.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('The server got the expense once, keyed for a safe retry', async () => {
    const post = api.last('POST', /^\/v1\/expenses$/);
    expect(post?.body).toEqual({ occurredOn: todayInJerusalem(), amount: '12.345', currency: 'JOD', title: 'Printer paper', vendor: 'Office Depot', categoryId: office_.id, customerId: C1 });
    expect(post?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  await step('It is on the list, and the list says it was saved', async () => {
    const row = page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Printer paper/ });
    await expect(row).toContainText('Office supplies');
    await expect(row).toContainText('Client 1');
    await expect(row).toContainText('12.345');
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveCount(1);
  });

  await step('Filter by Travel: nothing matches; Clear filters brings it back', async () => {
    await page.getByLabel('Category').selectOption({ label: 'Travel' });
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
    expect(api.last('GET', /^\/v1\/expenses$/)?.query.get('categoryId')).toBe(travel.id);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Printer paper/ })).toBeVisible();
  });
});

test('Edit an expense: attach a receipt, download and remove it, and save a change at the version read', { tag: '@portal.expenses.edit-receipts' }, async ({ page, step }) => {
  const taxi = expense(1, { amount: '45.00', title: 'Taxi to court', categoryId: travel.id });
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, categories: [office_, travel], expenses: [taxi] });
  const drawer = page.getByRole('dialog', { name: 'Edit expense' });
  const fileInput = drawer.locator('input[type="file"]');

  await step('Open Expenses and choose the taxi expense', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await page.getByRole('table', { name: 'Expenses' }).getByRole('button', { name: /Oct 3, 2026/ }).click();
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`expense=${taxi.id}`));
    await expect(drawer.getByLabel('Amount')).toHaveValue('45.00');
    await expect(drawer.getByLabel('Title')).toHaveValue('Taxi to court');
    await expect(drawer.getByRole('button', { name: 'Add receipt' })).toBeVisible();
  });

  await step('A text file is refused before anything is sent', async () => {
    await fileInput.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a receipt') });
    await expect(page.getByRole('alert')).toContainText('Receipts must be a PDF, JPEG or PNG file.');
    expect(api.calls('POST', /\/receipts$/)).toHaveLength(0);
  });

  await step('Attach taxi-receipt.pdf', async () => {
    await fileInput.setInputFiles({ name: 'taxi-receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 receipt') });
    await expect(drawer.getByText('taxi-receipt.pdf')).toBeVisible();
    expect(api.last('POST', /\/receipts$/)?.body).toEqual({ filename: 'taxi-receipt.pdf', mimeType: 'application/pdf', sizeBytes: 16 });
    expect(api.storage.some((r) => r.method === 'PUT' && r.url.startsWith(`${STORAGE}/upload/`))).toBe(true);
    expect(api.calls('POST', /\/complete$/)).toHaveLength(1);
  });

  await step('Download it: the browser saves it from the signed link', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: 'Download' }).click()]);
    expect(download.url()).toBe(`${STORAGE}/taxi-receipt.pdf`);
  });

  await step('Remove it', async () => {
    await drawer.getByRole('listitem').filter({ hasText: 'taxi-receipt.pdf' }).getByRole('button', { name: 'Delete' }).click();
    await expect(drawer.getByText('taxi-receipt.pdf')).toHaveCount(0);
    expect(api.calls('DELETE', /\/receipts\//)).toHaveLength(1);
  });

  await step('Change the title and save', async () => {
    await drawer.getByLabel('Title').fill('Taxi to the district court');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    const patch = api.last('PATCH', /^\/v1\/expenses\//);
    expect(patch?.headers['if-match']).toBe('1');
    expect(patch?.body).toMatchObject({ amount: '45.00', title: 'Taxi to the district court', categoryId: travel.id, customerId: null });
    await expect(page.getByRole('table', { name: 'Expenses' })).toContainText('Taxi to the district court');
  });
});

test('Delete an expense after confirming in place, and a stale edit is refused with a message', { tag: '@portal.expenses.delete' }, async ({ page, step }) => {
  const lunch = expense(1, { amount: '80.00', title: 'Client lunch', categoryId: travel.id });
  const parking = expense(2, { amount: '15.00', title: 'Parking', categoryId: travel.id, occurredOn: '2026-10-02' });
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], categories: [travel], expenses: [lunch, parking] });
  const drawer = page.getByRole('dialog', { name: 'Edit expense' });
  const table = page.getByRole('table', { name: 'Expenses' });

  await step('Open the lunch expense', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await table.getByRole('row', { name: /Client lunch/ }).click();
    await expect(drawer.getByLabel('Title')).toHaveValue('Client lunch');
  });

  await step('Save a change someone else already made: the drawer stays open and says so', async () => {
    api.once('PATCH', /^\/v1\/expenses\//, apiError(409, 'CONFLICT', { reason: 'VERSION_MISMATCH' }));
    await drawer.getByLabel('Amount').fill('85.00');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('This expense changed elsewhere');
    await expect(drawer).toBeVisible();
  });

  // MUT-417: the footer turns into a confirm in place; the browser's own prompt never appears.
  let browserPrompts = 0;
  page.on('dialog', (dialog) => {
    browserPrompts += 1;
    void dialog.dismiss();
  });
  const confirm = drawer.getByRole('group', { name: /^Delete “Client lunch” \(.*80\.00\)\? This can't be undone\.$/ });

  await step('Choose Delete, then Cancel: the footer asked in place, naming the lunch, and nothing is deleted', async () => {
    await drawer.getByRole('button', { name: 'Delete' }).click();
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Delete' })).toBeFocused();
    expect(api.calls('DELETE', /^\/v1\/expenses\//)).toHaveLength(0);
  });

  await step('Choose Delete and confirm it', async () => {
    await drawer.getByRole('button', { name: 'Delete' }).click();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(drawer).toHaveCount(0);
    expect(api.calls('DELETE', new RegExp(`^/v1/expenses/${lunch.id}$`))).toHaveLength(1);
    expect(browserPrompts).toBe(0);
  });

  await step('Only Parking is left', async () => {
    await expect(table.getByRole('row', { name: /Client lunch/ })).toHaveCount(0);
    await expect(table.getByRole('row', { name: /Parking/ })).toBeVisible();
  });
});

test('An expense saved outside the current filter says so, and Show starts the list at it', { tag: '@portal.expenses.saved-show' }, async ({ page, step }) => {
  const parking = expense(1, { amount: '15.00', title: 'Parking', categoryId: travel.id });
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], categories: [office_, travel], expenses: [parking] });
  const drawer = page.getByRole('dialog', { name: 'Record expense' });
  const notice = page.getByRole('status').filter({ hasText: 'Expense saved' });
  const table = page.getByRole('table', { name: 'Expenses' });

  await step('Open Expenses filtered to Travel', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses?categoryId=${travel.id}`);
    await expect(table.getByRole('row', { name: /Parking/ })).toBeVisible();
  });

  await step('Record a toner expense under Office supplies', async () => {
    await page.getByRole('button', { name: 'Record expense' }).click();
    await drawer.getByLabel('Amount').fill('20.00');
    await drawer.getByLabel('Category').selectOption({ label: 'Office supplies' });
    await drawer.getByLabel('Title').fill('Toner');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('The Travel list cannot show it, so a notice says it was saved', async () => {
    await expect(notice).toBeVisible();
    await expect(table.getByRole('row', { name: /Toner/ })).toHaveCount(0);
  });

  await step('Choose Show: the list starts at the toner expense', async () => {
    await notice.getByRole('button', { name: 'Show' }).click();
    const saved = api.last('POST', /^\/v1\/expenses$/);
    expect(saved).toBeDefined();
    await expect(page).toHaveURL(/anchor=/);
    await expect(page.getByText('Showing from a saved entry').locator('..')).toBeFocused();
    await expect(table.getByRole('row', { name: /Toner/ })).toBeVisible();
    expect(api.last('GET', /^\/v1\/expenses$/)?.query.get('anchor')).toMatch(/^[0-9a-f-]{36}$/);
  });

  await step('Show latest drops the anchor', async () => {
    await page.getByRole('button', { name: 'Show latest' }).click();
    await expect(page).not.toHaveURL(/anchor=/);
    await expect(page.getByText('Showing from a saved entry')).toHaveCount(0);
  });

  await step('An old link anchored on an expense that is gone opens the plain list', async () => {
    api.once('GET', /^\/v1\/expenses$/, apiError(404, 'NOT_FOUND', { reason: 'ANCHOR_NOT_FOUND' }));
    await page.goto(`/p/${OFFICE_A}/expenses?anchor=${expense(99, { amount: '1.00' }).id}`);
    await expect(page).not.toHaveURL(/anchor=/);
    await expect(table.getByRole('row', { name: /Parking/ })).toBeVisible();
    await expect(page.getByText('Showing from a saved entry')).toHaveCount(0);
  });
});

test('An expense changed on another device: Save is refused, the drawer shows the latest version, and saving again works', { tag: '@portal.expenses.edit-conflict' }, async ({ page, step }) => {
  const lunch = expense(1, { amount: '80.00', title: 'Client lunch', categoryId: travel.id });
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], categories: [travel], expenses: [lunch] });
  const drawer = page.getByRole('dialog', { name: 'Edit expense' });

  await step('Open the lunch expense', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Client lunch/ }).click();
    await expect(drawer.getByLabel('Amount')).toHaveValue('80.00');
  });

  await step('Meanwhile the phone app changes the amount to 90.00', async () => {
    lunch.amount = '90.00';
    lunch.version = 2;
  });

  await step('Change the title here and save: refused, and the drawer now shows 90.00', async () => {
    await drawer.getByLabel('Title').fill('Client lunch, Ramallah');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('This expense changed elsewhere — showing the latest version');
    await expect(drawer.getByLabel('Amount')).toHaveValue('90.00');
  });

  await step('Save again: it goes through at the latest version', async () => {
    await drawer.getByLabel('Title').fill('Client lunch, Ramallah');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    expect(api.last('PATCH', /^\/v1\/expenses\//)?.headers['if-match']).toBe('2');
  });
});

test('An expense may be dated ahead up to ten years; the server’s ten-year refusal is said at the date (MUT-392)', { tag: '@portal.expenses.date-too-far' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, categories: [office_] });
  const drawer = page.getByRole('dialog', { name: 'Record expense' });
  const ahead = daysAfter(todayInJerusalem(), 3);

  await step('Open Expenses and choose Record expense', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    await expect(drawer.getByLabel('Date')).toHaveAttribute('max', ceilingOf(todayInJerusalem()));
  });

  await step('Type 40, pick Office supplies, set the date 3 days ahead and save', async () => {
    await drawer.getByLabel('Amount').fill('40');
    await drawer.getByLabel('Category').selectOption({ label: 'Office supplies' });
    await drawer.getByLabel('Date').fill(ahead);
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    expect(api.last('POST', /^\/v1\/expenses$/)?.body).toMatchObject({ occurredOn: ahead, categoryId: office_.id });
  });

  await step('Record another dated 2040-01-01 while the server refuses it as more than ten years ahead', async () => {
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    await drawer.getByLabel('Amount').fill('40');
    await drawer.getByLabel('Category').selectOption({ label: 'Office supplies' });
    await drawer.getByLabel('Date').fill('2040-01-01');
    api.once('POST', /^\/v1\/expenses$/, apiError(422, 'VALIDATION_FAILED', { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'future' }));
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByText("The date can't be more than ten years ahead")).toBeVisible();
    await expect(drawer).toBeVisible();
  });
});

test('An expense’s date is changed in the edit drawer and the list shows the new day (MUT-224 regression)', { tag: '@portal.expenses.redate-expense' }, async ({ page, step }) => {
  const taxi = expense(61, { amount: '45.00', title: 'Taxi to court', occurredOn: '2026-10-03', categoryId: travel.id });
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, categories: [office_, travel], expenses: [taxi] });
  const drawer = page.getByRole('dialog', { name: 'Edit expense' });

  await step('Open Expenses and choose the expense', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await page.getByRole('table', { name: 'Expenses' }).getByRole('button', { name: /Oct 3, 2026/ }).click();
    await expect(drawer).toBeVisible();
  });

  await step('Change only its date and save', async () => {
    await drawer.getByLabel('Date').fill('2026-09-28');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('The server got the new date with If-Match, and the row shows it', async () => {
    const patch = api.last('PATCH', /^\/v1\/expenses\//);
    expect(patch?.headers['if-match']).toBe('1');
    expect(patch?.body).toMatchObject({ occurredOn: '2026-09-28' });
    await expect(page.getByRole('table', { name: 'Expenses' })).toContainText('Sep 28, 2026');
  });
});


test('An expense saved with a category, a client and a matter shows all three in its drawer (MUT-384)', { tag: '@portal.expenses.expense-category-client-matter' }, async ({ page, step }) => {
  // As the phone saves it (MUT-384 AC2b): categoryId, customerId and projectId together, on a firm's business profile
  const matter = project(1, C1, 'Haddad v. Levi');
  const filing = expense(1, { amount: '120.00', title: 'Court filing fee', categoryId: travel.id, customerId: C1, projectId: matter.id });
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), firm: true, role: 'OWNER' }], clients: 2, projects: [matter], categories: [office_, travel], expenses: [filing] });
  const drawer = page.getByRole('dialog', { name: 'Edit expense' });

  await step('Open the expense', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Court filing fee/ }).click();
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`expense=${filing.id}`));
  });

  await step('The drawer shows category, client and matter', async () => {
    await expect(drawer.getByLabel('Category').locator('option:checked')).toHaveText('Travel');
    await expect(drawer.getByLabel('Client')).toHaveValue('Client 1');
    await expect(drawer.getByLabel('Matter')).toHaveValue('Haddad v. Levi');
  });
});

test('The vendor field suggests saved vendors: a new one is kept as typed, and picking one prefills its last category', { tag: '@portal.expenses.vendor-typeahead' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], categories: [office_, travel] });
  const drawer = page.getByRole('dialog', { name: 'Record expense' });
  const vendor = drawer.getByLabel('Vendor');

  await step('Record an expense at a new vendor, Yellow Cab, under Travel', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    await drawer.getByLabel('Amount').fill('45');
    await drawer.getByLabel('Category').selectOption({ label: 'Travel' });
    await vendor.fill('Yellow Cab');
    await expect(drawer.getByRole('option', { name: /New vendor.*Yellow Cab/ })).toBeVisible();
    await vendor.press('Enter');
    await expect(vendor).toHaveValue('Yellow Cab');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('Record another and type "yel": Yellow Cab is suggested', async () => {
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    await drawer.getByLabel('Amount').fill('30');
    await vendor.fill('yel');
    await expect(drawer.getByRole('option', { name: 'Yellow Cab', exact: true })).toBeVisible();
    // The box asks once typing pauses (the recent list may show it first).
    await expect.poll(() => api.last('GET', /^\/v1\/vendors$/)?.query.get('q')).toBe('yel');
  });

  await step('Pick it: Vendor is filled and Category prefilled with Travel', async () => {
    await drawer.getByRole('option', { name: 'Yellow Cab', exact: true }).click();
    await expect(vendor).toHaveValue('Yellow Cab');
    await expect(drawer.getByLabel('Category')).toHaveValue(travel.id);
  });

  await step('Save: the server gets the vendor and its category', async () => {
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
    expect(api.last('POST', /^\/v1\/expenses$/)?.body).toMatchObject({ amount: '30', vendor: 'Yellow Cab', categoryId: travel.id });
  });
});

/**
 * MUT-464: a seeded category is named in the language the portal shows (the server reads Accept-Language), and a
 * switch refetches the names; a category a person named keeps its name in both.
 */
const seededRent = category(3, 'Office Rent', { presetKey: 'office_rent', ar: 'إيجار المكتب' });
const studioRent = category(4, 'Studio rent');
const rentExpenses = () => [expense(1, { amount: '800.00', title: 'October rent', categoryId: seededRent.id }), expense(2, { amount: '300.00', title: 'Studio', categoryId: studioRent.id })];
const rowOf = (page: Page, title: string) => page.getByRole('table').getByRole('row', { name: new RegExp(title) });
const lastCategoriesLanguage = (api: FakeApi) => api.last('GET', /^\/v1\/expense-categories$/)?.headers['accept-language'];

test('A seeded category is named in the portal’s language, and switching renames it (MUT-464)', { tag: '@portal.expenses.categories-follow-language' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], categories: [seededRent, studioRent], expenses: rentExpenses() });

  await step('Open Expenses in Arabic: the rent row names its category إيجار المكتب', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`, 'ar');
    await expect(rowOf(page, 'October rent')).toContainText('إيجار المكتب');
    expect(lastCategoriesLanguage(api)).toBe('ar');
  });

  await switchLanguage(page, step, 'EN', 'ltr');

  await step('The categories are asked for again in English: the row now says Office Rent', async () => {
    await expect(rowOf(page, 'October rent')).toContainText('Office Rent');
    expect(lastCategoriesLanguage(api)).toBe('en');
  });
});

test('A category a person named keeps that name in both languages (MUT-464)', { tag: '@portal.expenses.renamed-category-keeps-name' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], categories: [seededRent, studioRent], expenses: rentExpenses() });

  await step('Open Expenses in English: Studio rent and Office Rent', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`, 'en');
    await expect(rowOf(page, 'Studio')).toContainText('Studio rent');
    await expect(rowOf(page, 'October rent')).toContainText('Office Rent');
  });

  await switchLanguage(page, step, 'عربي', 'rtl');

  await step('In Arabic the seeded one is إيجار المكتب; the named one is still Studio rent', async () => {
    await expect(rowOf(page, 'October rent')).toContainText('إيجار المكتب');
    await expect(rowOf(page, 'Studio')).toContainText('Studio rent');
    expect(lastCategoriesLanguage(api)).toBe('ar');
  });
});

