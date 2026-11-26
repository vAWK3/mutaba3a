import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, customer, office } from '../../support/portal';
import { FakeApi, customerSummary, payment, receivable, type DueSeed } from '../../support/portalApi';
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
    // MUT-661: these flows are about the offer, so Client 1's preference is already answered.
    clientPreference: 'TAX_INVOICE_FIRST',
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

test('a payment request: issued as PR-0001, settled by two invoice-receipts, and another cancelled (MUT-662)', { tag: '@portal.invoicing.payment-request' }, async ({ page, step }) => {
  const api = ready();
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });

  await step('Choose Issue a document, Client 1 and the Payment request type: it says it is not a tax document', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    await drawer.getByLabel('Client').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await drawer.getByRole('radio', { name: 'Payment request' }).click();
    await expect(drawer.getByTestId('issue-payment-request-note')).toContainText('Not a tax document');
    await drawer.getByLabel('Description').fill('Website, phase 2');
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('1000');
    await expect(drawer.getByTestId('issue-totals')).toContainText('1,180.00');
  });

  await step('AC1 Issue it: PR-0001, Unpaid, with a due date and no allocation number', async () => {
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Payment request PR-0001');
    await expect(page.getByTestId('issued-status')).toHaveText('Unpaid');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ docType: 'PAYMENT_REQUEST', customerId: expect.any(String) });
  });

  await step('AC2 Record a payment of 400: an invoice-receipt that refers to the request; it reads Partly paid', async () => {
    await page.getByTestId('payment-request-pay').click();
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('400');
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice-receipt 1');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ docType: 'TAX_INVOICE_RECEIPT', appliesToDocumentId: expect.any(String), payment: { method: 'BANK' } });
    await page.getByRole('link', { name: 'Issued documents' }).click();
    await page.getByRole('link', { name: /Payment request PR-0001/ }).click();
    await expect(page.getByTestId('issued-status')).toHaveText('Partly paid');
    await expect(page.getByTestId('payment-request-block')).toContainText('Tax invoice-receipt 1');
  });

  await step('AC3 While an invoice-receipt refers to it, it cannot be cancelled', async () => {
    await page.getByTestId('payment-request-cancel').click();
    await expect(page.getByTestId('payment-request-cancel-blocked')).toContainText('credit note first');
  });

  await step('AC4 The second payment covers the rest: Paid in full', async () => {
    await page.getByTestId('payment-request-pay').click();
    await page.getByTestId('issue-submit').click();
    await page.getByRole('link', { name: 'Issued documents' }).click();
    await page.getByRole('link', { name: /Payment request PR-0001/ }).click();
    await expect(page.getByTestId('issued-status')).toHaveText('Paid in full');
    await expect(page.getByTestId('payment-request-pay')).toHaveCount(0);
  });

  await step('AC5 Another request, cancelled with a reason: Cancelled, CX-0001, and the list says so', async () => {
    await page.getByRole('link', { name: 'Issued documents' }).click();
    await page.getByTestId('issue-open').click();
    await drawer.getByLabel('Client').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await drawer.getByRole('radio', { name: 'Payment request' }).click();
    await drawer.getByLabel('Description').fill('Sent twice');
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('500');
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Payment request PR-0002');
    await page.getByTestId('payment-request-cancel').click();
    await page.getByLabel('Reason (optional)').fill('sent twice');
    await page.getByTestId('payment-request-cancel-confirm').click();
    await expect(page.getByTestId('issued-status')).toHaveText('Cancelled');
    await expect(page.getByTestId('payment-request-cancelled')).toContainText('CX-0001');
    expect(api.last('POST', /\/cancel$/)?.body).toMatchObject({ reason: 'sent twice' });
    await page.getByRole('link', { name: 'Issued documents' }).click();
    await expect(page.locator('.hp-issued-table tbody tr').first()).toContainText('Cancelled');
  });

  await step('In Arabic the request reads right to left with its PR number', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: /طلب دفع PR-0001/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
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
    // MUT-664: what was issued to the client is on its Documents tab
    await api.open(page, `/p/${OFFICE_A}/clients/${C1}?tab=documents`);
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

  await step('Follow-up: leave Owed for Paid inside the toast window; its Issue still opens the drawer there', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await page.locator('[data-income-add]').click();
    await income.getByLabel('Amount').fill('2360');
    await income.getByLabel('Client').fill('Client 1');
    await income.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await income.getByRole('button', { name: 'Save income' }).click();
    await expect(toast).toContainText('Saved');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Paid' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Paid' })).toBeVisible();
    await toast.getByRole('button', { name: 'Issue a tax invoice' }).click();
    await expect(issue).toBeVisible();
    await expect(issue.getByRole('textbox', { name: 'Price', exact: true })).toHaveValue('2360.00');
    await issue.getByRole('button', { name: 'Close' }).first().click();
    await expect(issue).toHaveCount(0);
  });

  await step('E4 An Owed recorded earlier offers its tax invoice from its row', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await expect(page.locator('[data-testid^="issue-from-"]').first()).toBeVisible();
  });

  await step('AC2 With "offer to issue after saving" off, the toast offers nothing', async () => {
    const off = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, clientPreference: 'TAX_INVOICE_FIRST', invoicing: 'ready', offerAfterSave: false });
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

  await step('The card says there are no documents in these dates', async () => {
    await expect(card.getByRole('status')).toContainText('No documents in these dates.');
    expect(api.last('GET', /^\/v1\/issuing\/uniform-file$/)?.query.get('to')).toMatch(/-12-31$/);
  });
});

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
    await expect(other).toContainText('Attach an invoice issued elsewhere');
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
    // MUT-664: the preference is on the client's Details tab
    await api.open(page, `/p/${OFFICE_A}/clients/${C1}?tab=details`);
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

