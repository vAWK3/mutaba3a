import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { CAFE_CUSTOMER, CAFE_USER, CARD_CUSTOMER, CARD_USER, ClientBooksApi, NEW_CODE } from '../../support/clientBooksApi';

/**
 * MUT-768 (epic MUT-762, accountant channel): the accountant's customers on the Client books desk, over an in-memory
 * API that answers the way MUT-764 to MUT-767's routes do. Add customer and its code, the Customer drawer (new code,
 * change email), Take card with Stripe as a stub page, and a customer who claims while the drawer is open.
 */

const PHONE = { width: 375, height: 812 };
const spoken = (code: string) => code.split('').join(' ');

test('An approved accountant adds a customer and gets the code to say out loud', { tag: '@portal.accountant-desk.add' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ clients: [], customers: [] });

  await step('Open the desk with no clients', async () => {
    await api.open(page, '/client-books');
    await expect(page.getByRole('heading', { name: 'No clients yet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add customer' }).first()).toBeVisible();
  });

  await step('Add a customer with the five fields', async () => {
    await page.getByRole('button', { name: 'Add customer' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add customer' });
    await dialog.getByLabel('Customer name').fill('Samer Haddad');
    await dialog.getByLabel('Business name').fill('Café Nour');
    await dialog.getByLabel('Email').fill('Samer@CafeNour.ps');
    await dialog.getByLabel('Language of the mail').selectOption('en');
    await expect(dialog.getByLabel('Country')).toHaveValue('PS');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  });

  await step('Read the code and where the link went, then Done', async () => {
    const dialog = page.getByRole('dialog', { name: 'Add customer' });
    await expect(dialog.getByText('Link sent to samer@cafenour.ps')).toBeVisible();
    await expect(dialog.getByTestId('claim-code')).toHaveAttribute('aria-label', spoken('481702'));
    const [post] = api.calls('POST', '/v1/accountant/customers');
    expect(post?.body).toMatchObject({ email: 'samer@cafenour.ps', displayName: 'Samer Haddad', profileName: 'Café Nour', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
    expect(post?.headers['idempotency-key']).toBeTruthy();
    await dialog.getByRole('button', { name: 'Done' }).click();
    const row = page.getByRole('table', { name: 'Client books' }).getByRole('row').filter({ hasText: 'Café Nour' });
    await expect(row).toContainText('Awaiting claim');
    await expect(row.getByRole('button', { name: /New code/ })).toBeVisible();
  });

  await step('Open the drawer in Arabic at 375 px', async () => {
    await page.setViewportSize(PHONE);
    const arabic = new ClientBooksApi({ customers: [CAFE_CUSTOMER] });
    await arabic.open(page, '/client-books?newCustomer=true', 'ar');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'Add customer, Arabic, 375');
  });
});

test('A new code and a changed email, from the Customer drawer', { tag: '@portal.accountant-desk.code' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ customers: [CAFE_CUSTOMER] });
  await api.open(page, '/client-books');

  await step('Open an unclaimed customer from its row', async () => {
    const row = page.getByRole('table', { name: 'Client books' }).getByRole('row').filter({ hasText: 'Café Nour' });
    await row.getByRole('button', { name: /New code/ }).click();
    await expect(page).toHaveURL(new RegExp(`customer=${CAFE_USER}`));
    const dialog = page.getByRole('dialog', { name: 'Customer' });
    for (const name of ['Resend link', 'New code', 'Change email', 'Take card']) await expect(dialog.getByRole('button', { name })).toBeVisible();
  });

  await step('Make a new code', async () => {
    const dialog = page.getByRole('dialog', { name: 'Customer' });
    await dialog.getByRole('button', { name: 'New code' }).click();
    await expect(dialog.getByTestId('claim-code')).toHaveAttribute('aria-label', spoken(NEW_CODE));
    await expect(dialog.getByText('Link sent to samer@cafenour.ps')).toBeVisible();
  });

  await step('Change the email and confirm', async () => {
    const dialog = page.getByRole('dialog', { name: 'Customer' });
    await dialog.getByRole('button', { name: 'Change email' }).click();
    await expect(dialog.getByText('Old link and code stop working.')).toBeVisible();
    await dialog.getByLabel('New email').fill('New@CafeNour.ps');
    await dialog.getByRole('button', { name: 'Change', exact: true }).click();
    await expect(dialog.getByText('Link sent to new@cafenour.ps')).toBeVisible();
    expect(api.calls('PUT', `/v1/accountant/customers/${CAFE_USER}/email`)[0]?.body).toEqual({ email: 'new@cafenour.ps' });
  });
});

