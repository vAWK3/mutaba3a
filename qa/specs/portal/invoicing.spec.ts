import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, customer, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou } from '../../support/you';

/**
 * MUT-646: the invoicing setup (round 3, variant 2): the letterhead is the map of the five steps, each saved on its
 * own; issuing waits for the business details and the numbering answer.
 */
const LOGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/invoicing/logo.png');
const setupPath = `/p/${OFFICE_A}/you/invoicing`;
const C1 = customer(0).id;
const iso = (text: string) => `⁨${text}⁩`;

const seeded = () =>
  new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    invoicing: true,
    registry: [{ taxId: '516123452', kind: 'company', name: 'נור סטודיו בע״מ', nameEn: 'NOUR STUDIO LTD', status: 'פעילה', active: true, address: 'הרמון 12, נצרת' }],
  });

test('set up issuing: three cards, then each step saved on its own until the letterhead is ready', { tag: '@portal.invoicing.setup' }, async ({ page, step }) => {
  const api = seeded();
  const paper = page.getByTestId('letterhead');
  const region = (n: number) => paper.getByRole('button', { name: new RegExp(`^Step ${n}:`) });

  await step('Open You › Profiles on Nour Studio and choose Invoicing', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await openYou(page, 'profiles');
    const entry = page.getByRole('link', { name: /^Invoicing/ });
    await expect(entry).toContainText('Set up issuing tax invoices and receipts');
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`${setupPath}$`));
    await expect(page.getByRole('heading', { level: 1, name: `Invoicing · ${iso('Nour Studio')}` })).toBeVisible();
  });

  await step('The introduction: what is issued, issued documents are final, allocation numbers; Begin setup', async () => {
    await expect(page.getByRole('heading', { name: 'What you can issue' })).toBeVisible();
    await expect(page.getByText('A tax invoice is corrected by issuing a credit note.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Allocation numbers' })).toBeVisible();
    await page.getByRole('button', { name: 'Begin setup' }).click();
    expect(api.last('POST', /^\/v1\/issuing\/setup\/intro-seen$/)).toBeTruthy();
    await expect(page.getByTestId('setup-blocked')).toHaveText('Issuing opens once these are complete: Business details · Numbering');
    await expect(page.getByTestId('setup-progress')).toHaveText('0 of 5 complete');
  });

  await step('Business details: the registry fills the name and address, the letterhead shows them as they fill; Next saves', async () => {
    await page.getByLabel('VAT file or company number').fill('516123452');
    await expect(page.getByLabel('Legal name')).toHaveValue('נור סטודיו בע״מ');
    await expect(page.getByLabel('Address')).toHaveValue('הרמון 12, נצרת');
    await page.getByLabel('City').fill('נצרת');
    await expect(paper).toContainText('נור סטודיו בע״מ');
    await expect(paper).toContainText('ח.פ. 516123452');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(region(1)).toHaveAttribute('data-done', 'true');
    const put = api.last('PUT', /^\/v1\/issuer$/);
    expect(put?.body).toMatchObject({ vatId: '516123452', legalName: 'נור סטודיו בע״מ', dealerType: 'COMPANY', address: 'הרמון 12, נצרת', city: 'נצרת' });
    await expect(page.getByTestId('setup-blocked')).toHaveText('Issuing opens once these are complete: Numbering');
  });

  await step('Logo: choose a PNG; it appears in the letterhead; Next', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Logo' })).toBeVisible();
    await page.getByTestId('logo-file').setInputFiles(LOGO);
    await expect(paper.locator('.hp-paper-logo img')).toBeVisible();
    expect(api.last('PUT', /^\/v1\/issuer\/logo$/)?.headers['content-type']).toBe('image/png');
    await expect(region(2)).toHaveAttribute('data-done', 'true');
    await page.getByRole('button', { name: 'Next' }).click();
  });

  await step('Defaults: Modern, blue ink and English change the letterhead at once; Next saves with If-Match', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Style and defaults' })).toBeVisible();
    await page.getByRole('radio', { name: 'Modern' }).click();
    await expect(paper).toHaveClass(/hp-paper--modern/);
    await page.getByRole('radio', { name: 'Blue' }).click();
    await expect(paper).toHaveAttribute('data-ink', 'BLUE');
    await page.getByRole('radio', { name: 'English' }).click();
    await expect(paper).toHaveAttribute('dir', 'ltr');
    await expect(paper).toContainText('Tax invoice 1');
    await page.getByLabel('Bank details').fill('Bank Leumi 10-800-123456');
    await expect(paper).toContainText('Bank Leumi 10-800-123456');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(region(3)).toHaveAttribute('data-done', 'true');
    const put = api.last('PUT', /^\/v1\/issuer\/defaults$/);
    expect(put?.body).toMatchObject({ documentStyle: 'MODERN', ink: 'BLUE', defaultLanguage: 'en', bankDetails: 'Bank Leumi 10-800-123456' });
    expect(put?.headers['if-match']).toBe('1');
  });

  await step('Numbering: continue from another system at tax invoice 1043; Next; the letterhead is ready', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Numbering' })).toBeVisible();
    await page.getByRole('radio', { name: 'Yes, continue my numbering' }).click();
    await page.getByLabel('Tax invoice: next number').fill('1043');
    await expect(paper).toContainText('Tax invoice 1043');
    await page.getByRole('button', { name: 'Next' }).click();
    expect(api.last('PUT', /^\/v1\/issuing\/numbering$/)?.body).toEqual({ alreadyIssuing: true, starts: { TAX_INVOICE: 1043 } });
    await expect(page.getByTestId('setup-ready')).toContainText('Your letterhead is ready');
    await expect(page.getByTestId('setup-progress')).toHaveText('4 of 5 complete');
    await expect(page.getByRole('heading', { level: 2, name: 'Tax Authority' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  await step('In Arabic the page reads right to left and the regions are named الخطوة 1 … 5', async () => {
    await api.open(page, setupPath, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: `الفوترة · ${iso('Nour Studio')}` })).toBeVisible();
    for (const [n, title] of [
      [1, 'بيانات المصلحة'],
      [2, 'الشعار'],
      [3, 'مظهر المستندات وإعداداتها'],
      [4, 'الترقيم'],
      [5, 'سلطة الضرائب'],
    ] as const) {
      await expect(paper.getByRole('button', { name: `الخطوة ${n}: ${title}` })).toBeVisible();
    }
    await expect(page.getByTestId('setup-ready')).toContainText('الترويسة جاهزة');
  });
});

