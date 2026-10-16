import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { attachScreenshot } from '../../support/brand';
import { OFFICE_A, OFFICE_B, customer, malafatFirm, office } from '../../support/portal';
import { FakeApi, currencyBlock, customerSummary, payment, project, receivable, attachment, uid } from '../../support/portalApi';

/**
 * The signed-in portal's shell (hosted-portal.md §7.1): the overview, the
 * section navigation, the profile switcher and client detail. Every /v1 call is
 * answered by the in-memory API in qa/support/portalApi.ts.
 */

const portalI18n = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/hosted/i18n');
const AR_HOSTED = (JSON.parse(fs.readFileSync(path.join(portalI18n, 'ar.json'), 'utf8')) as { hosted: { shell: { sections: string; nav: Record<string, string> }; conversions: { title: string } } }).hosted;
const AR = AR_HOSTED.shell;

const C1 = customer(0).id;
const C2 = customer(1).id;
const C3 = customer(2).id;
const SECTIONS = ['Overview', 'Clients', 'Receivables', 'Payments', 'Documents', 'Expenses', 'Conversions'] as const;

function seeded() {
  return new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Nour Accounting'), malafatFirm()],
    clients: 3,
    summary: [
      currencyBlock('ILS', {
        outstanding: '4500.00',
        overdue: '1200.00',
        proposed: '800.00',
        customers: [
          { customerId: C3, outstanding: '0.00', overdue: '0.00', lastPaymentOn: '2026-09-01', status: 'SETTLED' },
          { customerId: C2, outstanding: '3300.00', overdue: '0.00', lastPaymentOn: '2026-10-02', status: 'OUTSTANDING' },
          { customerId: C1, outstanding: '1200.00', overdue: '1200.00', status: 'OVERDUE' },
        ],
      }),
      currencyBlock('USD', { outstanding: '950.00', overdue: '0.00', customers: [{ customerId: C2, outstanding: '950.00', overdue: '0.00', status: 'OUTSTANDING' }] }),
    ],
  });
}

