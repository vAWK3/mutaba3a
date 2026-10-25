import { test, expect } from '../../support/qa';
import { OFFICE_A, customer, malafatFirm, office, FIRM } from '../../support/portal';
import { FakeApi, STORAGE, allocation, attachment, payment, project, receivable, apiError } from '../../support/portalApi';

/**
 * The portal's read lists (hosted-portal.md §7.3): Receivables, Payments and
 * Documents, each with its filters in the URL and the shared table. The in-memory
 * API (qa/support/portalApi.ts) filters the way the server does, and every
 * query the portal sent is asserted from its log.
 */

const C1 = customer(0).id;
const C2 = customer(1).id;
const logo = project(1, C1, 'Logo redesign');
const site = project(2, C1, 'Website');
const audit = project(3, C2, 'Annual audit');

test('Receivables opens on what is still open, and its filters narrow it in the URL', { tag: '@portal.ledger.receivables' }, async ({ page, step }) => {
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 2,
    projects: [logo, site, audit],
    receivables: [
      receivable(1, { customerId: C1, projectId: logo.id, gross: '1200.00', status: 'OVERDUE', origin: 'INSTALLMENT' }),
      receivable(2, { customerId: C2, projectId: audit.id, gross: '900.00', paid: '400.00', status: 'PARTIALLY_PAID', origin: 'INSTALLMENT' }),
      receivable(3, { customerId: C1, projectId: site.id, gross: '2000.00', paid: '2000.00', status: 'PAID', origin: 'INSTALLMENT' }),
      receivable(4, { customerId: C2, gross: '75.00', currency: 'USD', origin: 'INSTALLMENT' }),
    ],
  });
  const table = page.getByRole('table', { name: 'Receivables' });

  await step('Open Receivables: the open ones, newest figures from the server', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table.getByRole('row', { name: /Logo redesign/ })).toContainText('Overdue');
    await expect(table.getByRole('row', { name: /Annual audit/ })).toContainText('Partly paid');
    await expect(table.getByRole('row', { name: /Annual audit/ })).toContainText('500.00');
    await expect(page.getByRole('tab', { name: 'Open' })).toHaveAttribute('aria-selected', 'true');
    expect(api.last('GET', /^\/v1\/receivables$/)?.query.get('status')).toBe('OPEN');
  });

  await step('Choose Settled', async () => {
    await page.getByRole('tab', { name: 'Settled' }).click();
    await expect(page).toHaveURL(/status=SETTLED/);
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Website');
    await expect(table).toContainText('Paid');
  });

  await step('Back to All, then pick Client 1: the matter filter offers only that client’s matters', async () => {
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(table.getByRole('row')).toHaveCount(5);
    await page.getByLabel('Client').selectOption({ label: 'Client 1' });
    await expect(page).toHaveURL(new RegExp(`customerId=${C1}`));
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(page.getByLabel('Matter').getByRole('option')).toHaveText(['All', 'Logo redesign', 'Website']);
    expect(api.last('GET', /^\/v1\/receivables$/)?.query.get('customerId')).toBe(C1);
  });

  await step('Narrow to USD: nothing matches, and Clear filters brings the open list back', async () => {
    await page.getByLabel('Currency').selectOption('USD');
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/receivables$`));
    await expect(table.getByRole('row')).toHaveCount(4);
  });
});

test('Payments lists what was received, and a row opens to show which receivables it paid', { tag: '@portal.ledger.payments' }, async ({ page, step }) => {
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 2,
    projects: [logo, audit],
    payments: [
      payment(1, {
        customerId: C1,
        amount: '1500.00',
        number: 'PAY-0001',
        method: 'BANK',
        allocations: [allocation(1, { receivableId: 'r', projectId: logo.id, amount: '1000.00', left: '200.00' })],
      }),
      payment(2, { customerId: C2, amount: '300.00', number: 'PAY-0002', method: 'CASH' }),
      payment(3, { customerId: C2, amount: '90.00', number: 'PAY-0003', status: 'REVERSED' }),
    ],
  });
  const table = page.getByRole('table', { name: 'Payments' });

  await step('Open Payments', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await expect(table.getByRole('row', { name: /PAY-0001/ })).toContainText('Bank transfer');
    await expect(table.getByRole('row', { name: /PAY-0001/ })).toContainText('500.00');
    await expect(table.getByRole('row', { name: /PAY-0002/ })).toContainText('Cash');
    await expect(table.getByRole('row', { name: /PAY-0003/ })).toContainText('Reversed');
  });

  await step('Show where PAY-0001 went', async () => {
    await table.getByRole('row', { name: /PAY-0001/ }).getByRole('button', { name: 'Show where this payment went' }).click();
    const applied = page.getByRole('table', { name: 'Applied to' });
    await expect(applied.getByRole('row', { name: /Logo redesign/ })).toContainText('1,000.00');
    await expect(applied.getByRole('row', { name: /Logo redesign/ })).toContainText('200.00');
  });

  await step('A payment applied nowhere says so', async () => {
    await table.getByRole('row', { name: /PAY-0002/ }).getByRole('button', { name: 'Show where this payment went' }).click();
    await expect(page.getByText('Not applied to any receivable yet.')).toBeVisible();
    await table.getByRole('row', { name: /PAY-0002/ }).getByRole('button', { name: 'Hide where this payment went' }).click();
    await expect(page.getByText('Not applied to any receivable yet.')).toHaveCount(0);
  });

  await step('Show only reversed payments', async () => {
    await page.getByRole('tab', { name: 'Reversed' }).click();
    await expect(page).toHaveURL(/status=REVERSED/);
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('PAY-0003');
    expect(api.last('GET', /^\/v1\/payments$/)?.query.get('status')).toBe('REVERSED');
  });

  await step('Received-from date goes to the server as receivedAfter', async () => {
    await page.getByLabel('Received from').fill('2026-10-01');
    await expect(page).toHaveURL(/receivedFrom=2026-10-01/);
    await expect.poll(() => api.last('GET', /^\/v1\/payments$/)?.query.get('receivedAfter')).toBe('2026-10-01');
  });
});

test('Documents lists invoices and receipts, and Download hands the file to the browser from a signed link', { tag: '@portal.ledger.documents' }, async ({ page, step }) => {
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 2,
    attachments: [
      attachment(1, { filename: 'invoice-7.pdf', kind: 'INVOICE', customerId: C1, invoiceNumber: 'INV-7' }),
      attachment(2, { filename: 'receipt-oct.pdf', kind: 'RECEIPT', customerId: C2 }),
      attachment(3, { filename: 'scan.pdf', kind: 'OTHER', customerId: C2, ready: false }),
    ],
  });
  const table = page.getByRole('table', { name: 'Documents' });

  await step('Open Documents', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents`);
    await expect(table.getByRole('row', { name: /invoice-7\.pdf/ })).toContainText('INV-7');
    await expect(table.getByRole('row', { name: /invoice-7\.pdf/ })).toContainText('Client 1');
    await expect(table.getByRole('row', { name: /scan\.pdf/ })).toContainText('Still uploading');
    await expect(table.getByRole('button', { name: 'Download scan.pdf' })).toHaveCount(0);
  });

  await step('A download that cannot be prepared says so', async () => {
    api.once('GET', /\/download$/, apiError(503, 'UNAVAILABLE'));
    await table.getByRole('button', { name: 'Download invoice-7.pdf' }).click();
    await expect(page.getByRole('alert')).toContainText("Couldn't prepare the download. Try again.");
  });

  await step('Download invoice-7.pdf: the browser goes to the signed link and saves it', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), table.getByRole('button', { name: 'Download invoice-7.pdf' }).click()]);
    expect(download.url()).toBe(`${STORAGE}/invoice-7.pdf`);
    await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  });

  await step('Show only receipts', async () => {
    await page.getByLabel('Type').selectOption({ label: 'Receipt' });
    await expect(page).toHaveURL(/kind=RECEIPT/);
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('receipt-oct.pdf');
  });
});

