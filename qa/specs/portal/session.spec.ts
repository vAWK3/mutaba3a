import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { OFFICE_A, customer, office } from '../../support/portal';
import { FakeApi, payment, receivable } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * The portal session (mut-43-auth-states.md): AuthGate sends a signed-out
 * visitor to sign-in and back to a safe `next`; sign-out, an expired session
 * and a sign-out in another tab all end on sign-in with no figure left behind.
 * The in-memory API (qa/support/portalApi.ts) answers 401 to everything while
 * signed out, as the server does.
 */

const C1 = customer(0).id;

async function signIn(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('nour@office.ps');
  await page.getByLabel('Password', { exact: true }).fill('qa-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const seed = (signedIn: boolean) =>
  new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 1,
    signedIn,
    payments: [payment(1, { customerId: C1, amount: '400.00', number: 'PAY-0001' }), payment(2, { customerId: C1, amount: '90.00', number: 'PAY-0002', status: 'REVERSED' })],
    receivables: [receivable(1, { customerId: C1, gross: '650.00', paid: '650.00', status: 'PAID', origin: 'INSTALLMENT' })],
  });

test('A signed-out link goes through sign-in and lands where it pointed', { tag: '@portal.session.return-to-next' }, async ({ page, step }) => {
  const api = seed(false);

  await step('Open a link to recorded payments while signed out', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments?status=POSTED`);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/p/${OFFICE_A}/payments?status=POSTED`);
  });

  await step('Sign in', async () => {
    await signIn(page);
    expect(api.last('POST', /^\/v1\/sessions$/)?.body).toEqual({ email: 'nour@office.ps', password: 'qa-password' });
  });

  await step('Land on the recorded payments the link pointed at', async () => {
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/payments\\?status=POSTED$`));
    await expect(page.getByRole('tab', { name: 'Recorded' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('table', { name: 'Payments' })).toContainText('PAY-0001');
  });
});

test('A sign-in link whose next leaves the portal lands on the portal’s home instead', { tag: '@portal.session.return-to-next' }, async ({ page, step }) => {
  const api = seed(false);

  await step('Open sign-in with next pointing at another site', async () => {
    await api.open(page, '/sign-in?next=%2F%2Fevil.example%2Fsteal');
  });

  await step('Sign in: the portal stays on its own origin, at the first profile', async () => {
    await signIn(page);
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
  });
});

test('Sign out: a failure keeps you signed in and says so; then it ends the session and the next sign-in starts at home', { tag: '@portal.session.sign-out' }, async ({ page, step }) => {
  const api = seed(true);

  await step('Open Payments signed in', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await expect(page.getByRole('table', { name: 'Payments' })).toContainText('PAY-0001');
  });

  await step('Sign out while offline: still signed in, and told why', async () => {
    api.once('DELETE', /^\/v1\/sessions\/current$/, 'abort');
    await openYou(page, 'account');
    await youRow(page, 'Sign out').click();
    await expect(page.getByRole('alert')).toContainText("Couldn't sign out. Check your connection and try again.");
    // MUT-425: still signed in, on You › Account where Sign out was pressed
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/you/account`));
    await expect(youRow(page, 'Sign out')).toBeEnabled();
  });

  await step('Sign out again from You › Account, still open: sign-in says you signed out', async () => {
    await youRow(page, 'Sign out').click();
    await expect(page).toHaveURL(/\/sign-in\?reason=signed_out$/);
    await expect(page.getByRole('note')).toHaveText("You've signed out.");
    expect(api.calls('DELETE', /^\/v1\/sessions\/current$/)).toHaveLength(2);
  });

  await step('Opening the payments page again opens this device on its own, with none of the account\'s figures', async () => {
    // MUT-286: signed out, the portal is this device's own app; the account's profile isn't one of its profiles
    const before = api.calls('GET', /^\/v1\//).length;
    await page.goto(`/p/${OFFICE_A}/payments`);
    await expect(page.getByRole('heading', { name: "This profile isn't available" })).toBeVisible();
    // No profile is open on this device, so the island is only You (MUT-426)
    await expect(page.locator('.hp-island')).toHaveAttribute('aria-label', 'You');
    await expect(page.getByText('PAY-0001')).toHaveCount(0);
    expect(api.calls('GET', /^\/v1\//)).toHaveLength(before);
  });

  await step('After a sign-out, the next sign-in starts at the portal’s home, not where the last person was', async () => {
    await page.goto(`/sign-in?reason=signed_out&next=${encodeURIComponent(`/p/${OFFICE_A}/payments`)}`);
    await signIn(page);
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
  });
});

test('Signing out in one tab signs the other tab out at once', { tag: '@portal.session.other-tab' }, async ({ page, step }) => {
  const api = seed(true);
  const other = await page.context().newPage();

  await step('Open Payments in this tab and Receivables in another', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await expect(page.getByRole('table', { name: 'Payments' })).toContainText('PAY-0001');
    await api.open(other, `/p/${OFFICE_A}/receivables?status=SETTLED`);
    await expect(other.getByRole('table', { name: 'Receivables' })).toBeVisible();
  });

  await step('Sign out in the other tab', async () => {
    await openYou(other, 'account');
    await youRow(other, 'Sign out').click();
    await expect(other).toHaveURL(/\/sign-in\?reason=signed_out$/);
  });

  await step('This tab is on sign-in too, with no figure left on screen', async () => {
    await page.bringToFront();
    await expect(page).toHaveURL(/\/sign-in\?reason=signed_out$/);
    await expect(page.getByRole('note')).toHaveText("You've signed out.");
    await expect(page.getByText('PAY-0001')).toHaveCount(0);
    expect(api.calls('DELETE', /^\/v1\/sessions\/current$/)).toHaveLength(1);
  });
  await other.close();
});

test('A session that expires mid-use goes to sign-in and returns to the same view', { tag: '@portal.session.expired' }, async ({ page, step }) => {
  const api = seed(true);

  await step('Open Receivables signed in', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`);
    await expect(page.getByRole('heading', { level: 1, name: 'Receivables' })).toBeVisible();
  });

  await step('The session expires on the server; choose Settled', async () => {
    api.signedIn = false;
    await page.getByRole('tab', { name: 'Settled' }).click();
  });

  await step('Sign-in says the session ended and remembers the view', async () => {
    await expect(page).toHaveURL(/\/sign-in\?/);
    await expect(page.getByRole('note')).toHaveText("You've been signed out. Sign in again to continue.");
    const url = new URL(page.url());
    expect(url.searchParams.get('reason')).toBe('expired');
    expect(url.searchParams.get('next')).toBe(`/p/${OFFICE_A}/receivables?status=SETTLED`);
  });

  await step('Sign in: back on settled receivables', async () => {
    await signIn(page);
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/receivables\\?status=SETTLED$`));
    await expect(page.getByRole('table', { name: 'Receivables' })).toContainText('Paid');
  });
});