test('signed in, the portal opens on the first profile’s overview and every section is one click away', { tag: '@portal.shell.navigate' }, async ({ page, step }) => {
  const api = seeded();

  await step('Open the portal signed in', async () => {
    await api.open(page, '/');
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });

  await step('The overview shows what is owed, overdue and proposed, overdue clients first', async () => {
    const strip = page.getByRole('group', { name: 'ILS' });
    await expect(strip).toContainText('Owed');
    await expect(strip).toContainText('4,500.00');
    await expect(strip).toContainText('1,200.00');
    await expect(strip).toContainText('800.00');
    await expect(page.getByText(/^As of /)).toBeVisible();
    const rows = page.getByRole('table', { name: 'Overview' }).getByRole('row');
    await expect(rows.nth(1)).toContainText('Client 1');
    await expect(rows.nth(1)).toContainText('Overdue');
    await expect(rows.nth(2)).toContainText('Client 2');
    await expect(rows.nth(3)).toContainText('Client 3');
  });

  await step('Screenshot the shell, for the spacing review (MUT-165 D9)', async () => {
    await attachScreenshot(page, 'portal-shell-overview-en');
  });

  await step('Switch the overview to USD', async () => {
    await page.getByRole('tab', { name: 'USD' }).click();
    await expect(page).toHaveURL(/currency=USD/);
    await expect(page.getByRole('group', { name: 'USD' })).toContainText('950.00');
    await expect(page.getByRole('table', { name: 'Overview' }).getByRole('row')).toHaveCount(2);
  });

  await step('Visit each section from the sidebar', async () => {
    const nav = page.getByRole('navigation', { name: 'Sections' });
    for (const section of SECTIONS) {
      await nav.getByRole('link', { name: section, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: section })).toBeVisible();
      await expect(nav.getByRole('link', { name: section, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  await step('Choose عربي in the account menu: the shell turns right to left, in the portal’s Arabic', async () => {
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menu', { name: 'Account' }).getByRole('button', { name: 'عربي' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const nav = page.getByRole('navigation', { name: AR.sections });
    await expect(nav.getByRole('link', { name: AR.nav.clients, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: AR_HOSTED.conversions.title })).toBeVisible();
    await attachScreenshot(page, 'portal-shell-conversions-ar');
  });

  await step('Every figure came from this profile', async () => {
    const profileCalls = api.log.filter((call) => call.path !== '/v1/me' && !call.path.startsWith('/v1/me/'));
    expect(profileCalls.length).toBeGreaterThan(0);
    for (const call of profileCalls) expect(call.headers['x-mutaba3a-profile']).toBe(OFFICE_A);
  });
});

test('switching profile keeps the section, and a profile that is not yours says so', { tag: '@portal.shell.switch-profile' }, async ({ page, step }) => {
  const api = seeded();

  await step('Open Payments on Nour Studio', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
  });

  const switcher = page.getByRole('button', { name: /^Switch profile/ });
  await step('Open the profile switcher: each profile with what kind it is, and the local-profiles footer', async () => {
    await switcher.click();
    const menu = page.getByRole('menu', { name: 'Switch profile' });
    await expect(menu.getByRole('menuitemradio', { name: /Nour Studio/ })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemradio', { name: /Nour Accounting/ })).toContainText('Business');
    await expect(menu.getByRole('menuitemradio', { name: /Haddad & Partners/ })).toContainText('Income recorded by Malafat');
    await expect(menu).toContainText('Your local profiles stay in the Mutaba3a app on your device.');
  });

  await step('Escape closes it and gives focus back to the switcher', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Switch profile' })).toHaveCount(0);
    await expect(switcher).toBeFocused();
  });

  await step('Switch to Nour Accounting: still on Payments, now for that profile', async () => {
    await switcher.click();
    await page.getByRole('menuitemradio', { name: /Nour Accounting/ }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}/payments$`));
    await expect(page.getByRole('button', { name: 'Switch profile: Nour Accounting' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
    await expect.poll(() => api.last('GET', /^\/v1\/payments$/)?.headers['x-mutaba3a-profile']).toBe(OFFICE_B);
  });

  await step('Open a profile id that is not on the account', async () => {
    await page.goto(`/p/${uid(0x5, 1)}/clients`);
    await expect(page.getByRole('heading', { name: "This profile isn't available" })).toBeVisible();
  });

  await step('Go to the first profile from there', async () => {
    await page.getByRole('button', { name: 'Go to Nour Studio' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
});

test('a client opens to its summary and matters, then its own receivables, payments and documents', { tag: '@portal.shell.client-detail' }, async ({ page, step }) => {
  const logo = project(1, C1, 'Logo redesign');
  const site = project(2, C1, 'Website');
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 2,
    projects: [logo, site, project(3, C2, 'Other client matter')],
    summary: [currencyBlock('ILS', { outstanding: '1200.00', overdue: '1200.00', customers: [{ customerId: C1, outstanding: '1200.00', overdue: '1200.00', status: 'OVERDUE' }] })],
    customerSummaries: [
      customerSummary(C1, {
        currency: 'ILS',
        outstanding: '1200.00',
        overdue: '1200.00',
        lastPaymentOn: '2026-09-20',
        status: 'OVERDUE',
        matters: [
          { projectId: logo.id, agreed: '3000.00', posted: '3000.00', paid: '1800.00', outstanding: '1200.00', status: 'OVERDUE' },
          { projectId: site.id, agreed: '2000.00', posted: '2000.00', paid: '2000.00', outstanding: '0.00', status: 'PAID_IN_FULL' },
        ],
      }),
    ],
    receivables: [
      receivable(1, { customerId: C1, projectId: logo.id, gross: '1200.00', status: 'OVERDUE', origin: 'INSTALLMENT', dueDate: '2026-09-30' }),
      receivable(2, { customerId: C2, gross: '300.00' }),
    ],
    payments: [payment(1, { customerId: C1, amount: '1800.00', number: 'PAY-0101' }), payment(2, { customerId: C2, amount: '50.00', number: 'PAY-0202' })],
    attachments: [attachment(1, { filename: 'invoice-logo.pdf', customerId: C1, invoiceNumber: 'INV-7' }), attachment(2, { filename: 'other.pdf', customerId: C2 })],
  });

  await step('Open Clients and choose Client 1', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await page.getByRole('link', { name: 'Client 1' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Client 1' })).toBeVisible();
  });

  await step('The summary shows the last payment, the ILS figures and each matter', async () => {
    await expect(page.getByText('Last payment: Sep 20, 2026')).toBeVisible();
    const strip = page.getByRole('group', { name: 'ILS' });
    await expect(strip).toContainText('Outstanding');
    await expect(strip).toContainText('1,200.00');
    await expect(strip).toContainText('Overdue');
    const matters = page.getByRole('table', { name: 'Matters' });
    await expect(matters.getByRole('row', { name: /Logo redesign/ })).toContainText('Overdue');
    await expect(matters.getByRole('row', { name: /Website/ })).toContainText('Paid in full');
  });

  await step('Receivables tab: only this client’s, with no client column', async () => {
    await page.getByRole('tab', { name: 'Receivables' }).click();
    await expect(page).toHaveURL(/tab=receivables/);
    const table = page.getByRole('table', { name: 'Receivables' });
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Logo redesign');
    await expect(table.getByRole('columnheader', { name: 'Client' })).toHaveCount(0);
    expect(api.last('GET', /^\/v1\/receivables$/)?.query.get('customerId')).toBe(C1);
  });

  await step('Payments tab: this client’s payments', async () => {
    await page.getByRole('tab', { name: 'Payments' }).click();
    const table = page.getByRole('table', { name: 'Payments' });
    await expect(table).toContainText('PAY-0101');
    await expect(table).not.toContainText('PAY-0202');
  });

  await step('Documents tab: this client’s documents', async () => {
    await page.getByRole('tab', { name: 'Documents' }).click();
    const table = page.getByRole('table', { name: 'Documents' });
    await expect(table).toContainText('invoice-logo.pdf');
    await expect(table).not.toContainText('other.pdf');
  });

  await step('Back to All clients', async () => {
    await page.getByRole('link', { name: 'All clients' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  });
});

test('an account with no profile yet is offered New profile and Sign out', { tag: '@portal.shell.no-profiles' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [] });

  await step('Sign in to an account with no profile', async () => {
    await api.open(page, '/');
    await expect(page.getByRole('heading', { name: "You don't have a profile yet" })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
  });

  await step('New profile opens the New profile drawer', async () => {
    await page.getByRole('main').getByRole('button', { name: '+ New profile' }).click();
    await expect(page.getByRole('dialog', { name: 'New profile' })).toBeVisible();
    await expect(page).toHaveURL(/newProfile=true/);
  });

  await step('Back closes it; Sign out is there beside it', async () => {
    await page.goBack();
    await expect(page.getByRole('dialog', { name: 'New profile' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