// ---------------------------------------------------------------- MUT-643: crediting what was already paid

/** Issues a document of 1,000 before VAT to Client 1 from Documents › Issued; lands on its page. */
async function issueThousand(page: import('@playwright/test').Page, api: FakeApi, docType: 'Tax invoice' | 'Tax invoice-receipt') {
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });
  await api.open(page, `/p/${OFFICE_A}/documents/issued`);
  await page.getByTestId('issue-open').click();
  await drawer.getByLabel('Client').fill('Client 1');
  await page.getByRole('option', { name: /Client 1/ }).click();
  await drawer.getByRole('radio', { name: docType, exact: true }).click();
  await drawer.getByLabel('Description').fill('Website build');
  await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('1000');
  await expect(drawer.getByTestId('issue-totals')).toContainText('1,180.00');
  await page.getByTestId('issue-submit').click();
  await expect(page.getByTestId('issued-doc-title')).toContainText(`${docType} 1`);
}

test('a paid invoice-receipt credited in full is refunded; the client ledger shows the refund and ends at 0 (MUT-643)', { tag: '@portal.invoicing.credit-note-paid-refund' }, async ({ page, step }) => {
  // The client page reads Client 1's summary before its ledger card.
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 1,
    invoicing: 'ready',
    customerSummaries: [customerSummary(C1, { currency: 'ILS', outstanding: '0.00', overdue: '0.00', lastPaymentOn: null, status: 'UP_TO_DATE', matters: [] })],
  });
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });
  const paidPart = drawer.getByTestId('issue-paid-part');

  await step('Issue an invoice-receipt of 1,000 to Client 1', async () => {
    await issueThousand(page, api, 'Tax invoice-receipt');
  });

  await step('AC1 Credit note from it: the drawer says the client already paid 1,180.00; Issue waits for a choice', async () => {
    await page.getByTestId('issued-credit').click();
    await expect(paidPart.getByRole('heading', { name: /The client already paid .*1,180\.00.* of this/ })).toBeVisible();
    await expect(page.getByTestId('issue-submit')).toBeDisabled();
  });

  await step('AC1 Refunded to the client by bank transfer, reference RF-7: the credit note is issued with the refund', async () => {
    await paidPart.getByRole('radio', { name: 'Refunded to the client' }).click();
    await paidPart.getByLabel('Reference').fill('RF-7');
    await expect(page.getByTestId('issue-submit')).toBeEnabled();
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Credit note 1');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ docType: 'CREDIT_NOTE', originalId: expect.any(String), paidPart: { mode: 'REFUND', method: 'BANK', reference: 'RF-7' } });
  });

  await step('AC1 Client 1\'s ledger: charge, credit, payment, then the refund; it ends at 0.00', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients/${C1}`);
    const card = page.getByTestId('ledger-card');
    await expect(card.getByTestId('ledger-line').filter({ hasText: 'Refund' })).toContainText('1,180.00');
    await expect(card.getByTestId('ledger-closing')).toContainText('0.00');
  });

  await step('In Arabic the ledger reads right to left and names the refund', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients/${C1}`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('ledger-card').getByTestId('ledger-line').filter({ hasText: 'مبلغ مُعاد' })).toBeVisible();
  });
});

