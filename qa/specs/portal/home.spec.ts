import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { OFFICE_A, customer, office } from '../../support/portal';
import { FakeApi, category, currencyBlock, expense, libraryReceipt, payment, todayInJerusalem, type FakeApiSeed } from '../../support/portalApi';

/**
 * Home (MUT-657, "Two lanes"): the bare /p/:id, where every signed-in visit and profile switch lands. Receipts &
 * to-dos (an Add lane beside a Waiting lane, no totals) and In & out (this month, per currency) behind a switch. Every
 * /v1 call is answered by the in-memory API in qa/support/portalApi.ts.
 */

const HOME = `/p/${OFFICE_A}`;
const THIS_MONTH = todayInJerusalem().slice(0, 7);
const C1 = customer(0).id;
const C2 = customer(1).id;
const C3 = customer(2).id;
const food = category(1, 'Food');
const rent = category(2, 'Rent');

function world(seed: Partial<FakeApiSeed> = {}) {
  return new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 3,
    categories: [food, rent],
    receipts: [libraryReceipt(1, { filename: 'shufersal.pdf', mimeType: 'application/pdf' }), libraryReceipt(2, { filename: 'cab.pdf', mimeType: 'application/pdf' })],
    summary: [
      currencyBlock('ILS', {
        outstanding: '4500.00',
        overdue: '2400.00',
        customers: [
          { customerId: C1, outstanding: '1200.00', overdue: '1200.00', status: 'OVERDUE', daysOverdue: 5 },
          { customerId: C2, outstanding: '1200.00', overdue: '1200.00', status: 'OVERDUE', daysOverdue: 12 },
          { customerId: C3, outstanding: '2100.00', overdue: '0.00', status: 'OUTSTANDING' },
        ],
      }),
      currencyBlock('USD', { outstanding: '950.00', overdue: '0.00', customers: [{ customerId: C3, outstanding: '950.00', overdue: '0.00', status: 'OUTSTANDING' }] }),
    ],
    ...seed,
  });
}

const addLane = (page: Page) => page.getByRole('region', { name: 'Add' });
const toReview = (page: Page) => page.getByRole('region', { name: 'To review' });
const overdue = (page: Page) => page.getByRole('region', { name: 'Clients overdue' });

test('signed in, the portal opens on home: an Add lane beside what is waiting, and no totals', { tag: '@portal.home.waiting' }, async ({ page, step }) => {
  const api = world();
  const nav = page.getByRole('navigation', { name: 'Sections' });

  await step('Sign in and open the portal at /', async () => {
    await api.open(page, '/');
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(nav.getByRole('link')).toHaveText(['Home', 'Owed', 'Paid', 'Spent', 'Clients']);
    await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  await step('The Add lane: drop zone, Add receipt and Add income', async () => {
    await expect(addLane(page).getByText('Drop receipts here')).toBeVisible();
    await expect(addLane(page).getByRole('button', { name: 'Add receipt' })).toBeVisible();
    await expect(addLane(page).getByRole('button', { name: 'Add income' })).toBeVisible();
    // A desktop has a fine pointer: no camera button
    await expect(addLane(page).getByRole('button', { name: 'Take a photo' })).toBeHidden();
  });

  await step('At a phone’s width the drop zone gives way to the buttons', async () => {
    const desktop = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(addLane(page).getByText('Drop receipts here')).toBeHidden();
    await expect(addLane(page).getByRole('button', { name: 'Add receipt' })).toBeVisible();
    if (desktop) await page.setViewportSize(desktop);
    await expect(addLane(page).getByText('Drop receipts here')).toBeVisible();
  });

  await step('The Waiting lane: receipts to review as cards, overdue clients by name, most late first', async () => {
    await expect(toReview(page).getByRole('listitem')).toHaveCount(2);
    await expect(toReview(page).getByText('2 receipts to review')).toBeAttached();
    expect(api.last('GET', /^\/v1\/receipts$/)?.query.get('limit')).toBe('8');
    const people = overdue(page).getByRole('listitem');
    await expect(people).toHaveCount(2);
    await expect(people.nth(0)).toHaveText(/Client 2\s*12 days late/);
    await expect(people.nth(1)).toHaveText(/Client 1\s*5 days late/);
    await expect(overdue(page).getByRole('button', { name: /Remind/ })).toHaveCount(0);
  });

  await step('No amount shows anywhere on home', async () => {
    await expect(page.getByRole('main').locator('.hp-amount')).toHaveCount(0);
  });

  await step('Open a receipt to review, then come back with Home', async () => {
    await toReview(page).getByRole('link', { name: 'Open shufersal.pdf' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/expenses/receipts/`));
    await nav.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  });

  await step('Open the most late client, then come back and choose See all under Clients overdue', async () => {
    await overdue(page).getByRole('link', { name: 'Client 2' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/clients/${C2}`));
    await nav.getByRole('link', { name: 'Home', exact: true }).click();
    await overdue(page).getByRole('link', { name: 'See all clients overdue' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/owed$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
  });
});

test('with nothing waiting, home says one calm sentence; the old ?currency= address opens Owed', { tag: '@portal.home.clear' }, async ({ page, step }) => {
  const api = world({ receipts: [], summary: [currencyBlock('ILS', { outstanding: '2100.00', overdue: '0.00', customers: [{ customerId: C3, outstanding: '2100.00', overdue: '0.00', status: 'OUTSTANDING' }] }), currencyBlock('USD', { outstanding: '950.00', overdue: '0.00', customers: [{ customerId: C3, outstanding: '950.00', overdue: '0.00', status: 'OUTSTANDING' }] })] });

  await step('Open home with no receipts to review and nobody overdue', async () => {
    await api.open(page, HOME);
    await expect(page.getByText('Nothing needs you right now.')).toBeVisible();
    await expect(toReview(page)).toHaveCount(0);
    await expect(overdue(page)).toHaveCount(0);
  });

  await step('Open the old Owed address with ?currency=USD', async () => {
    await page.goto(`${HOME}?currency=USD`);
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/owed\\?currency=USD$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'USD' })).toContainText('950.00');
  });
});

test('drop or pick receipts on home: they land in To review with the gallery’s rules', { tag: '@portal.home.upload' }, async ({ page, step }) => {
  const api = world({ receipts: [libraryReceipt(1, { filename: 'shufersal.pdf', mimeType: 'application/pdf' })], summary: [] });

  await step('Open home on a profile with one receipt to review', async () => {
    await api.open(page, HOME);
    await expect(toReview(page).getByRole('listitem')).toHaveCount(1);
  });

  await step('Add receipt: a text file is refused before anything is sent', async () => {
    await page.getByTestId('home-receipt-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: 'notes.txt: receipts must be a PDF, JPEG or PNG file.' })).toBeVisible();
    expect(api.calls('POST', /^\/v1\/receipts\/uploads$/)).toHaveLength(0);
  });

  await step('Add receipt: a PNG is started, PUT to the bucket and completed, and lands in To review', async () => {
    await page.getByTestId('home-receipt-input').setInputFiles({ name: 'taxi.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
    await expect(page.getByText('1 receipt added to To review')).toBeVisible();
    expect(api.last('POST', /^\/v1\/receipts\/uploads$/)?.body).toMatchObject({ filename: 'taxi.png', mimeType: 'image/png' });
    expect(api.storage.some((r) => r.method === 'PUT' && r.url.includes('/upload/'))).toBe(true);
    await expect(toReview(page).getByText('2 receipts to review')).toBeAttached();
  });

  await step('Drop a PDF on the drop zone: it lands too', async () => {
    const files = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['%PDF-1.4'], 'hotel.pdf', { type: 'application/pdf' }));
      return data;
    });
    const zone = addLane(page).getByText('Drop receipts here');
    await zone.dispatchEvent('dragover', { dataTransfer: files });
    await zone.dispatchEvent('drop', { dataTransfer: files });
    await expect(toReview(page).getByText('3 receipts to review')).toBeAttached();
    expect(api.calls('POST', /^\/v1\/receipts\/uploads$/)).toHaveLength(2);
  });
});

