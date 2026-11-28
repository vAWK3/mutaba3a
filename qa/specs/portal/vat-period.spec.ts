import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, office } from '../../support/portal';
import { CAFE, CARD_PROFILE, ClientBooksApi, STUDIO, type StubClient, type StubVat } from '../../support/clientBooksApi';
import { FakeApi, type StubVatPeriod } from '../../support/portalApi';

/**
 * MUT-783 (epic MUT-762; MUT-782's routes, ADR-343): the client's VAT period on home and the accountant's desk, over
 * in-memory APIs that answer the way the server does. One role per flow; the handover between them is MUT-782's route tests.
 */

const PHONE = { width: 375, height: 812 };
const HOME = `/p/${OFFICE_A}`;
const KEY = '2026-B5';

const period = (state: StubVatPeriod['state'], over: Partial<StubVatPeriod> = {}): StubVatPeriod => ({
  periodKey: KEY, kind: 'BIMONTHLY', year: 2026, firstMonth: 9, lastMonth: 10, startDate: '2026-09-01', endDate: '2026-10-31', due: '2026-11-15', state, note: null,
  announcedAt: new Date().toISOString(), doneAt: null, ...over,
});

const client = (profileId: string, name: string, ownerName: string): StubClient => ({ profileId, name, ownerName, status: 'active', entriesThisMonth: 4, lastActivityAt: new Date().toISOString() });
const CAFE_C = client(CAFE, 'Café Nour', 'Samer Haddad');
const BAKERY_C = client(CARD_PROFILE, 'Bakery', 'Layla Saeed');
const STUDIO_C = client(STUDIO, 'Studio', 'Rana Haddad');

const deskVat = (): Record<string, StubVat> => ({
  [CAFE]: { chosenKind: null, period: period('OPEN') },
  [CARD_PROFILE]: { chosenKind: null, period: period('CLIENT_DONE') },
  [STUDIO]: { chosenKind: null, period: period('CONFIRMED') },
});
const rowOf = (page: import('@playwright/test').Page, name: string) => page.getByRole('table', { name: 'Client books' }).getByRole('row').filter({ hasText: name });

test('A client sees the VAT period that ended on home and says all receipts are sent, once', { tag: '@portal.vat-period.client-done' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], vatPeriod: period('OPEN') });

  await step('Open home with a VAT period that ended and nothing else waiting', async () => {
    await api.open(page, HOME);
    const group = page.getByRole('region', { name: 'VAT · Sep – Oct 2026' });
    await expect(group).toBeVisible();
    await expect(group.getByText('Nov 15')).toBeVisible();
    await expect(group.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.getByRole('main').locator('.hp-amount')).toHaveCount(0);
  });

  await step('Tap Done', async () => {
    const group = page.getByRole('region', { name: 'VAT · Sep – Oct 2026' });
    await group.getByRole('button', { name: 'Done' }).click();
    await expect(group.getByText('Waiting for your accountant')).toBeVisible();
    await expect(group.getByRole('button', { name: 'Done' })).toHaveCount(0);
    expect(api.calls('POST', new RegExp(`/vat-periods/${KEY}/done$`))).toHaveLength(1);
  });

  await step('Open home in Arabic at 375 px', async () => {
    await page.setViewportSize(PHONE);
    const arabic = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], vatPeriod: period('OPEN', { firstMonth: 1, lastMonth: 2 }) });
    await arabic.open(page, HOME, 'ar');
    const group = page.getByRole('region', { name: /ضريبة القيمة المضافة/ });
    await expect(group).toBeVisible();
    await expect(group).toContainText('كانون الثاني');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'Home VAT period, Arabic, 375');
  });
});

