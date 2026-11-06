import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { ClientBooksApi, LINK_TOKEN, PIN } from '../../support/clientBooksApi';

/**
 * MUT-562 (layout B): a share link's page over MUT-560's visitor routes in an in-memory API. Nothing names the profile
 * or its owner before the right PIN; then the owner and profile, the band per currency, a filter and the entries with
 * receipts. Downloads wait for MUT-314.
 */

const PHONE = { width: 375, height: 812 };

async function openLink(page: Page, api: ClientBooksApi, language: 'en' | 'ar' = 'en') {
  await page.goto('about:blank');
  await api.open(page, `/share#${LINK_TOKEN}`, language);
}

async function typePin(page: Page, pin: string) {
  const group = page.getByRole('group', { name: /Enter the PIN you were given|أدخل الرمز الذي وصلك/ });
  await group.getByRole('textbox').first().click();
  await page.keyboard.type(pin);
}

const visitor = (options: ConstructorParameters<typeof ClientBooksApi>[0] = {}) => new ClientBooksApi({ signedIn: false, clients: [], ...options });

test('The PIN step names nothing, and every refusal says what happened', { tag: '@portal.share-link.pin' }, async ({ page, step }) => {
  const api = visitor();

  await step('Open the link', async () => {
    await openLink(page, api);
    await expect(page.getByRole('heading', { name: 'Enter the PIN you were given' })).toBeVisible();
    await expect(page).toHaveURL(/\/share$/);
    await expect(page.locator('body')).not.toContainText(/Rana|Studio/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  });

  await step('Enter a wrong PIN', async () => {
    await typePin(page, '1111');
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('alert')).toHaveText("That PIN isn't right. 4 tries left, then the link locks.");
  });

  await step('Open a locked link', async () => {
    await openLink(page, visitor({ checkLocked: true }));
    await expect(page.getByRole('heading', { name: 'This link is locked' })).toBeVisible();
  });

  await step('Open a link that ended', async () => {
    await openLink(page, visitor({ unlock: 'gone' }));
    await typePin(page, PIN);
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible();
  });

  await step('Open a link on a fourth device', async () => {
    await openLink(page, visitor({ unlock: 'limit' }));
    await typePin(page, PIN);
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: 'This link has reached its viewer limit' })).toBeVisible();
  });

  await step('Come back after 8 hours: the PIN again', async () => {
    await openLink(page, visitor({ expireView: true }));
    await typePin(page, PIN);
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: 'Enter the PIN again' })).toBeVisible();
    await expect(page.getByText('For safety, the PIN is asked for every 8 hours.')).toBeVisible();
  });

  await step('Paste a PIN in Arabic-Indic digits', async () => {
    const pasted = visitor();
    await openLink(page, pasted);
    const first = page.getByRole('group', { name: 'Enter the PIN you were given' }).getByRole('textbox').first();
    await first.focus();
    await first.evaluate((box) => {
      const data = new DataTransfer();
      data.setData('text', '٤٨٢١');
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('group', { name: 'Enter the PIN you were given' }).getByRole('textbox')).toHaveCount(5);
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad · Studio' })).toBeVisible();
    expect(pasted.calls('POST', '/v1/share-links/unlock')[0]!.body).toMatchObject({ pin: PIN });
  });

  await step('Type the PIN in Arabic-Indic digits, in Arabic at 375 px', async () => {
    await page.setViewportSize(PHONE);
    const arabic = visitor();
    await openLink(page, arabic, 'ar');
    await typePin(page, '٤٨٢١');
    await page.getByRole('button', { name: 'فتح' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Rana Haddad/ })).toBeVisible();
    expect(arabic.calls('POST', '/v1/share-links/unlock')[0]!.body).toMatchObject({ pin: PIN });
    await expectNoHorizontalOverflow(page, 'Share link, Arabic, 375');
  });
});

test('The right PIN shows the owner, the period’s totals and the entries with receipts', { tag: '@portal.share-link.view' }, async ({ page, step }) => {
  const api = visitor();

  await step('Enter the right PIN', async () => {
    await openLink(page, api);
    await typePin(page, PIN);
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad · Studio' })).toBeVisible();
    const band = page.getByRole('region', { name: 'Summary' });
    await expect(band).toContainText('Aug – Oct 2026 · read-only');
    await expect(band).toContainText('4,812.40');
    await expect(band).toContainText('9,600.00');
    await expect(page.getByRole('table', { name: 'Entries' }).getByText('Office rent')).toBeVisible();
  });

  await step('Show expenses only', async () => {
    await page.getByRole('radio', { name: 'Expenses' }).click();
    await expect(page.getByRole('table', { name: 'Entries' }).getByText('Brand identity')).toHaveCount(0);
    expect(api.calls('POST', '/v1/share-links/entries').at(-1)!.body).toMatchObject({ kinds: ['expense'] });
  });

  await step('View a receipt', async () => {
    await page.getByRole('table', { name: 'Entries' }).getByRole('button', { name: 'Office rent' }).click();
    const pane = page.getByRole('dialog', { name: 'Receipts' });
    await expect(pane.getByRole('img', { name: 'rent.png' })).toBeVisible();
    await expect(pane.getByRole('link', { name: 'Download rent.png' })).toBeVisible();
  });
});
