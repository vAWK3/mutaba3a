import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, customer, office } from '../../support/portal';
import { FakeApi, payment, receivable, type DueSeed } from '../../support/portalApi';
import { openYou } from '../../support/you';

/**
 * MUT-646: the invoicing setup (round 3, variant 2): the letterhead is the map of the five steps, each saved on its
 * own; issuing waits for the business details and the numbering answer.
 */
const LOGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/invoicing/logo.png');
const EXTERNAL_PDF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/invoicing/external-invoice.pdf');
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

test('attach an invoice issued elsewhere to an Owed and, by dropping it on its row, to a Received (MUT-647)', { tag: '@portal.invoicing.attach-external' }, async ({ page, step }) => {
  const owed = receivable(1, { customerId: C1, gross: '1500.00' });
  const ours = receivable(2, { customerId: C1, gross: '800.00', origin: 'ISSUED_DOCUMENT' });
  const paid = payment(1, { customerId: C1, amount: '590.00', mine: true });
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, invoicing: 'ready', receivables: [owed, ours], payments: [paid] });
  const drawer = page.getByRole('dialog', { name: 'Attach an invoice issued elsewhere' });
  const attached = page.getByRole('dialog', { name: 'Invoice issued elsewhere' });

  await step('Open Owed on Nour Studio: an entry offers Attach in its Document column; one MTB3A issued offers nothing', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await expect(page.getByRole('columnheader', { name: 'Document' })).toBeVisible();
    await expect(page.getByTestId(`external-attach-${owed.id}`)).toBeVisible();
    await expect(page.getByTestId(`issue-from-${owed.id}`)).toBeVisible();
    await expect(page.getByTestId(`external-attach-${ours.id}`)).toHaveCount(0);
    await page.getByTestId(`external-attach-${owed.id}`).click();
    await expect(drawer.getByTestId('external-entry')).toContainText('Client 1');
  });

  await step('AC2 Choose the PDF: the reader fills the number, date and total; the person corrects the number', async () => {
    await page.getByTestId('external-file').setInputFiles(EXTERNAL_PDF);
    expect(api.last('POST', /^\/v1\/issuing\/external-invoices\/read$/)?.headers['content-type']).toBe('application/pdf');
    await expect(drawer.getByLabel('Invoice number')).toHaveValue('3381');
    await expect(drawer.getByLabel('Invoice date')).toHaveValue('2026-10-12');
    await expect(drawer.getByLabel('Total on the invoice')).toHaveValue('1500.00');
    await expect(drawer.getByTestId('external-amount-note')).toHaveText('The total matches this entry.');
    await expect(drawer).toContainText('It does not number this invoice or include it in the uniform file.');
    await drawer.getByLabel('Invoice number').fill('3382');
  });

  await step('A total that differs from the entry is said, never blocking', async () => {
    await drawer.getByLabel('Total on the invoice').fill('1450');
    await expect(drawer.getByTestId('external-amount-note')).toContainText('The total differs from this entry');
    await expect(page.getByTestId('external-attach')).toBeEnabled();
  });

  await step('AC1 Attach: the entry shows "Issued elsewhere"; it opens with its number and date, and its file opens', async () => {
    await page.getByTestId('external-attach').click();
    const post = api.last('POST', /^\/v1\/issuing\/external-invoices$/);
    expect(Object.fromEntries(post!.query)).toEqual({ entryKind: 'OWED', entryId: owed.id, number: '3382', documentDate: '2026-10-12', filename: 'external-invoice.pdf' });
    expect(post!.raw?.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(drawer).toHaveCount(0);
    const badge = page.getByTestId(`external-badge-${owed.id}`);
    await expect(badge).toHaveText('Issued elsewhere');
    await badge.click();
    await expect(attached.getByRole('heading', { name: 'Invoice 3382' })).toBeVisible();
    await expect(attached).toContainText('2026-10-12');
    const popup = page.context().waitForEvent('page');
    await attached.getByTestId('external-open').click();
    // The signed URL opens in a new tab (noopener: it starts at about:blank), and the bucket serves the file inline.
    await expect.poll(() => api.storage.some((r) => r.url.includes('/external/') && r.url.includes('disposition=inline'))).toBe(true);
    await (await popup).close();
  });

  await step('AC3 While it is attached, MTB3A issues no document for this entry: the drawer says so and the row no longer offers Issue a tax invoice', async () => {
    await expect(attached).toContainText('While this invoice is attached, MTB3A does not issue a document for this entry.');
    await attached.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByTestId(`issue-from-${owed.id}`)).toHaveCount(0);
  });

  await step('B Drop a PDF on a Received row on Paid: it is read and attached the same way', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    const row = page.locator(`tr[data-drop-row="${paid.id}"]`);
    await expect(row).toBeVisible();
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['%PDF-1.4 dropped'], 'dropped.pdf', { type: 'application/pdf' }));
      return data;
    });
    await row.dispatchEvent('dragover', { dataTransfer: transfer });
    await row.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(drawer.getByLabel('Invoice number')).toHaveValue('3381');
    await expect(drawer.getByTestId('external-amount-note')).toContainText('The total differs from this entry');
    await page.getByTestId('external-attach').click();
    expect(api.last('POST', /^\/v1\/issuing\/external-invoices$/)?.query.get('entryKind')).toBe('RECEIVED');
    await expect(page.getByTestId(`external-badge-${paid.id}`)).toBeVisible();
  });

  await step('Remove it: the Received offers Attach again; in Arabic the Owed reads "صادرة من جهة أخرى"', async () => {
    await page.getByTestId(`external-badge-${paid.id}`).click();
    await attached.getByTestId('external-remove').click();
    await expect(page.getByTestId(`external-attach-${paid.id}`)).toBeVisible();
    expect(api.last('DELETE', /^\/v1\/issuing\/external-invoices\//)).toBeTruthy();
    await api.open(page, `/p/${OFFICE_A}/receivables`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId(`external-badge-${owed.id}`)).toHaveText('صادرة من جهة أخرى');
    await expectNoHorizontalOverflow(page);
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

test('download the uniform file (מבנה אחיד) for this year: the zip, and how many documents and records it holds', { tag: '@portal.invoicing.uniform-file' }, async ({ page, step }) => {
  const api = ready();
  const card = page.getByRole('region', { name: 'Uniform file (מבנה אחיד)' });
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });

  await step('Issue a tax invoice for Client 1', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await expect(page.getByTestId('issued-empty')).toBeVisible();
    await page.getByTestId('issue-open').click();
    await expect(drawer).toBeVisible();
    await drawer.getByLabel('Client').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await drawer.getByLabel('Description').fill('Flutter development, sprint 3');
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('450');
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice 1');
  });

  await step('Open You › Invoicing: the uniform-file card offers last year by default', async () => {
    await api.open(page, setupPath);
    await expect(card).toBeVisible();
    await expect(card.getByRole('radio', { name: 'Last year' })).toBeChecked();
    await expect(card.getByLabel('From')).toBeDisabled();
  });

  await step('Choose Other dates and put To before From: it is refused in place and nothing downloads', async () => {
    await card.getByRole('radio', { name: 'Other dates' }).click();
    await card.getByLabel('From').fill('2026-12-01');
    await card.getByLabel('To').fill('2026-11-01');
    await expect(card.getByText('“To” comes before “From”.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Download the file' })).toBeDisabled();
    expect(api.last('GET', /^\/v1\/issuing\/uniform-file$/)).toBeFalsy();
  });

  await step('Choose This year and Download the file: the OPENFRMT zip downloads and the card counts the document', async () => {
    await card.getByRole('radio', { name: 'This year' }).click();
    const download = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download the file' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^OPENFRMT-516123452-2026-01-01_2026-\d{2}-\d{2}\.zip$/);
    const call = api.last('GET', /^\/v1\/issuing\/uniform-file$/);
    expect(call?.query.get('from')).toBe('2026-01-01');
    expect(call?.query.get('lang')).toBe('en');
    await expect(card.getByRole('status')).toContainText('Documents: 1 · Records: 4');
  });

  await step('In Arabic the card reads right to left with no sideways scroll', async () => {
    await api.open(page, setupPath, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'الملف الموحّد (מבנה אחיד)' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test('a range with no documents still downloads a valid file, and the card says there were none', { tag: '@portal.invoicing.uniform-file-empty' }, async ({ page, step }) => {
  const api = ready();
  const card = page.getByRole('region', { name: 'Uniform file (מבנה אחיד)' });

  await step('Open You › Invoicing on a profile with no documents and Download the file for last year', async () => {
    await api.open(page, setupPath);
    const download = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download the file' }).click();
    await download;
  });

  await step('The card says there are no documents in these dates, and that the file is still valid', async () => {
    await expect(card.getByRole('status')).toContainText('No documents in these dates.');
    await expect(card.getByRole('status')).toContainText('The file is still valid');
    expect(api.last('GET', /^\/v1\/issuing\/uniform-file$/)?.query.get('to')).toMatch(/-12-31$/);
// ---- MUT-660: documents due (To issue), Issue all, not for invoice, a client's documents preference ----

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const C2 = customer(1).id;
const dueSeed = (): DueSeed[] => [
  { kind: 'TAX_INVOICE', entry: { kind: 'owed', id: 'e0000000-0000-4000-8000-000000000001', number: 'CHG-2026-0001' }, customerId: C1, amount: '3400.00', date: daysAgo(20) },
  { kind: 'TAX_INVOICE_RECEIPT', entry: { kind: 'received', id: 'e0000000-0000-4000-8000-000000000002', number: 'PAY-2026-0002' }, customerId: C1, amount: '700.00', date: daysAgo(3) },
  { kind: 'PAYMENT_REQUEST', entry: { kind: 'owed', id: 'e0000000-0000-4000-8000-000000000003', number: 'CHG-2026-0003' }, customerId: C2, amount: '5000.00', date: daysAgo(30), issuable: false, reason: 'PAYMENT_REQUEST_PENDING', hasTaxDocument: true },
];
const dueWorld = (documentsDue: DueSeed[] = dueSeed()) => new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 2, invoicing: 'ready', documentsDue });
const toIssuePath = `/p/${OFFICE_A}/documents/to-issue`;

test('Home’s To issue opens the documents due by client; Issue all issues one client’s documents', { tag: '@portal.invoicing.to-issue-issue-all' }, async ({ page, step }) => {
  const api = dueWorld();

  await step('Open Nour Studio’s home', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const group = page.getByRole('region', { name: 'To issue' });
    await expect(group).toContainText('3 documents to issue');
  });

  await step('Choose See all in the To issue group', async () => {
    await page.getByRole('link', { name: 'See all documents to issue' }).click();
    await expect(page).toHaveURL(new RegExp(`${toIssuePath}$`));
    await expect(page.getByTestId(/^due-group-/).first()).toContainText('Client 1');
    const other = page.getByTestId(`due-group-${C2}`);
    await expect(other).toContainText("Payment requests can't be issued here yet");
    await expect(other.getByRole('button', { name: 'Attach' })).toBeVisible();
  });

  await step('In Client 1’s group choose Issue all, then confirm', async () => {
    await page.getByTestId(`due-issue-all-${C1}`).click();
    await expect(page.getByText('Issue 2 documents for Client 1? Issuing is final.')).toBeVisible();
    await page.getByRole('button', { name: 'Issue 2' }).click();
    await expect(page.getByText('2 documents issued for Client 1.')).toBeVisible();
    const post = api.last('POST', /^\/v1\/documents-due\/issue$/);
    expect(post?.body).toMatchObject({ customerId: C1, items: [{ kind: 'owed' }, { kind: 'received' }] });
    await expect(page.getByTestId(`due-group-${C1}`)).toHaveCount(0);
  });
});

test('Older than 6 months selects old items; mark them not for invoice in one action, then bring them back', { tag: '@portal.invoicing.to-issue-bulk-not-for-invoice' }, async ({ page, step }) => {
  const api = dueWorld([
    { kind: 'TAX_INVOICE_RECEIPT', entry: { kind: 'received', id: 'e0000000-0000-4000-8000-0000000000a1', number: 'PAY-2025-0040' }, customerId: null, amount: '180.00', date: daysAgo(400) },
    { kind: 'TAX_INVOICE_RECEIPT', entry: { kind: 'received', id: 'e0000000-0000-4000-8000-0000000000a2', number: 'PAY-2026-0011' }, customerId: null, amount: '300.00', date: daysAgo(220) },
    { kind: 'TAX_INVOICE_RECEIPT', entry: { kind: 'received', id: 'e0000000-0000-4000-8000-0000000000a3', number: 'PAY-2026-0090' }, customerId: C1, amount: '450.00', date: daysAgo(10) },
  ]);

  await step('Open Documents › To issue', async () => {
    await api.open(page, toIssuePath);
    await expect(page.getByTestId(/^due-row-/)).toHaveCount(3);
  });

  await step('Choose Older than 6 months, then Select all shown', async () => {
    await expect(page.getByTestId('due-older').locator('option')).toHaveText(['Any date', '1 month', '3 months', '6 months', '12 months']);
    await page.getByTestId('due-older').selectOption('6');
    await expect(page.getByTestId(/^due-row-/)).toHaveCount(2);
    await page.getByTestId('due-select-all').click();
    await expect(page.getByTestId('due-bulk')).toContainText('2 selected');
  });

  await step('Choose Not for invoice and confirm', async () => {
    await page.getByTestId('due-bulk-action').click();
    await expect(page.getByText('Mark 2 entries not for invoice?')).toBeVisible();
    await page.getByRole('button', { name: 'Mark 2' }).click();
    await expect(page.getByText('2 marked not for invoice')).toBeVisible();
    await expect(page.getByTestId('due-empty')).toBeVisible();
    expect(api.last('POST', /^\/v1\/documents-due\/not-for-invoice$/)?.body).toMatchObject({ value: true });
  });

  await step('Open Not for invoice, select all shown, choose Back to invoice and confirm', async () => {
    await page.getByTestId('due-view-not-for-invoice').click();
    await expect(page.getByTestId(/^due-row-/)).toHaveCount(2);
    await page.getByTestId('due-select-all').click();
    await page.getByTestId('due-bulk-action').click();
    await page.getByRole('button', { name: 'Bring back 2' }).click();
    await expect(page.getByText('2 back to invoice')).toBeVisible();
    expect(api.last('POST', /^\/v1\/documents-due\/not-for-invoice$/)?.body).toMatchObject({ value: false });
  });
});

test('An entry with a tax document can’t be marked not for invoice: a credit note comes first', { tag: '@portal.invoicing.not-for-invoice-refused' }, async ({ page, step }) => {
  const api = dueWorld();

  await step('Open Documents › To issue', async () => {
    await api.open(page, toIssuePath);
  });

  await step('Choose Not for invoice on an item whose entry has a tax invoice', async () => {
    await page.getByTestId('due-nfi-e0000000-0000-4000-8000-000000000003').click();
    await expect(page.getByText(/Issue a credit note first/)).toBeVisible();
    await expect(page.getByTestId('due-row-e0000000-0000-4000-8000-000000000003')).toBeVisible();
  });
});

test('Set a client’s documents preference on the client page', { tag: '@portal.invoicing.client-documents-preference' }, async ({ page, step }) => {
  const api = dueWorld([]);

  await step('Open Client 1’s page on Nour Studio', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients/${C1}`);
    const field = page.getByTestId('client-documents-preference');
    await expect(field.getByLabel('Documents')).toHaveValue('DEFAULT');
    await expect(field).toContainText('a tax invoice-receipt for each payment, partial ones included.');
  });

  await step('Set Documents to Tax invoice first', async () => {
    await page.getByTestId('client-documents-preference').getByLabel('Documents').selectOption('TAX_INVOICE_FIRST');
    await expect(page.getByTestId('client-documents-preference')).toContainText('a tax invoice when an amount is owed, then a receipt for each payment.');
    const patch = api.last('PATCH', new RegExp(`^/v1/customers/${C1}$`));
    expect(patch?.body).toEqual({ documentsPreference: 'TAX_INVOICE_FIRST' });
    expect(patch?.headers['if-match']).toBeTruthy();
  });
});