test('An accountant sees who is waiting on the desk and confirms a client\'s period', { tag: '@portal.vat-period.desk-confirm' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ clients: [CAFE_C, BAKERY_C, STUDIO_C], vat: deskVat() });

  await step('Open the desk with clients in each state', async () => {
    await api.open(page, '/client-books');
    await expect(rowOf(page, 'Café Nour')).toContainText('Waiting for client');
    await expect(rowOf(page, 'Café Nour')).toContainText('Sep – Oct 2026');
    await expect(rowOf(page, 'Café Nour')).toContainText('Nov 15');
    await expect(rowOf(page, 'Bakery')).toContainText('Client sent');
    await expect(rowOf(page, 'Studio')).toContainText('Confirmed');
    const chips = page.getByRole('group', { name: 'VAT state' });
    await expect(chips.getByRole('button', { name: /Client sent/ })).toContainText('1');
  });

  await step('Filter to the clients who sent', async () => {
    await page.getByRole('group', { name: 'VAT state' }).getByRole('button', { name: /Client sent/ }).click();
    await expect(rowOf(page, 'Bakery')).toBeVisible();
    await expect(rowOf(page, 'Café Nour')).toHaveCount(0);
  });

  await step('Open the client\'s VAT drawer and confirm', async () => {
    await rowOf(page, 'Bakery').getByRole('button', { name: 'VAT period: Bakery' }).click();
    const drawer = page.getByRole('dialog', { name: 'Bakery' });
    await expect(drawer.getByText('Client sent')).toBeVisible();
    await drawer.getByRole('button', { name: 'Confirm' }).click();
    await expect(drawer.getByText('Confirmed')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    const [post] = api.calls('POST', `/v1/clients/${CARD_PROFILE}/vat-periods/${KEY}/review`);
    expect(post?.body).toEqual({ decision: 'CONFIRMED' });
  });
});

test('An accountant asks a client for more receipts with a note, and chooses how often the client files', { tag: '@portal.vat-period.desk-ask-more' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ clients: [CAFE_C, BAKERY_C, STUDIO_C], vat: deskVat() });
  await api.open(page, `/client-books?vat=${CARD_PROFILE}`);
  const drawer = page.getByRole('dialog', { name: 'Bakery' });

  await step('Open a client\'s VAT drawer and choose Ask for more', async () => {
    await expect(drawer.getByText('Client sent')).toBeVisible();
    await drawer.getByRole('button', { name: 'Ask for more' }).click();
    const note = drawer.getByRole('textbox', { name: 'Note' });
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('maxlength', '200');
  });

  await step('Write a note and send it', async () => {
    await drawer.getByRole('textbox', { name: 'Note' }).fill('October fuel');
    await drawer.getByRole('button', { name: 'Ask for more' }).click();
    await expect(drawer.getByRole('textbox', { name: 'Note' })).toHaveCount(0);
    await expect(drawer.getByText('More needed')).toBeVisible();
    await expect(drawer.getByText('October fuel')).toBeVisible();
    const [post] = api.calls('POST', `/v1/clients/${CARD_PROFILE}/vat-periods/${KEY}/review`);
    expect(post?.body).toEqual({ decision: 'MORE_NEEDED', note: 'October fuel' });
  });

  await step('Choose "Monthly" for the client', async () => {
    await drawer.getByRole('combobox', { name: 'VAT period' }).selectOption('MONTHLY');
    await expect.poll(() => api.calls('PUT', `/v1/clients/${CARD_PROFILE}/vat-period`)[0]?.body).toEqual({ kind: 'MONTHLY' });
  });
});

test('A client sees what the accountant did with the period: more needed with the note, then confirmed', { tag: '@portal.vat-period.client-result' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], vatPeriod: period('MORE_NEEDED', { note: 'October fuel', doneAt: new Date().toISOString() }) });
  const group = () => page.getByRole('region', { name: 'VAT · Sep – Oct 2026' });

  await step('Open home with a period the accountant asked more for', async () => {
    await api.open(page, HOME);
    await expect(group().getByText('Your accountant needs more')).toBeVisible();
    await expect(group().getByText('October fuel')).toBeVisible();
    await expect(group().getByRole('button', { name: 'Done' })).toBeVisible();
  });

  await step('Tap Done again', async () => {
    await group().getByRole('button', { name: 'Done' }).click();
    await expect(group().getByText('Waiting for your accountant')).toBeVisible();
    await expect(group().getByRole('button', { name: 'Done' })).toHaveCount(0);
    await expect(group().getByText('October fuel')).toHaveCount(0);
  });

  await step('Open home with a period the accountant confirmed', async () => {
    const confirmed = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], vatPeriod: period('CONFIRMED') });
    await confirmed.open(page, HOME);
    await expect(group().getByText('Confirmed by your accountant')).toBeVisible();
    await expect(group().getByRole('button', { name: 'Done' })).toHaveCount(0);
  });
});
