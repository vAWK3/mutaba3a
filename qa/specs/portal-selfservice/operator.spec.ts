import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import {
  address,
  adminAudit,
  adminGrants,
  adminOrganization,
  chooseLanguage,
  featureHolders,
  grantOperator,
  liveSession,
  liveState,
  mailTo,
  operatorAccount,
  ownedFirmRequest,
  pendingSignup,
  redeemSetupLink,
  sessionWorks,
  signInThroughForm,
  signsIn,
  SIGNUP_PASSWORD,
} from '../../support/selfService';
import { addVirtualAuthenticator, type VirtualAuthenticator } from '../../support/passkeys';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-460: the operator's signup review page, against the live dev API's real operator gate and passkey step-up
 * (support/selfservice-live.mjs: http://localhost:8791, WEBAUTHN_RP_ID=localhost, OPERATOR_ALERT_EMAIL set). Chromium's
 * virtual authenticator answers the passkey sheet; waiting signups are made as /signup and /setup make them.
 *
 * An operator must hold a passkey (MUT-459 D7), so each spec signs in with the password, adds one, and only then is
 * made an operator through the admin route. A password sign-in leaves the step-up stale; a passkey sign-in opens it.
 */

const PASSWORD = 'the operator long passphrase';
const HOME = /\/p\/[0-9a-f-]{36}$/;

async function operator(page: Page, language: 'en' | 'ar' = 'en'): Promise<{ id: string; email: string; authenticator: VirtualAuthenticator }> {
  const email = address('operator');
  const { id } = await operatorAccount(email, language, PASSWORD);
  const authenticator = await addVirtualAuthenticator(page);
  await signInThroughForm(page, email, PASSWORD, language);
  await expect(page).toHaveURL(HOME);
  await openYou(page, 'account');
  await youRow(page, language === 'ar' ? 'مفاتيح المرور' : 'Passkeys').click();
  await page.getByRole('button', { name: language === 'ar' ? 'إضافة مفتاح مرور' : 'Add a passkey' }).click();
  await expect(page.getByRole('dialog').getByRole('listitem')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await grantOperator(id);
  return { id, email, authenticator };
}

const signupRow = (page: Page, email: string) => page.getByRole('listitem', { name: email });

/**
 * The person dismisses the next passkey sheet. The virtual authenticator has no Cancel button (without presence it
 * waits out the 2-minute ceremony), so the next `navigator.credentials.get` answers as the browser does on a dismissal:
 * NotAllowedError. Later calls reach the virtual authenticator again.
 */
async function dismissNextPasskeySheet(page: Page) {
  await page.evaluate(() => {
    const real = navigator.credentials.get.bind(navigator.credentials);
    const dismiss = Object.assign(
      () => {
        navigator.credentials.get = real;
        return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
      },
      { dismissed: false },
    );
    navigator.credentials.get = dismiss;
  });
}

test('From the digest mail, sign in with a passkey and approve a waiting signup', { tag: '@portal-selfservice.operator.signups-approve' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const { authenticator } = await operator(page);
  let waiting = '';
  let link = '';
  await step('Someone signs up with an @gmail.com address and finishes setting a password', async () => {
    waiting = await pendingSignup('waiting');
    const digest = await mailTo(liveState().operatorDigest, 'review-digest');
    link = digest.text.match(/https?:\/\/[^\s]+\/operator\/signups/)?.[0] ?? '';
    expect(link, 'the digest links to the signups page').toBe(`${liveState().origin}/operator/signups`);
  });
  await step('Sign out, then open the digest mail’s Review signups link', async () => {
    await authenticator.setPresence(false);
    await openYou(page, 'account');
    await youRow(page, 'Sign out').click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto(link);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  });
  let prompts = 0;
  await step('Sign in with the passkey, which the sign-in page offers first', async () => {
    const buttons = page.getByRole('button', { name: /^Sign in/ });
    await expect(buttons.first()).toHaveText('Sign in with a passkey');
    await expect(buttons.first()).toHaveClass(/btn-primary/);
    page.on('request', (request) => void (request.url().endsWith('/v1/operator/step-up/options') && (prompts += 1)));
    await authenticator.setPresence(true);
    await buttons.first().click();
    await expect(page).toHaveURL(/\/operator\/signups$/);
  });
  await step('The signup is listed with its wait and a Webmail chip', async () => {
    const row = signupRow(page, waiting);
    await expect(row).toBeVisible();
    await expect(row).toContainText(/Signed up \d+ minutes? ago/);
    await expect(row.getByText('Webmail')).toBeVisible();
  });
  await step('Press Approve: the confirm says what will be mailed', async () => {
    await signupRow(page, waiting).getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(`${waiting} can sign in. We'll email them now.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });
  await step('Confirm: approved, the mail went, the row leaves, no second passkey prompt', async () => {
    await signupRow(page, waiting).getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText(`${waiting} approved · email sent`)).toBeVisible();
    await expect(signupRow(page, waiting)).toHaveCount(0);
    expect(prompts).toBe(0);
  });
  await step('The person gets the account-ready mail and can sign in', async () => {
    await mailTo(waiting, 'account-ready');
    expect(await signsIn(waiting, SIGNUP_PASSWORD)).toBe(true);
  });
});

test('Decline a waiting signup, in Arabic on a 375 px phone', { tag: '@portal-selfservice.operator.signups-decline' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await chooseLanguage(page, 'ar');
  await operator(page, 'ar');
  const waiting = await pendingSignup('declined');
  await step('Open المشغّل from You › Account', async () => {
    await page.goto('/you/account');
    await page.getByRole('link', { name: /^المشغّل/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'المشغّل' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'the operator signups page at 375 px');
  });
  await step('Press رفض: the confirm says the account will be deleted', async () => {
    await signupRow(page, waiting).getByRole('button', { name: 'رفض' }).click();
    await expect(page.getByText(`سيُحذف حساب ${waiting}. سنراسله، ويمكنه التسجيل من جديد.`)).toBeVisible();
    await expectNoHorizontalOverflow(page, 'the decline confirm at 375 px');
  });
  await step('Confirm with the passkey: declined, and the mail went', async () => {
    await signupRow(page, waiting).getByRole('button', { name: 'رفض بمفتاح المرور' }).click();
    await expect(page.getByText(`رُفض ${waiting} · أُرسل البريد`)).toBeVisible();
    await expect(signupRow(page, waiting)).toHaveCount(0);
  });
  await step('The person gets the decline mail and can no longer sign in', async () => {
    await mailTo(waiting, 'account-declined');
    expect(await signsIn(waiting, SIGNUP_PASSWORD)).toBe(false);
  });
});

test('A stale step-up asks for the passkey on the same tap; cancelling it changes nothing', { tag: '@portal-selfservice.operator.step-up-passkey' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  await operator(page);
  const waiting = await pendingSignup('stepup');
  await step('Press Approve: the confirm button reads Approve with passkey', async () => {
    await page.goto('/operator/signups');
    await signupRow(page, waiting).getByRole('button', { name: 'Approve' }).click();
    await expect(signupRow(page, waiting).getByRole('button', { name: 'Approve with passkey' })).toBeVisible();
  });
  await step('Dismiss the passkey sheet: the confirm stays, with no message and nothing approved', async () => {
    const posts: string[] = [];
    page.on('request', (request) => void (request.method() === 'POST' && posts.push(new URL(request.url()).pathname)));
    await dismissNextPasskeySheet(page);
    await signupRow(page, waiting).getByRole('button', { name: 'Approve with passkey' }).click();
    // The sheet was asked for (options fetched, the one-shot dismissal used up) and nothing else was sent.
    await expect.poll(() => page.evaluate(() => (navigator.credentials.get as unknown as { dismissed?: boolean }).dismissed !== false)).toBe(true);
    await expect(signupRow(page, waiting).getByRole('button', { name: 'Approve with passkey' })).toBeEnabled();
    expect(posts).toEqual(['/v1/operator/step-up/options']);
    await expect(signupRow(page, waiting).getByRole('alert')).toHaveCount(0);
    expect(await signsIn(waiting, SIGNUP_PASSWORD)).toBe(false);
  });
  await step('Confirm on the device: approved', async () => {
    await signupRow(page, waiting).getByRole('button', { name: 'Approve with passkey' }).click();
    await expect(page.getByText(`${waiting} approved · email sent`)).toBeVisible();
    expect(await signsIn(waiting, SIGNUP_PASSWORD)).toBe(true);
  });
});

test('Someone who isn’t an operator never sees the console', { tag: '@portal-selfservice.operator.hidden-for-non-operator' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const email = address('not-operator');
  await operatorAccount(email, 'en', PASSWORD);
  await signInThroughForm(page, email, PASSWORD);
  await expect(page).toHaveURL(HOME);
  await step('You › Account has no Operator row', async () => {
    await openYou(page, 'account');
    await expect(youRow(page, 'Sign out')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Operator/ })).toHaveCount(0);
  });
  await step('/operator/signups goes to Home, and the server refuses the list with 404', async () => {
    await page.goto('/operator/signups');
    await expect(page).toHaveURL(HOME);
    const res = await page.request.get('/v1/operator/signup-reviews');
    expect(res.status()).toBe(404);
  });
});

// ---- MUT-461: accounts ------------------------------------------------------------------------------------------

const TARGET_PASSWORD = 'the person long passphrase';
const NEW_PASSWORD = 'a fresh passphrase after the reset';

/** A person to act on, signed in on another device (a live session the action should end). */
async function target(label: string): Promise<{ email: string; device: string }> {
  const email = address(label);
  await operatorAccount(email, 'en', TARGET_PASSWORD);
  return { email, device: await liveSession(email, TARGET_PASSWORD) };
}

async function openAccount(page: Page, email: string, language: 'en' | 'ar' = 'en') {
  await page.goto('/operator/accounts');
  await page.getByLabel(language === 'ar' ? 'البريد الإلكتروني' : 'Email address').fill(email);
  await page.getByRole('button', { name: language === 'ar' ? 'بحث' : 'Search' }).click();
  await page.getByRole('list').getByRole('link', { name: new RegExp(email.replace(/[.+]/g, '\\$&')) }).click();
  await expect(page.getByRole('heading', { level: 2, name: email })).toBeVisible();
}

const accessRow = (page: Page, label: string | RegExp) => page.getByRole('region', { name: /^(Access|الدخول)$/ }).getByRole('button', { name: label });
/** The info toast: its text has the address isolated (FSI … PDI), so it is read with the isolates removed. */
const toastText = (page: Page) => page.getByTestId('toast-live').evaluate((el) => (el.textContent ?? '').replace(/[⁨⁩]/g, ''));
/** MUT-462: the open in-row confirm's text, read the same way (its address is isolated too). */
const confirmText = (page: Page) => page.getByRole('group').first().evaluate((el) => (el.textContent ?? '').replace(/[⁨⁩]/g, ''));

test('Find an account by its email, and say so when there is none', { tag: '@portal-selfservice.operator.account-find' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  await operator(page);
  const { email } = await target('findme');
  await step('Open the Accounts tab of the operator console', async () => {
    await page.goto('/operator/signups');
    await page.getByRole('link', { name: 'Accounts' }).click();
    await expect(page).toHaveURL(/\/operator\/accounts$/);
    await expect(page.getByLabel('Email address')).toHaveAttribute('dir', 'ltr');
  });
  await step('Search for an address no account has', async () => {
    const nobody = address('nobody-here');
    await page.getByLabel('Email address').fill(nobody);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('heading', { name: 'No account with this address' })).toBeVisible();
    await expect(page.getByText(nobody)).toHaveAttribute('dir', 'ltr');
  });
  await step('Search for the person’s address in capitals: one match, the address in the URL', async () => {
    await page.getByLabel('Email address').fill(email.toUpperCase());
    await page.keyboard.press('Enter');
    const found = page.getByRole('list', { name: 'Account found' });
    await expect(found.getByText(email)).toBeVisible();
    await expect(found.getByText('Active')).toBeVisible();
    await expect(page).toHaveURL(/\/operator\/accounts\?email=/);
  });
  await step('Open the match: who, how they stand, what each action would end, and their profile', async () => {
    await page.getByRole('list', { name: 'Account found' }).getByRole('link').click();
    await expect(page.getByRole('heading', { level: 2, name: email })).toBeVisible();
    await expect(page.getByText(/Last signed in \d+ minutes? ago · No passkey/)).toBeVisible();
    await expect(accessRow(page, /Sign out everywhere/)).toContainText('1 device · the password still works');
    await expect(accessRow(page, /Disable account/)).toContainText('Signs out 1 device');
    await expect(page.getByRole('region', { name: 'Profiles' })).toContainText(/Owner · (Trial|No plan|Granted|Paid) · /);
  });
});

test('Sign a person out everywhere; their password still works', { tag: '@portal-selfservice.operator.account-revoke-sessions' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  await operator(page);
  let person = { email: '', device: '' };
  await step('The person is signed in on another device', async () => {
    person = await target('signout');
    expect(await sessionWorks(person.device)).toBe(true);
  });
  await step('Open their account and press Sign out everywhere: the confirm says what it ends', async () => {
    await openAccount(page, person.email);
    await accessRow(page, /Sign out everywhere/).click();
    await expect(page.getByRole('group')).toContainText('will be signed out on 1 device, and 0 connected apps disconnected. Their password still works.');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });
  await step('Confirm with the passkey: the toast says 1 device', async () => {
    await page.getByRole('button', { name: 'Sign out with passkey' }).click();
    await expect.poll(() => toastText(page)).toContain(`${person.email} signed out on 1 device`);
    await expect(accessRow(page, /Sign out everywhere/)).toBeFocused();
  });
  await step('Their other device is signed out, and their password still signs in', async () => {
    expect(await sessionWorks(person.device)).toBe(false);
    expect(await signsIn(person.email, TARGET_PASSWORD)).toBe(true);
  });
});

test('Disable an account and enable it again, in Arabic on a 375 px phone', { tag: '@portal-selfservice.operator.account-disable-enable' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // No chooseLanguage here: the browser has no stored language, so this proves the Arabic default (MUT-209, ADR-077).
  await step('With no language chosen, the portal opens in Arabic, right to left', async () => {
    await page.goto('/sign-in');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('mutaba3a-portal-language'))).toBeNull();
  });
  await operator(page, 'ar');
  const person = await target('disable');
  await step('Open their account from الحسابات: right to left, no sideways scroll', async () => {
    await page.goto('/operator/signups');
    await page.getByRole('link', { name: 'الحسابات' }).click();
    await openAccount(page, person.email, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 2, name: person.email })).toHaveAttribute('dir', 'ltr');
    await expectNoHorizontalOverflow(page, 'the operator account page at 375 px');
  });
  await step('Press تعطيل الحساب and confirm with the passkey', async () => {
    await accessRow(page, /تعطيل الحساب/).click();
    await expectNoHorizontalOverflow(page, 'the disable confirm at 375 px');
    await page.getByRole('button', { name: 'تعطيل بمفتاح المرور' }).click();
    await expect.poll(() => toastText(page)).toContain(`عُطّل ${person.email}`);
  });
  await step('The account says it is disabled, offers only تفعيل الحساب, and the person is out', async () => {
    await expect(page.getByText(/هذا الحساب معطّل/)).toBeVisible();
    await expect(accessRow(page, /تفعيل الحساب/)).toBeVisible();
    await expect(accessRow(page, /تعطيل الحساب/)).toHaveCount(0);
    expect(await sessionWorks(person.device)).toBe(false);
    expect(await signsIn(person.email, TARGET_PASSWORD)).toBe(false);
  });
  await step('Press تفعيل الحساب and confirm: their password signs in again', async () => {
    await accessRow(page, /تفعيل الحساب/).click();
    await page.getByRole('button', { name: 'تفعيل', exact: true }).click();
    await expect.poll(() => toastText(page)).toContain(`فُعّل ${person.email}`);
    await expect(accessRow(page, /تعطيل الحساب/)).toBeVisible();
    expect(await signsIn(person.email, TARGET_PASSWORD)).toBe(true);
  });
});

test('Send a reset link with the password locked; it is shown once', { tag: '@portal-selfservice.operator.account-setup-link' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  await operator(page);
  let person = { email: '', device: '' };
  await step('The person is signed in on another device', async () => {
    person = await target('reset');
    expect(await sessionWorks(person.device)).toBe(true);
  });
  let link = '';
  await step('Press Send reset link, keep Lock the current password on, and make the link with the passkey', async () => {
    await openAccount(page, person.email);
    await accessRow(page, /Send reset link/).click();
    await expect(page.getByRole('switch', { name: 'Lock the current password' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Make link with passkey' }).click();
    const field = page.getByLabel(/^Reset link for/);
    await expect(field).toHaveValue(/\/setup#[A-Za-z0-9_-]{43}$/);
    link = await field.inputValue();
    await expect(page.getByText('Shown once. Leaving this page discards it.')).toBeVisible();
  });
  await step('The old password no longer works and their other device is signed out', async () => {
    expect(await sessionWorks(person.device)).toBe(false);
    expect(await signsIn(person.email, TARGET_PASSWORD)).toBe(false);
  });
  await step('Open the link as the person and set a new password: it signs in', async () => {
    await redeemSetupLink(link, NEW_PASSWORD);
    expect(await signsIn(person.email, NEW_PASSWORD)).toBe(true);
  });
  await step('Leave the account and come back: the link is gone', async () => {
    await page.getByRole('link', { name: 'Accounts' }).click();
    await openAccount(page, person.email);
    await expect(accessRow(page, /Send reset link/)).toBeVisible();
    await expect(page.getByLabel(/^Reset link for/)).toHaveCount(0);
  });
});

// ---- MUT-462: billing grants, feature flags, firm requests -------------------------------------------------------

/** A person to act on, with their id (for the CLI's own reads). */
async function targetWithId(label: string): Promise<{ email: string; id: string }> {
  const email = address(label);
  const { id } = await operatorAccount(email, 'en', TARGET_PASSWORD);
  return { email, id };
}

const dayIn = (days: number) => new Intl.DateTimeFormat('en-u-nu-latn', { dateStyle: 'medium' }).format(new Date(Date.now() + days * 86_400_000));
const firmRow = (page: Page, name: string) => page.getByRole('list', { name: /^(Firm requests|طلبات المكاتب)$/ }).getByRole('listitem', { name });

test('Grant a person billing coverage with a reason and an expiry, then revoke it', { tag: '@portal-selfservice.operator.billing-grant-revoke' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const op = await operator(page);
  const person = await targetWithId('grant');
  const billing = page.getByRole('region', { name: 'Billing' });
  await step('Open their account and press Grant coverage: the drawer opens in the address', async () => {
    await openAccount(page, person.email);
    await expect(billing.getByText('No grants.')).toBeVisible();
    await billing.getByRole('button', { name: /Grant coverage/ }).click();
    await expect(page).toHaveURL(/\?grant=new$/);
    await expect(page.getByRole('dialog', { name: 'Grant coverage' })).toBeVisible();
  });
  await step('Choose Freelancer, give the reason "QA pilot comp", choose 30 days, and grant with the passkey', async () => {
    const drawer = page.getByRole('dialog', { name: 'Grant coverage' });
    await drawer.getByRole('radio', { name: /Freelancer/ }).check();
    await drawer.getByLabel('Reason').fill('QA pilot comp');
    await drawer.getByRole('button', { name: '30 days' }).click();
    await drawer.getByRole('button', { name: 'Grant with passkey' }).click();
    await expect.poll(() => toastText(page)).toContain(`Coverage granted to ${person.email}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/grant=new/);
  });
  await step('The grant is listed, and the CLI’s list shows it granted by the operator', async () => {
    await expect(billing.getByText('Freelancer · QA pilot comp')).toBeVisible();
    await expect(billing.getByText(`Until ${dayIn(30)}`)).toBeVisible();
    const [grant] = await adminGrants(person.id);
    expect(grant).toMatchObject({ reason: 'QA pilot comp', tier: 'FREELANCER', grantedBy: `operator:${op.id}`, revokedAt: null });
  });
  await step('Revoke the grant and confirm: the row says Revoked, and the CLI’s list agrees', async () => {
    await billing.getByRole('button', { name: 'Revoke' }).click();
    await expect.poll(() => confirmText(page)).toContain(`${person.email} loses this Freelancer coverage.`);
    await page.getByRole('group').first().getByRole('button', { name: 'Revoke' }).click();
    await expect.poll(() => toastText(page)).toContain(`Coverage revoked for ${person.email}`);
    await expect(billing.getByText(/^Revoked /)).toBeVisible();
    await expect(billing.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
    expect((await adminGrants(person.id))[0]?.revokedAt).not.toBeNull();
  });
});

test('Turn Connect Claude on for a person, then off with a confirm', { tag: '@portal-selfservice.operator.feature-grant-revoke' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  await operator(page);
  const person = await targetWithId('flag');
  const flag = () => page.getByRole('region', { name: 'Features' }).getByRole('switch', { name: /Connect Claude/ });
  await step('Open their account: Features lists Connect Claude, off', async () => {
    await openAccount(page, person.email);
    await expect(flag()).toHaveAttribute('aria-checked', 'false');
  });
  await step('Turn it on, confirming with the passkey: it reads on, and the CLI lists them as a holder', async () => {
    await flag().click();
    await expect(flag()).toHaveAttribute('aria-checked', 'true');
    expect(await featureHolders()).toContain(person.id);
  });
  await step('Turn it off: it asks first, saying what they lose; confirm, and it reads off', async () => {
    await flag().click();
    await expect.poll(() => confirmText(page)).toContain(`${person.email} loses Claude access, and any Claude they connected is disconnected now.`);
    expect(await featureHolders()).toContain(person.id);
    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(flag()).toHaveAttribute('aria-checked', 'false');
    expect(await featureHolders()).not.toContain(person.id);
  });
});

test('Enable firm features for a waiting request from the Firms tab', { tag: '@portal-selfservice.operator.firm-request-enable' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const op = await operator(page);
  let request = { email: '', userId: '', profileId: '', profileName: '' };
  await step('An owner asks for firm features on their Business profile', async () => {
    request = await ownedFirmRequest('firm-owner', TARGET_PASSWORD);
  });
  await step('Open the Firms tab: it counts the request and lists who asked', async () => {
    await page.goto('/operator/signups');
    await page.getByRole('link', { name: /^Firms · \d+$/ }).click();
    await expect(page).toHaveURL(/\/operator\/firms$/);
    const row = firmRow(page, request.profileName);
    await expect(row.getByText(request.email)).toHaveAttribute('dir', 'ltr');
    await expect(row.getByText('Their own business profile')).toBeVisible();
  });
  await step('Press Enable: the owner stays its owner; enable with the passkey', async () => {
    await firmRow(page, request.profileName).getByRole('button', { name: 'Enable' }).click();
    await expect.poll(() => confirmText(page)).toContain(`Its owners stay as they are (${request.email})`);
    await page.getByRole('button', { name: 'Enable with passkey' }).click();
    await expect.poll(() => toastText(page)).toContain(`Firm features on for ${request.profileName}`);
    await expect(firmRow(page, request.profileName)).toHaveCount(0);
  });
  await step('The profile is a firm, its owner unchanged, audited with the operator', async () => {
    const organization = await adminOrganization(request.profileId);
    expect(organization.firm.enabledAt).not.toBeNull();
    expect(organization.ownerUserId).toBe(request.userId);
    expect((await adminAudit(request.profileId)).find((e) => e.action === 'firm.enabled')).toMatchObject({ actorType: 'ADMIN', actorId: op.id });
  });
});

test('Decline a firm request, in Arabic on a 375 px phone', { tag: '@portal-selfservice.operator.firm-request-decline' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // No chooseLanguage here: the browser has no stored language, so this proves the Arabic default (MUT-209, ADR-077).
  await step('With no language chosen, the portal opens in Arabic, right to left', async () => {
    await page.goto('/sign-in');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(await page.evaluate(() => localStorage.getItem('mutaba3a-portal-language'))).toBeNull();
  });
  const op = await operator(page, 'ar');
  let request = { email: '', userId: '', profileId: '', profileName: '' };
  await step('An owner asks for firm features; open المكاتب', async () => {
    request = await ownedFirmRequest('firm-decline', TARGET_PASSWORD);
    await page.goto('/operator/signups');
    await page.getByRole('link', { name: /^المكاتب/ }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(firmRow(page, request.profileName).getByText(request.email)).toHaveAttribute('dir', 'ltr');
    await expectNoHorizontalOverflow(page, 'the Firms tab at 375 px');
  });
  await step('Press رفض: the confirm says the profile stays regular and its owner can ask again', async () => {
    await firmRow(page, request.profileName).getByRole('button', { name: 'رفض' }).click();
    await expect.poll(() => confirmText(page)).toContain('يبقى');
    await expect.poll(() => confirmText(page)).toContain('يمكن لمالكه أن يطلب من جديد');
    await expectNoHorizontalOverflow(page, 'the decline confirm at 375 px');
  });
  await step('Confirm with the passkey: the request leaves; no firm features, nothing pending, audited with the operator', async () => {
    await page.getByRole('button', { name: 'رفض بمفتاح المرور' }).click();
    await expect.poll(() => toastText(page)).toContain('رُفض طلب');
    await expect(firmRow(page, request.profileName)).toHaveCount(0);
    const organization = await adminOrganization(request.profileId);
    expect(organization.firm).toMatchObject({ enabledAt: null, requestedAt: null });
    expect((await adminAudit(request.profileId)).find((e) => e.action === 'firm.request_declined')).toMatchObject({ actorType: 'ADMIN', actorId: op.id });
  });
});