test('A Malafat-fed profile’s income lists say why nothing can be added there', { tag: '@portal.ledger.read-only' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [malafatFirm(), office(OFFICE_A, 'Nour Studio')], clients: 1, receivables: [receivable(1, { customerId: C1, gross: '500.00' })] });
  const note = page.getByRole('note').filter({ hasText: 'Malafat records income and payments for this profile. To change them, use Malafat.' });

  await step('Open Receivables on the Malafat-fed firm', async () => {
    await api.open(page, `/p/${FIRM}/receivables`);
    await expect(page.getByRole('table', { name: 'Receivables' })).toBeVisible();
    await expect(note).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add income' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Record payment/ })).toHaveCount(0);
  });

  await step('Payments says the same, with no Add income', async () => {
    await page.getByRole('link', { name: 'Paid', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Paid' })).toBeVisible();
    await expect(note).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add income' })).toHaveCount(0);
  });

  await step('A link asking for the Add income drawer opens nothing here', async () => {
    await page.goto(`/p/${FIRM}/payments?newIncome=received`);
    await expect(page.getByRole('heading', { level: 1, name: 'Paid' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  await step('On an owned profile there is no notice and Add income is offered', async () => {
    await page.goto(`/p/${OFFICE_A}/payments`);
    await expect(page.getByRole('button', { name: '+ Add income' }).first()).toBeVisible();
    await expect(note).toHaveCount(0);
  });
});