test('a paid tax invoice credited in part keeps the paid part as the client\'s credit (MUT-643)', { tag: '@portal.invoicing.credit-note-paid-keep' }, async ({ page, step }) => {
  const api = ready();
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });
  const paidPart = drawer.getByTestId('issue-paid-part');

  await step('Issue a tax invoice of 1,000 and a receipt that pays all of it', async () => {
    await issueThousand(page, api, 'Tax invoice');
    await page.getByTestId('issued-receipt').click();
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Receipt 1');
    await page.getByRole('link', { name: 'Issued documents' }).click();
    await page.getByRole('link', { name: /Tax invoice 1/ }).click();
  });

  await step('AC3 Credit note for 400 before VAT: the client already paid 472.00 of it', async () => {
    await page.getByTestId('issued-credit').click();
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('400');
    await expect(paidPart.getByRole('heading', { name: /472\.00/ })).toBeVisible();
  });

  await step('AC3 Kept as their credit: issued with KEEP and no refund', async () => {
    await paidPart.getByRole('radio', { name: 'Kept as their credit' }).click();
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Credit note 1');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ docType: 'CREDIT_NOTE', paidPart: { mode: 'KEEP' } });
  });
});

test('credit notes on one document never add up to more than it; the refusal says what is left (MUT-643)', { tag: '@portal.invoicing.credit-note-cap' }, async ({ page, step }) => {
  const api = ready();
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });
  const paidPart = drawer.getByTestId('issue-paid-part');

  await step('Issue an invoice-receipt of 1,000 and credit 600 of it, refunded', async () => {
    await issueThousand(page, api, 'Tax invoice-receipt');
    await page.getByTestId('issued-credit').click();
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('600');
    await paidPart.getByRole('radio', { name: 'Refunded to the client' }).click();
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Credit note 1');
  });

  await step('AC2 Another credit note starts at what is left: 472.00, VAT included', async () => {
    await page.getByRole('link', { name: 'Issued documents' }).click();
    await page.getByRole('link', { name: /Tax invoice-receipt 1/ }).click();
    await page.getByTestId('issued-credit').click();
    await expect(drawer.getByRole('textbox', { name: 'Price', exact: true })).toHaveValue('472.00');
  });

  await step('AC2 Raised to 1,000 and refunded, it is refused: at most 472.00 is left; nothing is issued', async () => {
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('1000');
    await paidPart.getByRole('radio', { name: 'Refunded to the client' }).click();
    await page.getByTestId('issue-submit').click();
    await expect(drawer.getByRole('alert')).toContainText('At most 472.00 is left to credit');
    await expect(drawer).toBeVisible();
  });
});

