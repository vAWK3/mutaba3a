import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { stubTurnstile } from '../../support/turnstile';
import { QA_TERMS_VERSION } from '../../support/portal';
import { ClientBooksApi, INVITE_TOKEN, STUDIO } from '../../support/clientBooksApi';

/**
 * MUT-562 (layout B): the page an accountant invite's email opens, over MUT-559's routes in an in-memory API. Signed
 * out (sign in, or create an account then sign in), signed in (accept), and every refusal. Each lands on the client.
 */

const PHONE = { width: 375, height: 812 };
const PASSWORD = 'a long enough passphrase';

async function openInvite(page: Page, api: ClientBooksApi, language: 'en' | 'ar' = 'en') {
  await page.goto('about:blank');
  await api.open(page, `/accountant-invite#${INVITE_TOKEN}`, language);
}

test('Signed out, the invite says who invited you to read what, and nothing of the token stays in the address', { tag: '@portal.accountant-invite.signed-out' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ signedIn: false, clients: [] });

  await step('Open the invite link', async () => {
    await openInvite(page, api);
    await expect(page.getByRole('heading', { name: 'Rana Haddad invited you to read Studio' })).toBeVisible();
    await expect(page.getByText(/For s\*\*\*@khoury-cpa.com · ends/)).toBeVisible();
    await expect(page).toHaveURL(/\/accountant-invite$/);
    expect(api.calls('POST', '/v1/accountant-invites/check')[0]!.body).toEqual({ token: INVITE_TOKEN });
    await expect(page.getByRole('link', { name: 'Sign in to accept' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible();
  });

  await step('Open it in Arabic at 375 px', async () => {
    await page.setViewportSize(PHONE);
    await openInvite(page, new ClientBooksApi({ signedIn: false, clients: [] }), 'ar');
    await expect(page.getByRole('heading', { name: /دعاك/ })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'Accept invite, Arabic, 375');
  });
});

test('Create an account from the invite: the address is fixed, then sign-in and the client book', { tag: '@portal.accountant-invite.signup' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ signedIn: false, clients: [] });
  await stubTurnstile(page);

  await step('Create an account', async () => {
    await openInvite(page, api);
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page.getByLabel('Email')).toHaveValue('s***@khoury-cpa.com');
    await expect(page.getByText("The invite's address; it can't be changed.")).toBeVisible();
    await expect(page.getByText(/Reading up to 3 client books is always free/)).toBeVisible();
  });

  await step('Fill in a name and password, agree and submit', async () => {
    await page.getByLabel('Name').fill('Sami Khoury');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: 'Create account and accept' }).click();
    await expect(page).toHaveURL(new RegExp(`/client-books/${STUDIO}`));
    await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad · Studio' })).toBeVisible();
    expect(api.calls('POST', '/v1/accountant-invites/signup')[0]!.body).toMatchObject({ token: INVITE_TOKEN, displayName: 'Sami Khoury', password: PASSWORD, acceptedTermsVersion: QA_TERMS_VERSION });
    expect(api.calls('POST', '/v1/sessions')[0]!.body).toEqual({ email: 'sami@khoury-cpa.com', password: PASSWORD });
  });
});

test('Sign in to accept comes back to the invite; Accept opens the client', { tag: '@portal.accountant-invite.accept' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ signedIn: false, clients: [] });

  await step('Sign in to accept', async () => {
    await openInvite(page, api);
    await page.getByRole('link', { name: 'Sign in to accept' }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccountant-invite/);
    await page.getByLabel('Email').fill('sami@khoury-cpa.com');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/accountant-invite$/);
    await expect(page.getByRole('heading', { name: "Accept Rana Haddad's invite?" })).toBeVisible();
  });

  await step('Accept', async () => {
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page).toHaveURL(new RegExp(`/client-books/${STUDIO}`));
    await expect(page.getByRole('heading', { level: 1, name: 'Rana Haddad · Studio' })).toBeVisible();
    expect(api.calls('POST', '/v1/accountant-invites/accept')[0]!.body).toEqual({ token: INVITE_TOKEN });
  });
});

test('An invite refuses another address, an existing account, one already read, and one that is gone', { tag: '@portal.accountant-invite.refusals' }, async ({ page, step }) => {
  await step('Accept while signed in as another address', async () => {
    await openInvite(page, new ClientBooksApi({ invite: 'mismatch', clients: [] }));
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByRole('heading', { name: 'This invite was sent to another address' })).toBeVisible();
    await expect(page.getByText(/h\*\*\*@firm.com/)).toBeVisible();
    await expect(page.getByText(/same company domain works too/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out and use another account' })).toBeVisible();
  });

  await step('Create an account for an address that already has one', async () => {
    await stubTurnstile(page);
    await openInvite(page, new ClientBooksApi({ signedIn: false, accountExists: true, clients: [] }));
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: 'Create account and accept' }).click();
    await expect(page.getByRole('heading', { name: 'You already have an account' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to accept' })).toBeVisible();
  });

  await step('Accept an invite to a profile you already read', async () => {
    await openInvite(page, new ClientBooksApi({ invite: 'already' }));
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByRole('heading', { name: 'You can already read this profile' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/client-books');
  });

  await step('Accept an invite that was used, withdrawn or ended', async () => {
    await openInvite(page, new ClientBooksApi({ invite: 'gone', clients: [] }));
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByRole('heading', { name: 'This invite is no longer available' })).toBeVisible();
  });
});

test('With the free client books used, the Accountant plan takes Accept’s place; back from Checkout the invite is accepted', { tag: '@portal.accountant-invite.plan' }, async ({ page, step }) => {
  const api = new ClientBooksApi({ freeBooksUsed: true, clients: [] });

  await step('Open the invite with three client books already', async () => {
    await openInvite(page, api);
    await expect(page.getByRole('heading', { name: 'Your free client books are used' })).toBeVisible();
    await expect(page.getByText('Reading up to 3 client books is free. To read Studio as well, subscribe to the Accountant plan.')).toBeVisible();
    await expect(page.getByText(/₪99\.00 \/ \$29\.00 a month/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Not now \(the invite stays open until/ })).toBeVisible();
  });

  await step('Pick a country and Subscribe', async () => {
    await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stripe Checkout (QA)</title>' }));
    await page.getByLabel('Country').selectOption('IL');
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page).toHaveURL(/checkout\.stripe\.com/);
    expect(api.calls('POST', '/v1/billing/checkout-session')[0]!.body).toMatchObject({ plan: 'accountant', interval: 'month', country: 'IL', returnPath: '/accountant-invite' });
  });

  await step('Come back from Checkout', async () => {
    await page.goto('/accountant-invite?billing=true&checkout=success');
    await expect(page).toHaveURL(new RegExp(`/client-books/${STUDIO}`), { timeout: 20_000 });
    expect(api.calls('POST', '/v1/accountant-invites/accept')).toHaveLength(1);
  });
});