test('home’s In & out: this month in and out per currency, with the ways to Owed, Spent and Reports', { tag: '@portal.home.in-out' }, async ({ page, step }) => {
  const api = world({
    payments: [payment(1, { customerId: C1, amount: '1500.00', receivedOn: `${THIS_MONTH}-01` }), payment(2, { customerId: C3, amount: '640.00', currency: 'USD', receivedOn: `${THIS_MONTH}-01` })],
    expenses: [expense(1, { amount: '400.00', categoryId: food.id, occurredOn: `${THIS_MONTH}-01` }), expense(2, { amount: '1200.00', categoryId: rent.id, occurredOn: `${THIS_MONTH}-01` })],
  });
  const moneyIn = page.getByRole('region', { name: 'Money in' });
  const moneyOut = page.getByRole('region', { name: 'Money out' });
  const nav = page.getByRole('navigation', { name: 'Sections' });

  await step('Open home and choose In & out', async () => {
    await api.open(page, HOME);
    await page.getByRole('button', { name: 'In & out' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}\\?view=in-out$`));
    await expect(page.getByRole('button', { name: 'In & out' })).toHaveAttribute('aria-pressed', 'true');
  });

  await step('Money in: received this month, owed and overdue now; Money out: spent, by category', async () => {
    await expect(moneyIn).toContainText('1,500.00');
    await expect(moneyIn).toContainText('4,500.00');
    await expect(moneyIn).toContainText('2,400.00');
    await expect(moneyOut).toContainText('1,600.00');
    await expect(moneyOut.getByRole('listitem').nth(0)).toContainText('Rent');
    await expect(moneyOut.getByRole('listitem').nth(1)).toContainText('Food');
  });

  await step('Switch the currency to USD: the address keeps no currency', async () => {
    await page.getByRole('tab', { name: 'USD' }).click();
    await expect(moneyIn).toContainText('640.00');
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}\\?view=in-out$`));
  });

  await step('Leave for Paid and come back with Home: Receipts & to-dos opens', async () => {
    await nav.getByRole('link', { name: 'Paid', exact: true }).click();
    await nav.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('button', { name: 'Receipts & to-dos' })).toHaveAttribute('aria-pressed', 'true');
  });

  await step('Open the monthly summary mail’s link: In & out, with the ways on', async () => {
    await page.goto(`${HOME}?view=in-out`);
    await expect(moneyIn).toBeVisible();
    await expect(moneyIn.getByRole('link', { name: 'Open Owed' })).toHaveAttribute('href', `/p/${OFFICE_A}/owed`);
    await expect(moneyOut.getByRole('link', { name: 'Open Spent' })).toHaveAttribute('href', `/p/${OFFICE_A}/expenses`);
    await expect(page.getByRole('link', { name: 'Compare months in Reports' })).toHaveAttribute('href', `/p/${OFFICE_A}/reports`);
  });
});