test('Take card collects the plan and address, leaves for Stripe, and the row turns Active', { tag: '@portal.accountant-desk.take-card' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ customers: [CARD_CUSTOMER] });
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stripe Checkout (QA)</title>' }));
  await api.open(page, '/client-books');
  const deskUrl = page.url();
  const row = () => page.getByRole('table', { name: 'Client books' }).getByRole('row').filter({ hasText: 'Dar Al-Salam' });

  await step('Open Take card from a customer who has claimed and not paid', async () => {
    await expect(row()).toContainText('Needs card');
    await row().getByRole('button', { name: /Take card/ }).click();
    await expect(page).toHaveURL(/pane=card/);
  });

  await step('Fill plan, payment, customer type, country and address', async () => {
    const dialog = page.getByRole('dialog', { name: 'Customer' });
    await dialog.getByLabel('Plan').selectOption('business');
    await dialog.getByLabel('Payment').selectOption('year');
    await dialog.getByLabel('Customer type').selectOption('business');
    await dialog.getByLabel('Country').selectOption('PS');
    await dialog.getByLabel('Address').fill('12 Main St');
    await dialog.getByLabel('City').fill('Ramallah');
    await dialog.getByLabel('Postal code').fill('00970');
  });

  await step('Continue to Stripe and come back to the desk', async () => {
    await page.getByRole('dialog', { name: 'Customer' }).getByRole('button', { name: 'Continue to Stripe' }).click();
    await expect(page).toHaveURL(/checkout\.stripe\.com/);
    expect(api.calls('POST', `/v1/accountant/customers/${CARD_USER}/checkout-session`)[0]?.body).toEqual({
      plan: 'business',
      interval: 'year',
      country: 'PS',
      buyer: 'business',
      address: { country: 'PS', line1: '12 Main St', city: 'Ramallah', postalCode: '00970' },
      returnPath: '/client-books',
    });
    await page.goto(deskUrl);
    await expect(row()).toContainText('Activating');
    await expect(row()).toContainText('Active', { timeout: 45_000 });
  });
});

test("A customer who claims while the drawer is open loses the setup actions", { tag: '@portal.accountant-desk.claimed' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ customers: [CAFE_CUSTOMER] });
  await api.open(page, `/client-books?customer=${CAFE_USER}`);
  const dialog = page.getByRole('dialog', { name: 'Customer' });

  await step("Open an unclaimed customer's drawer", async () => {
    await expect(dialog.getByRole('button', { name: 'New code' })).toBeVisible();
  });

  await step('The customer claims the account', async () => {
    api.customers![0]!.state = 'claimed';
  });

  await step('Make a new code', async () => {
    await dialog.getByRole('button', { name: 'New code' }).click();
    await expect(dialog.getByRole('note')).toContainText('Claimed');
    await expect(dialog.getByRole('button', { name: 'New code' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Change email' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Take card' })).toBeVisible();
  });
});

// ---- MUT-771 (DR-11, DT7): the desk's accessibility, across the four flows above --------------------------------------

test('The desk reads and works by keyboard and screen reader: axe, pane focus, Escape, live regions, 44 px targets', { tag: '@portal.accountant-desk.a11y' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ customers: [CAFE_CUSTOMER, CARD_CUSTOMER] });
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stripe Checkout (QA)</title>' }));
  await api.open(page, '/client-books');
  const deskUrl = page.url();
  const table = page.getByRole('table', { name: 'Client books' });

  await step('The desk with its customers passes axe', async () => {
    await expect(table.getByRole('row').filter({ hasText: 'Café Nour' })).toContainText('Awaiting claim');
    await expectOnlyKnownAxeViolations(page, 'portalSignedIn');
  });

  await step('Each row’s one action is at least 44 px tall, and a state is a word, not a colour', async () => {
    for (const name of [/New code/, /Take card/]) {
      const box = await table.getByRole('button', { name }).first().boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(table.getByRole('row').filter({ hasText: 'Dar Al-Salam' })).toContainText('Needs card');
  });

  await step('Add customer: the code pane takes focus at its heading and the code is read digit by digit', async () => {
    await page.getByRole('button', { name: 'Add customer' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add customer' });
    await dialog.getByLabel('Customer name').fill('Layla Mansour');
    await dialog.getByLabel('Business name').fill('Layla Studio');
    await dialog.getByLabel('Email').fill('layla@studio.ps');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Added', exact: true })).toBeFocused();
    const code = dialog.getByTestId('claim-code');
    await expect(code).toHaveAttribute('role', 'img');
    await expect(code).toHaveAttribute('dir', 'ltr');
    await expect(code).toHaveAttribute('aria-label', /^\d( \d){5}$/);
    await expectOnlyKnownAxeViolations(page, 'portalSignedIn');
  });

  await step('Escape closes the drawer', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Add customer' })).toHaveCount(0);
  });

  await step('Back from Stripe, Activating and then Active are said in a polite live region', async () => {
    const row = table.getByRole('row').filter({ hasText: 'Dar Al-Salam' });
    await row.getByRole('button', { name: /Take card/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Customer' });
    await dialog.getByLabel('Plan').selectOption('business');
    await dialog.getByLabel('Country').selectOption('PS');
    await dialog.getByLabel('Address').fill('12 Main St');
    await dialog.getByLabel('City').fill('Ramallah');
    await dialog.getByLabel('Postal code').fill('00970');
    await dialog.getByRole('button', { name: 'Continue to Stripe' }).click();
    await expect(page).toHaveURL(/checkout\.stripe\.com/);
    await page.goto(deskUrl);
    const live = page.locator('.hp-activating-status [role="status"][aria-live="polite"]');
    await expect(live).toContainText('Dar Al-Salam: Activating…');
    await expect(live).toContainText('Dar Al-Salam: Active', { timeout: 45_000 });
  });

  await step('At 375 px the desk has no sideways scroll', async () => {
    await page.setViewportSize(PHONE);
    await expectNoHorizontalOverflow(page, 'Client books desk, 375');
  });
});