test('only a business profile whose owner issues documents has the way in', { tag: '@portal.invoicing.setup-hidden' }, async ({ page, step }) => {
  await step('Open You › Profiles on a server where issuing is off for the person', async () => {
    const off = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
    await off.open(page, `/p/${OFFICE_A}/payments`);
    await openYou(page, 'profiles');
    await expect(page.getByRole('link', { name: /Manage profiles/ }).or(page.getByRole('button', { name: /Manage profiles/ }))).toBeVisible();
    await expect(page.getByRole('link', { name: /^Invoicing/ })).toHaveCount(0);
  });

  await step("Open the invoicing page's address directly: back to You › Profiles", async () => {
    const off = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
    await off.open(page, setupPath);
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/you$`));
  });
});

/** MUT-570: issuing, on a profile whose setup is done (details and numbering). */
const ready = () =>
  new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 1,
    invoicing: 'ready',
  });

test('issue a tax invoice: client, lines, live totals, then the document with its number and what is still owed', { tag: '@portal.invoicing.issue-invoice' }, async ({ page, step }) => {
  const api = ready();
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });

  await step('Open Documents › Issued and choose Issue a document', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await expect(page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: 'Issued' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('issued-empty')).toBeVisible();
    await page.getByTestId('issue-open').click();
    await expect(drawer).toBeVisible();
  });

  await step('Choose Client 1, describe two lines; the totals come from the server as they are typed', async () => {
    await drawer.getByLabel('Client').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await drawer.getByLabel('Description').fill('Flutter development, sprint 3');
    await drawer.getByLabel('Quantity').fill('40');
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('450');
    await drawer.getByRole('button', { name: '+ Add a line' }).click();
    await drawer.getByLabel('Description').nth(1).fill('Hosting');
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).nth(1).fill('1300');
    await expect(drawer.getByTestId('issue-totals')).toContainText('19,300.00');
    await expect(drawer.getByTestId('issue-totals')).toContainText('22,774.00');
    expect(api.last('POST', /^\/v1\/issued-documents\/preview$/)).toBeTruthy();
    await expect(drawer.getByText('An issued document cannot be edited; it is corrected by a credit note.')).toBeVisible();
  });

  await step('AC1 Issue the tax invoice: it takes number 1, its page shows the moment and what is still owed', async () => {
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-moment')).toContainText('Tax invoice 1 was issued');
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice 1');
    await expect(page.getByTestId('issued-outstanding')).toContainText('22,774.00');
    const issued = api.last('POST', /^\/v1\/issued-documents$/);
    expect(issued?.body).toMatchObject({ docType: 'TAX_INVOICE', currency: 'ILS', lines: [{ description: 'Flutter development, sprint 3', quantity: '40', unitPrice: '450.00' }, { description: 'Hosting', unitPrice: '1300.00' }] });
    expect(issued?.headers['idempotency-key']).toBeTruthy();
  });

  await step('AC2 Record a payment: a receipt for part of it lowers what is still owed', async () => {
    await page.getByTestId('issued-receipt').click();
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('10000');
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Receipt 1');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ docType: 'RECEIPT', appliesToDocumentId: expect.any(String), payment: { method: 'BANK' } });
    await page.getByRole('link', { name: 'Issued documents' }).click();
    await page.getByRole('link', { name: /Tax invoice 1/ }).click();
    await expect(page.getByTestId('issued-outstanding')).toContainText('12,774.00');
  });

  await step('AC3 A credit note from the part-paid tax invoice starts at what is still owed, VAT included', async () => {
    await page.getByTestId('issued-credit').click();
    await expect(drawer.getByLabel('Description')).toHaveValue('Credit for Tax invoice 1');
    await expect(drawer.getByRole('textbox', { name: 'Price', exact: true })).toHaveValue('12774.00');
    await expect(drawer.getByRole('checkbox', { name: 'Prices include VAT' })).toBeChecked();
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('1000');
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Credit note 1');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ docType: 'CREDIT_NOTE', originalId: expect.any(String) });
  });

  await step('The list shows all three, newest first; in Arabic it reads right to left', async () => {
    await page.getByRole('link', { name: 'Issued documents' }).click();
    await expect(page.locator('.hp-issued-table tbody tr')).toHaveCount(3);
    await api.open(page, `/p/${OFFICE_A}/documents/issued`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: /إشعار دائن 1/ })).toBeVisible();
  });
});

test('issuing waits for the setup; a client page issues for that client', { tag: '@portal.invoicing.issue-gate' }, async ({ page, step }) => {
  await step('AC1 (MUT-646) With the setup not done, the drawer says what is missing and links to it', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, invoicing: true });
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    await expect(page.getByTestId('issue-blocked')).toContainText('Business details · Numbering');
    await expect(page.getByRole('link', { name: 'Open the invoicing setup' })).toBeVisible();
  });

  await step('E2 A client page offers Issue a document for this client, the client already chosen', async () => {
    const api = ready();
    await api.open(page, `/p/${OFFICE_A}/clients/${C1}`);
    await page.getByTestId('issue-open').click();
    await expect(page.getByRole('dialog', { name: 'Issue a document' }).getByLabel('Client')).toHaveValue('Client 1');
  });

  await step('AC5 Without issuing (or on a personal profile) there is no Issued tab', async () => {
    const off = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1 });
    await off.open(page, `/p/${OFFICE_A}/documents`);
    await expect(page.getByRole('link', { name: 'Issued' })).toHaveCount(0);
  });
});

/** MUT-648: after saving income, the save toast offers its document, linked to the entry. */
test('saving an Owed offers its tax invoice, which takes the Owed over; the setting turns the offer off', { tag: '@portal.invoicing.offer-after-save' }, async ({ page, step }) => {
  const api = ready();
  const income = page.getByRole('dialog', { name: 'New income' });
  const issue = page.getByRole('dialog', { name: 'Issue a document' });
  const toast = page.getByTestId('toast-live');

  await step('Record an Owed of 1,180 from Client 1 on Owed', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await page.locator('[data-income-add]').click();
    await income.getByLabel('Amount').fill('1180');
    await income.getByLabel('Client').fill('Client 1');
    await income.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await income.getByRole('button', { name: 'Save income' }).click();
    await expect(income).toHaveCount(0);
  });

  await step('AC1 The save toast offers Issue a tax invoice; it opens prefilled and linked to the Owed', async () => {
    await expect(toast).toContainText('Saved');
    await toast.getByRole('button', { name: 'Issue a tax invoice' }).click();
    await expect(issue).toBeVisible();
    await expect(issue.getByLabel('Client')).toHaveValue('Client 1');
    await expect(issue.getByRole('textbox', { name: 'Price', exact: true })).toHaveValue('1180.00');
    await expect(issue.getByRole('checkbox', { name: 'Prices include VAT' })).toBeChecked();
    await expect(issue.getByTestId('issue-totals')).toContainText('1,180.00');
  });

  await step('AC1 Issue: the tax invoice names the Owed it takes over (no second Owed)', async () => {
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice 1');
    expect(api.calls('POST', /^\/v1\/income$/)).toHaveLength(1);
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ docType: 'TAX_INVOICE', fromEntry: { kind: 'owed', id: expect.any(String) }, pricesIncludeVat: true, lines: [{ unitPrice: '1180.00', pricesIncludeVat: true }] });
  });

  await step('E4 An Owed recorded earlier offers its tax invoice from its row', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await expect(page.locator('[data-testid^="issue-from-"]').first()).toBeVisible();
  });

  await step('AC2 With "offer to issue after saving" off, the toast offers nothing', async () => {
    const off = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, invoicing: 'ready', offerAfterSave: false });
    await off.open(page, `/p/${OFFICE_A}/receivables`);
    await page.locator('[data-income-add]').click();
    await income.getByLabel('Amount').fill('590');
    await income.getByLabel('Client').fill('Client 1');
    await income.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await income.getByRole('button', { name: 'Save income' }).click();
    await expect(toast).toContainText('Saved');
    await expect(toast.getByRole('button', { name: 'Issue a tax invoice' })).toHaveCount(0);
  });

  await step('AC3 A profile without invoicing sees no change', async () => {
    const plain = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1 });
    await plain.open(page, `/p/${OFFICE_A}/receivables`);
    await page.locator('[data-income-add]').click();
    await income.getByLabel('Amount').fill('590');
    await income.getByLabel('Client').fill('Client 1');
    await income.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await income.getByRole('button', { name: 'Save income' }).click();
    await expect(toast).toContainText('Saved');
    await expect(toast.getByRole('button')).toHaveCount(0);
    expect(plain.last('GET', /^\/v1\/issuing\/setup$/)).toBeFalsy();
  });
});
