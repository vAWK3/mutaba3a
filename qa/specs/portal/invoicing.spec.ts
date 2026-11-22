import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou } from '../../support/you';

/**
 * MUT-646: the invoicing setup (round 3, variant 2): the letterhead is the map of the five steps, each saved on its
 * own; issuing waits for the business details and the numbering answer.
 */
const LOGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/invoicing/logo.png');
const setupPath = `/p/${OFFICE_A}/you/invoicing`;
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
