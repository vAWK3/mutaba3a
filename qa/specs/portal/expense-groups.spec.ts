import { test, expect } from '../../support/qa';
import { OFFICE_A, office } from '../../support/portal';
import { FX_RATES_ILS, FakeApi, apiError, category, expense, expenseGroup, todayInJerusalem, uid } from '../../support/portalApi';

/**
 * Expense groups in the portal (MUT-268, on MUT-267's API): Expenses › Groups,
 * a trip's page (headline per currency, ≈ converted, day and category charts,
 * members by day, Left out), its drawers, and "In groups" on an expense. The
 * in-memory API (qa/support/portalApi.ts) computes membership the way the
 * server does: dated in the window and not left out, or kept. Dates are
 * relative to today, so every group's status reads the same on any day.
 */

const day = (offset: number) => {
  const d = new Date(`${todayInJerusalem()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const shown = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

const rentCat = category(1, 'Rent');
const travelCat = category(2, 'Travel');
const START = day(-15);
const END = day(-11);

const taxi = expense(1, { amount: '18.000', currency: 'JOD', title: 'Airport taxi', categoryId: travelCat.id, occurredOn: START });
const rent = expense(2, { amount: '30.000', currency: 'JOD', title: 'Rent October', categoryId: rentCat.id, occurredOn: START });
const pass = expense(3, { amount: '66.000', currency: 'JOD', title: 'Dead Sea day pass', occurredOn: day(-13) });
const esim = expense(4, { amount: '40.00', currency: 'USD', title: 'eSIM top-up', occurredOn: day(-13) });
const deposit = expense(5, { amount: '20.000', currency: 'JOD', title: 'Rent deposit', categoryId: rentCat.id, occurredOn: day(-12) });
const flight = expense(6, { amount: '120.000', currency: 'JOD', title: 'Flight to Amman', categoryId: travelCat.id, occurredOn: day(-36) });
const lunch = expense(7, { amount: '50.00', title: 'Lunch at home', occurredOn: day(-3) });

const jordan = expenseGroup(1, { name: 'Jordan trip', startOn: START, endOn: END });
const groupPath = (id: string) => `/p/${OFFICE_A}/expenses/groups/${id}`;

function world(extra: Partial<ConstructorParameters<typeof FakeApi>[0]> = {}) {
  return new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], categories: [rentCat, travelCat], expenses: [taxi, rent, pass, esim, flight, lunch], groups: [jordan], ...extra });
}

test('Create a trip group and land on it with every expense in its dates, oldest first', { tag: '@portal.expense-groups.create' }, async ({ page, step }) => {
  const api = world({ groups: [] });
  const drawer = page.getByRole('dialog', { name: 'New group' });

  await step('Open Expenses and choose the Groups tab', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await page.getByRole('navigation', { name: 'Expenses pages' }).getByRole('link', { name: 'Groups' }).click();
    await expect(page.getByRole('navigation', { name: 'Expenses pages' }).getByRole('link', { name: 'Groups' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: "Group a trip's spending" })).toBeVisible();
  });

  await step('Choose New group and save it empty', async () => {
    await page.getByRole('button', { name: 'New group' }).first().click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('From')).toHaveValue(todayInJerusalem());
    await drawer.getByRole('button', { name: 'Create group' }).click();
    await expect(drawer.getByText('Give the group a name')).toBeVisible();
    await expect(drawer.getByText('Pick an end date, or tick Still going')).toBeVisible();
  });

  await step('Name it Jordan trip, pick its five days, and create it', async () => {
    await drawer.getByLabel('Name').fill('Jordan trip');
    await drawer.getByLabel('From').fill(START);
    await drawer.getByLabel('To').fill(END);
    await drawer.getByRole('button', { name: 'Create group' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('The server got the group once, keyed for a safe retry', async () => {
    const post = api.last('POST', /^\/v1\/expense-groups$/);
    expect(post?.body).toEqual({ name: 'Jordan trip', startOn: START, endOn: END });
    expect(post?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  await step('The group page shows each currency and every expense in its dates by day', async () => {
    await expect(page.getByRole('heading', { level: 1, name: 'Jordan trip' })).toBeVisible();
    const headline = page.getByRole('group', { name: 'Total spent' });
    await expect(headline).toContainText('JOD 114.000');
    await expect(headline).toContainText('3 expenses');
    await expect(headline).toContainText('$40.00');
    const table = page.getByRole('table', { name: 'Expenses in this group' });
    const rows = await table.getByRole('row').allTextContents();
    const at = (title: string) => rows.findIndex((r) => r.includes(title));
    for (const later of ['Dead Sea day pass', 'eSIM top-up']) for (const earlier of ['Airport taxi', 'Rent October']) expect(at(earlier)).toBeLessThan(at(later));
    expect(at('Airport taxi')).toBeGreaterThan(0);
    await expect(table).not.toContainText('Lunch at home');
    await expect(table).not.toContainText('Flight to Amman');
  });
});

test('Leave an expense out: it leaves the totals at once and moves to Left out; Undo and Bring back restore it', { tag: '@portal.expense-groups.leave-out-undo' }, async ({ page, step }) => {
  const api = world();
  const headline = page.getByRole('group', { name: 'Total spent' });

  await step('Open the Jordan trip', async () => {
    await api.open(page, groupPath(jordan.id));
    await expect(headline).toContainText('JOD 114.000');
  });

  await step('Leave out the Dead Sea day pass', async () => {
    await page.getByRole('button', { name: 'Leave out: Dead Sea day pass' }).click();
    await expect(headline).toContainText('JOD 48.000');
    await expect(page.getByText('Left out (1)')).toBeVisible();
    await expect.poll(() => api.markOf(jordan.id, pass.id)).toBe('excluded');
  });

  await step('Undo', async () => {
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => api.markOf(jordan.id, pass.id)).toBeUndefined();
    await expect(headline).toContainText('JOD 114.000');
    await expect(page.getByRole('button', { name: 'Leave out: Dead Sea day pass' })).toBeVisible();
  });

  await step('Leave it out again, open Left out and Bring back', async () => {
    await page.getByRole('button', { name: 'Leave out: Dead Sea day pass' }).click();
    await expect.poll(() => api.markOf(jordan.id, pass.id)).toBe('excluded');
    await page.getByText('Left out (1)').click();
    await page.getByRole('button', { name: 'Bring back: Dead Sea day pass' }).click();
    await expect.poll(() => api.markOf(jordan.id, pass.id)).toBeUndefined();
    await expect(headline).toContainText('JOD 114.000');
    expect(api.calls('DELETE', new RegExp(`/expense-groups/${jordan.id}/expenses/${pass.id}$`))).toHaveLength(2);
  });
});

test('Keep an expense from before the trip: it joins as Kept, counts, and gets its own bar', { tag: '@portal.expense-groups.add-from-outside' }, async ({ page, step }) => {
  const api = world();
  const drawer = page.getByRole('dialog', { name: 'Add to Jordan trip' });

  await step('Open the group and choose Add from outside these dates', async () => {
    await api.open(page, groupPath(jordan.id));
    await page.getByRole('button', { name: 'Add from outside these dates' }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(`${shown(day(-45))} – ${shown(day(-16))}, not already in this group.`)).toBeVisible();
  });

  await step('Tick the flight booked three weeks earlier and add it', async () => {
    await drawer.getByLabel(/Flight to Amman/).check();
    await drawer.getByRole('button', { name: 'Add (1)' }).click();
    await expect(drawer).toHaveCount(0);
    await expect.poll(() => api.markOf(jordan.id, flight.id)).toBe('included');
  });

  await step('It is listed before the trip as Kept, counted, and has its own bar', async () => {
    await expect(page.getByRole('group', { name: 'Total spent' })).toContainText('JOD 234.000');
    const table = page.getByRole('table', { name: 'Expenses in this group' });
    await expect(table.getByRole('row', { name: /Flight to Amman/ })).toContainText('Kept');
    await expect(table.getByRole('rowheader', { name: /before the trip/ })).toBeVisible();
    await expect(page.getByRole('group', { name: /JOD per day/ }).getByRole('button', { name: /JOD 120\.000.*before the trip/ })).toBeVisible();
  });
});

test('Totals never add currencies; ≈ names the profile currency and rate date; the tab scopes chart and categories', { tag: '@portal.expense-groups.currencies-converted' }, async ({ page, step }) => {
  const api = world();
  const headline = page.getByRole('group', { name: 'Total spent' });

  await step('Open a group with JOD and USD expenses', async () => {
    await api.open(page, groupPath(jordan.id));
    await expect(headline).toContainText('JOD 114.000');
    await expect(headline).toContainText('$40.00');
    await expect(page.getByText(/at today's ECB rate \(Oct 17, 2026\)/)).toBeVisible();
    await expect(page.getByText(/1 JOD = 5\.2239 ILS \(USD peg\)/)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'JOD' })).toHaveAttribute('aria-selected', 'true');
  });

  await step('Switch the currency tab to USD', async () => {
    await page.getByRole('tab', { name: 'USD' }).click();
    await expect(page.getByRole('group', { name: 'USD per day. Arrow keys move between days.' })).toBeVisible();
    await expect(page).toHaveURL(/currency=USD/);
    await expect(page.getByRole('button', { name: /Uncategorized/ })).toContainText('$40.00');
    await expect(headline).toContainText('JOD 114.000');
  });
});

test('Filter by a category and leave all of it out in one go, with one Undo', { tag: '@portal.expense-groups.category-prune' }, async ({ page, step }) => {
  const api = world({ expenses: [taxi, rent, pass, esim, deposit, flight, lunch] });
  const table = page.getByRole('table', { name: 'Expenses in this group' });

  await step('Open the group and click Rent in By category', async () => {
    await api.open(page, groupPath(jordan.id));
    await page.getByRole('button', { name: /^Rent/ }).click();
    await expect(page).toHaveURL(new RegExp(`category=${rentCat.id}`));
    await expect(table).not.toContainText('Airport taxi');
    await expect(table).toContainText('Rent deposit');
  });

  await step('Choose Leave out all 2 Rent', async () => {
    await page.getByRole('button', { name: 'Leave out all 2 Rent' }).click();
    await expect(page.getByText('Left out 2 · Rent')).toBeVisible();
    await expect.poll(() => [api.markOf(jordan.id, rent.id), api.markOf(jordan.id, deposit.id)]).toEqual(['excluded', 'excluded']);
    const puts = api.calls('PUT', /\/expense-groups\//).map((c) => c.path.split('/').pop());
    expect(puts).toEqual([rent.id, deposit.id]);
  });

  await step('Undo', async () => {
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => [api.markOf(jordan.id, rent.id), api.markOf(jordan.id, deposit.id)]).toEqual([undefined, undefined]);
    await expect(table).toContainText('Rent October');
  });
});

test('Empty, upcoming and deleted groups say what is going on; a failed list offers Try again', { tag: '@portal.expense-groups.states' }, async ({ page, step }) => {
  const quiet = expenseGroup(2, { name: 'Quiet week', startOn: day(-60), endOn: day(-55) });
  const istanbul = expenseGroup(3, { name: 'Istanbul', startOn: day(20), endOn: day(26) });
  const api = world({ groups: [jordan, quiet, istanbul] });

  await step('Open a past group with nothing in its dates', async () => {
    await api.open(page, groupPath(quiet.id));
    await expect(page.getByRole('heading', { name: 'Nothing dated in these days yet' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Add from outside these dates' }).first()).toBeVisible();
  });

  await step('Open an upcoming group', async () => {
    await page.goto(groupPath(istanbul.id));
    await expect(page.getByRole('heading', { name: `Istanbul starts ${shown(day(20))}` })).toBeVisible();
  });

  await step('Open a group that was deleted', async () => {
    await page.goto(groupPath(uid(0xb, 99)));
    await expect(page.getByRole('heading', { name: 'This group was deleted' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Groups' })).toBeVisible();
  });

  await step('Open Groups while the server is unreachable, then Try again', async () => {
    // Twice: the portal retries a failed read once before it shows the card
    api.once('GET', /^\/v1\/expense-groups$/, apiError(503, 'UNAVAILABLE'));
    api.once('GET', /^\/v1\/expense-groups$/, apiError(503, 'UNAVAILABLE'));
    await page.goto(`/p/${OFFICE_A}/expenses/groups`);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('list', { name: 'Expense groups' })).toContainText('Quiet week');
  });
});

test("An expense's drawer lists its groups and adds it to another", { tag: '@portal.expense-groups.in-groups-line' }, async ({ page, step }) => {
  const amman = expenseGroup(4, { name: 'Amman conference', startOn: day(-5), endOn: day(-4) });
  const api = world({ groups: [jordan, amman] });
  const drawer = page.getByRole('dialog', { name: 'Edit expense' });

  await step('Open an expense from the Expenses list', async () => {
    await api.open(page, `/p/${OFFICE_A}/expenses`);
    await page.getByRole('table', { name: 'Expenses' }).getByRole('row', { name: /Dead Sea day pass/ }).click();
    await expect(drawer.getByRole('link', { name: 'Jordan trip' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Leave out: Jordan trip' })).toBeVisible();
  });

  await step('Choose Add to group… and pick Amman conference', async () => {
    await drawer.getByRole('button', { name: 'Add to group…' }).click();
    const menu = drawer.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Amman conference']);
    await menu.getByRole('menuitem', { name: 'Amman conference' }).click();
    await expect.poll(() => api.markOf(amman.id, pass.id)).toBe('included');
    await expect(drawer.getByRole('link', { name: 'Amman conference' })).toBeVisible();
  });
});

test('Edit a group with If-Match, then delete it after a confirm that says its expenses stay', { tag: '@portal.expense-groups.edit-delete' }, async ({ page, step }) => {
  const api = world();
  const drawer = page.getByRole('dialog', { name: 'Edit group' });

  await step('Choose Edit, rename the group and save', async () => {
    await api.open(page, groupPath(jordan.id));
    await page.getByRole('button', { name: 'Edit' }).click();
    await drawer.getByLabel('Name').fill('Amman and the Dead Sea');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Amman and the Dead Sea' })).toBeVisible();
    const patch = api.last('PATCH', /\/expense-groups\//);
    expect(patch?.headers['if-match']).toBe('1');
    expect(patch?.body).toMatchObject({ name: 'Amman and the Dead Sea' });
  });

  await step('Choose Edit, Delete group, and confirm', async () => {
    await page.getByRole('button', { name: 'Edit' }).click();
    await drawer.getByRole('button', { name: 'Delete group' }).click();
    await expect(drawer.getByText('Its 4 expenses stay in Expenses.')).toBeVisible();
    await drawer.getByRole('button', { name: 'Delete group' }).last().click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/expenses/groups$`));
    await expect(page.getByRole('heading', { name: "Group a trip's spending" })).toBeVisible();
    expect(api.calls('DELETE', new RegExp(`/expense-groups/${jordan.id}$`))).toHaveLength(1);
  });
});

test('In Arabic on a 375 px phone the group page reads right to left without sideways scrolling', { tag: '@portal.expense-groups.arabic-375' }, async ({ page, step }) => {
  const api = world();

  await step('Open the group in Arabic on a 375 px wide screen', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await api.open(page, groupPath(jordan.id), 'ar');
    await expect(page.getByRole('group', { name: 'إجمالي المصروف' })).toBeVisible();
  });

  await step('It is right to left, folded for a phone, and never scrolls sideways', async () => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'إجراءات أخرى' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تعديل', exact: true })).toBeHidden();
    const table = page.getByRole('table', { name: 'المصاريف في هذه المجموعة' });
    await expect(table.getByRole('columnheader', { name: 'التصنيف' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