test('a number requested by hand is entered before issuing; the invoice number is a preview, never held (MUT-711)', { tag: '@portal.invoicing.manual-allocation' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, invoicing: 'ready', manualAllocation: true });
  const drawer = page.getByRole('dialog', { name: 'Issue a document' });
  const panel = drawer.getByTestId('issue-allocation');
  const input = drawer.getByLabel('Allocation number (9 digits)');

  await step('AC1 A tax invoice of 6,000 to Client 1: the panel lists what the Tax Authority asks for; Issue waits', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.getByTestId('issue-open').click();
    await drawer.getByLabel('Client').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await drawer.getByLabel('Description').fill('Annual retainer');
    await drawer.getByRole('textbox', { name: 'Price', exact: true }).fill('6000');
    await expect(panel.getByRole('heading', { name: 'This invoice needs an allocation number' })).toBeVisible();
    await expect(panel.getByTestId('issue-allocation-number')).toContainText('1');
    await expect(panel.getByTestId('issue-allocation-net')).toContainText('6,000.00');
    await expect(panel.getByTestId('issue-allocation-taxId')).toContainText('516123452');
    await expect(panel.getByRole('button', { name: 'Copy Invoice number' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Copy all' })).toBeVisible();
    await expect(panel.getByTestId('issue-allocation-link')).toHaveAttribute('href', /gov\.il/);
    await expect(panel.getByRole('button', { name: 'change the amount' })).toBeVisible();
    await expect(page.getByTestId('issue-submit')).toBeDisabled();
  });

  await step('AC2 A malformed number keeps Issue disabled; nine digits (with dashes) enable it', async () => {
    await input.fill('12345');
    await expect(panel.getByText('An allocation number is 9 digits.')).toBeVisible();
    await expect(page.getByTestId('issue-submit')).toBeDisabled();
    await input.fill('123-456-789');
    await expect(page.getByTestId('issue-submit')).toBeEnabled();
  });

  await step('AC3 Another document takes number 1 first: the issue is refused, the number cleared, the panel now shows 2', async () => {
    expect(api.issueElsewhere(OFFICE_A)).toBe(1);
    await page.getByTestId('issue-submit').click();
    await expect(drawer.getByRole('alert')).toContainText("This invoice's number is now 2");
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ manualAllocation: { number: '123456789', forNumber: 1 } });
    await expect(input).toHaveValue('');
    await expect(panel.getByTestId('issue-allocation-number')).toContainText('2');
    await expect(page.getByTestId('issue-submit')).toBeDisabled();
  });

  await step('AC4 The number requested for invoice 2 issues it; its page shows the allocation number', async () => {
    await input.fill('987654321');
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice 2');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ manualAllocation: { number: '987654321', forNumber: 2 } });
    await expect(page.getByText('987654321')).toBeVisible();
  });

  await step('AC5 In Arabic the panel reads right to left in formal Arabic', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`, 'ar');
    await page.getByTestId('issue-open').click();
    const ar = page.getByRole('dialog', { name: 'إصدار مستند' });
    await ar.getByLabel('العميل').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await ar.getByLabel('الوصف').fill('Annual retainer');
    await ar.getByRole('textbox', { name: 'السعر', exact: true }).fill('6000');
    await expect(ar.getByTestId('issue-allocation').getByRole('heading', { name: 'تحتاج هذه الفاتورة إلى رقم تخصيص' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page);
  });
});

/** MUT-722: a save on a profile where invoicing is available but the setup can't issue yet (details in, numbering not). */
test('saving a shekel income while the setup is incomplete says Finish setting up invoicing, once a day; Receivables says Finish setup to issue', { tag: '@portal.invoicing.setup-hint' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, clientPreference: 'TAX_INVOICE_FIRST', invoicing: 'details' });
  const income = page.getByRole('dialog', { name: 'New income' });
  const toast = page.getByTestId('toast-live');
  const hintLine = 'Finish setting up invoicing to issue its invoice.';
  const recordOwed = async (amount: string, currency?: string) => {
    await page.locator('[data-income-add]').click();
    await income.getByLabel('Amount').fill(amount);
    if (currency) {
      await income.locator('button.form-disclosure').click();
      await income.getByLabel('Currency').selectOption(currency);
    }
    await income.getByLabel('Client').fill('Client 1');
    await income.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await income.getByRole('button', { name: 'Save income' }).click();
    await expect(income).toHaveCount(0);
    await expect(toast).toContainText('Saved');
  };

  await step('On Owed, record ₪590 owed by Client 1', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await page.evaluate(() => localStorage.clear());
    await recordOwed('590');
  });

  await step('AC3 The save toast says Finish setting up invoicing to issue its invoice, with Set up', async () => {
    await expect(toast).toContainText(hintLine);
    await expect(toast.getByRole('button', { name: 'Set up' })).toBeVisible();
    await expect(toast.getByRole('button', { name: /^Issue/ })).toHaveCount(0);
  });

  await step('AC3 Receivables shows Finish setup to issue where Issue would be', async () => {
    await expect(page.locator('[data-testid^="finish-setup-"]').first()).toHaveText('Finish setup to issue');
    await expect(page.locator('[data-testid^="issue-from-"]')).toHaveCount(0);
  });

  await step('AC1 Set up opens the invoicing setup at the first missing step: Numbering', async () => {
    await toast.getByRole('button', { name: 'Set up' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/you/invoicing\\?step=numbering`));
    await expect(page.getByRole('heading', { level: 2, name: 'Numbering' })).toBeVisible();
  });

  await step('AC2 Back on Owed, a second save the same day shows no hint', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await recordOwed('236');
    await expect(toast).not.toContainText(hintLine);
    await expect(toast.getByRole('button', { name: 'Set up' })).toHaveCount(0);
  });

  await step('AC3 Finish setup to issue opens the setup at Numbering; answer it (start from 1)', async () => {
    await page.locator('[data-testid^="finish-setup-"]').first().click();
    await expect(page.getByRole('heading', { level: 2, name: 'Numbering' })).toBeVisible();
    await page.getByRole('radio', { name: 'No, start from 1' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('setup-ready')).toBeVisible();
  });

  await step('AC2 With the setup complete, the next save gets the normal Issue offer (MUT-648)', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await recordOwed('1180');
    await expect(toast.getByRole('button', { name: 'Issue a tax invoice' })).toBeVisible();
    await expect(toast).not.toContainText(hintLine);
  });

  await step('AC4 A dollar income on an incomplete setup shows no hint', async () => {
    const usd = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, clientPreference: 'TAX_INVOICE_FIRST', invoicing: 'details' });
    await usd.open(page, `/p/${OFFICE_A}/receivables`);
    await page.evaluate(() => localStorage.clear());
    await recordOwed('100', 'USD');
    await expect(toast).not.toContainText(hintLine);
    await expect(toast.getByRole('button')).toHaveCount(0);
  });

  await step('AC4 No hint on a personal profile, a Malafat firm, or without the invoicing feature', async () => {
    const personal = new FakeApi({ profiles: [{ id: OFFICE_A, name: 'Personal', type: 'PERSONAL', owned: true, writerOfRecord: null }], clients: 1, invoicing: true });
    await personal.open(page, `/p/${OFFICE_A}/receivables`);
    await page.evaluate(() => localStorage.clear());
    await recordOwed('590');
    await expect(toast.getByRole('button')).toHaveCount(0);
    expect(personal.last('GET', /^\/v1\/issuing\/setup$/)).toBeFalsy();

    const firm = new FakeApi({ profiles: [{ id: OFFICE_A, name: 'Haddad & Partners', type: 'BUSINESS', owned: true, writerOfRecord: 'MALAFAT' }], clients: 1, invoicing: true });
    await firm.open(page, `/p/${OFFICE_A}/receivables`);
    await page.evaluate(() => localStorage.clear());
    await recordOwed('590');
    await expect(toast).not.toContainText(hintLine);
    await expect(page.locator('[data-testid^="finish-setup-"]')).toHaveCount(0);

    const plain = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1 });
    await plain.open(page, `/p/${OFFICE_A}/receivables`);
    await page.evaluate(() => localStorage.clear());
    await recordOwed('590');
    await expect(toast.getByRole('button')).toHaveCount(0);
    await expect(page.locator('[data-testid^="finish-setup-"]')).toHaveCount(0);
  });

  await step('In Arabic the toast reads أكمِل إعداد الفوترة لإصدار فاتورته with إعداد, right to left', async () => {
    const ar = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, clientPreference: 'TAX_INVOICE_FIRST', invoicing: 'details' });
    await ar.open(page, `/p/${OFFICE_A}/receivables`, 'ar');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('[data-income-add]').click();
    const arIncome = page.getByRole('dialog', { name: 'دخل جديد' });
    await arIncome.locator('#hosted-income-amount').fill('590');
    await arIncome.getByRole('combobox').first().fill('Client 1');
    await arIncome.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await arIncome.getByRole('button', { name: 'حفظ الدخل' }).click();
    await expect(toast).toContainText('أكمِل إعداد الفوترة لإصدار فاتورته.');
    await expect(toast.getByRole('button', { name: 'إعداد' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

/** MUT-661: the first income for a client asks how documents are issued, once; a payment issues its document in the same step. */
test('the first Owed for a client asks how documents are issued, once; a payment issues its document with it', { tag: '@portal.invoicing.issue-as-you-record' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, invoicing: 'ready' });
  const income = page.getByRole('dialog', { name: 'New income' });
  const ask = page.getByRole('dialog', { name: /How do you issue documents to .*Client 1/ });
  const toast = page.getByTestId('toast-live');
  const recordOwed = async (amount: string) => {
    await page.locator('[data-income-add]').click();
    await income.getByLabel('Amount').fill(amount);
    await income.getByLabel('Client').fill('Client 1');
    await income.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await income.getByRole('button', { name: 'Save income' }).click();
    await expect(income).toHaveCount(0);
  };

  await step('On Owed, record ₪3,400 owed by Client 1', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await recordOwed('3400');
  });

  await step('AC1 The save asks how documents are issued to Client 1, with the four choices', async () => {
    await expect(ask).toBeVisible();
    for (const choice of ['Tax invoice first', 'Payment request first', 'On payment', 'No document']) await expect(ask.getByRole('button', { name: new RegExp(`^${choice}`) })).toBeVisible();
  });

  await step('AC2 Choose Tax invoice first: the toast offers Issue a tax invoice', async () => {
    await ask.getByRole('button', { name: /^Tax invoice first/ }).click();
    await expect(ask).toHaveCount(0);
    await expect(toast.getByRole('button', { name: 'Issue a tax invoice' })).toBeVisible();
  });

  await step('AC1 A second Owed for Client 1 asks nothing', async () => {
    await recordOwed('500');
    await expect(toast).toContainText('Saved');
    await expect(page.getByRole('dialog', { name: /How do you issue documents/ })).toHaveCount(0);
  });

  await step('Record a payment of ₪1,000 on an Owed of an On payment client, with its document control on', async () => {
    const pay = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, clientPreference: 'ON_PAYMENT', invoicing: 'ready', receivables: [receivable(1, { customerId: customer(0).id, gross: '3400.00', dueDate: '2026-10-30' })] });
    await pay.open(page, `/p/${OFFICE_A}/receivables`);
    await page.getByRole('button', { name: /^Record payment for Client 1/ }).click();
    const drawer = page.getByRole('dialog', { name: /Record payment/ });
    await drawer.getByLabel('Amount (ILS)').fill('1000');
    await expect(drawer.getByTestId('settle-issue')).toBeChecked();
    await drawer.getByRole('button', { name: 'Record payment' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('AC4 The toast says the payment is recorded and its document is issued', async () => {
    await expect(toast).toContainText('Document 1 issued');
  });

  await step('AC5 With the control off, only the payment is recorded', async () => {
    await page.getByRole('button', { name: /^Record payment for Client 1/ }).click();
    const drawer = page.getByRole('dialog', { name: /Record payment/ });
    await drawer.getByLabel('Amount (ILS)').fill('400');
    await drawer.getByTestId('settle-issue').uncheck();
    await drawer.getByRole('button', { name: 'Record payment' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(toast).not.toContainText('issued');
  });
});

/** MUT-736 (ADR-282): the Tax Authority connection is on Solo and above; Starter types allocation numbers by hand. */
const issueSixThousand = async (page: import('@playwright/test').Page, language: 'en' | 'ar' = 'en') => {
  const drawer = page.getByRole('dialog', { name: language === 'ar' ? 'إصدار مستند' : 'Issue a document' });
  await page.getByTestId('issue-open').click();
  await drawer.getByLabel(language === 'ar' ? 'العميل' : 'Client').fill('Client 1');
  await page.getByRole('option', { name: /Client 1/ }).click();
  await drawer.getByLabel(language === 'ar' ? 'الوصف' : 'Description').fill('Annual retainer');
  await drawer.getByRole('textbox', { name: language === 'ar' ? 'السعر' : 'Price', exact: true }).fill('6000');
  return drawer;
};

test('on Starter a 6,000 invoice is issued with a number typed by hand (MUT-736)', { tag: '@portal.invoicing.starter-manual-allocation' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, invoicing: 'ready', taxAuthority: { plan: 'starter', connected: true } });
  let drawer = page.getByRole('dialog', { name: 'Issue a document' });

  await step('As a Starter person on Nour Studio, open Issue a document, choose Client 1 and a line of 6,000', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    drawer = await issueSixThousand(page);
  });

  await step('AC10 The panel asks for the number (even while a connection is kept); Issue waits', async () => {
    const panel = drawer.getByTestId('issue-allocation');
    await expect(panel.getByRole('heading', { name: 'This invoice needs an allocation number' })).toBeVisible();
    await expect(page.getByTestId('issue-submit')).toBeDisabled();
  });

  await step('AC10 Type 123-456-789 and Issue: tax invoice 1 carries the number typed, stored as an automatic one would be', async () => {
    await drawer.getByLabel('Allocation number (9 digits)').fill('123-456-789');
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice 1');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).toMatchObject({ manualAllocation: { number: '123456789', forNumber: 1 } });
    await expect(page.getByText('123456789')).toBeVisible();
  });

  await step('AC12 In Arabic the panel asks for the number, right to left', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`, 'ar');
    const ar = await issueSixThousand(page, 'ar');
    await expect(ar.getByTestId('issue-allocation').getByRole('heading', { name: 'تحتاج هذه الفاتورة إلى رقم تخصيص' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page);
  });
});

test('on Starter the Tax Authority step offers the upgrade; a kept connection is paused, never deleted (MUT-736)', { tag: '@portal.invoicing.starter-connect-refused' }, async ({ page, step }) => {
  const region5 = () => page.getByTestId('letterhead').getByRole('button', { name: /^(Step 5:|الخطوة 5)/ });
  const taStep = page.getByTestId('tax-authority-step');

  await step('As a Starter person, open Invoicing on Nour Studio and choose step 5, the Tax Authority', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], invoicing: 'ready', taxAuthority: { plan: 'starter' } });
    await api.open(page, setupPath);
    await region5().click();
  });

  await step('AC9 It offers Upgrade to Solo and no Connect', async () => {
    await expect(taStep.getByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
    await expect(taStep.getByTestId('tax-authority-connect')).toHaveCount(0);
  });

  await step('AC9 Upgrade to Solo opens Billing', async () => {
    await taStep.getByRole('button', { name: 'Upgrade to Solo' }).click();
    await expect(page.getByRole('dialog', { name: 'Billing' })).toBeVisible();
  });

  const kept = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], invoicing: 'ready', taxAuthority: { plan: 'starter', connected: true } });
  await step('AC11 A connection made on a paid plan is kept (suspended): Upgrade to Solo and Disconnect', async () => {
    await kept.open(page, setupPath);
    await region5().click();
    await expect(taStep).toHaveAttribute('data-state', 'suspended');
    await expect(taStep.getByRole('button', { name: 'Upgrade to Solo' })).toBeVisible();
    await expect(taStep.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  });

  await step('Disconnect still works: DELETE is sent and the step reads as not connected', async () => {
    await taStep.getByRole('button', { name: 'Disconnect' }).click();
    await expect.poll(() => kept.last('DELETE', /^\/v1\/issuing\/tax-authority$/)).toBeTruthy();
    await expect(taStep).toHaveAttribute('data-state', 'none');
    await expect(taStep.getByRole('button', { name: 'Disconnect' })).toHaveCount(0);
  });

  await step('AC12 In Arabic the button names «مستقل»', async () => {
    await kept.open(page, setupPath, 'ar');
    await region5().click();
    await expect(taStep.getByRole('button', { name: 'الترقية إلى «مستقل»' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page);
  });
});

test('on Solo the profile connects and a 6,000 invoice gets its allocation number by itself (MUT-736)', { tag: '@portal.invoicing.solo-automatic-allocation' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, invoicing: 'ready', taxAuthority: { plan: 'solo' } });
  const taStep = page.getByTestId('tax-authority-step');
  const region5 = () => page.getByTestId('letterhead').getByRole('button', { name: /^Step 5:/ });

  await step('As a Solo person, open Invoicing on Nour Studio and choose step 5: it offers Connect, no upgrade', async () => {
    await api.open(page, setupPath);
    await region5().click();
    await expect(taStep.getByTestId('tax-authority-connect')).toBeVisible();
    await expect(taStep.getByTestId('tax-authority-upgrade')).toHaveCount(0);
  });

  await step('AC9 Connect to the Tax Authority and approve: back on the step it says connected, and region 5 is ticked', async () => {
    await taStep.getByTestId('tax-authority-connect').click();
    await expect(page).toHaveURL(/taxAuthority=connected/);
    await expect(page.getByTestId('tax-authority-connected')).toContainText('Connected to the Tax Authority until');
    await expect(region5()).toHaveAttribute('data-done', 'true');
  });

  await step('A 6,000 tax invoice to Client 1: no panel asks for a number; it is issued with the number the Tax Authority gave', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    const drawer = await issueSixThousand(page);
    await expect(drawer.getByLabel('Description')).toHaveValue('Annual retainer');
    await expect(drawer.getByTestId('issue-allocation')).toHaveCount(0);
    await page.getByTestId('issue-submit').click();
    await expect(page.getByTestId('issued-doc-title')).toContainText('Tax invoice 1');
    expect(api.last('POST', /^\/v1\/issued-documents$/)?.body).not.toHaveProperty('manualAllocation');
    await expect(page.getByText('100000001')).toBeVisible();
  });
});
