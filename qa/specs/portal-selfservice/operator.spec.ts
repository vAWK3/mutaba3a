import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { address, chooseLanguage, grantOperator, liveState, mailTo, operatorAccount, pendingSignup, signInThroughForm, signsIn, SIGNUP_PASSWORD } from '../../support/selfService';
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

async function operator(page: Page, language: 'en' | 'ar' = 'en'): Promise<{ email: string; authenticator: VirtualAuthenticator }> {
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
  return { email, authenticator };
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
    navigator.credentials.get = () => {
      navigator.credentials.get = real;
      return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
    };
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
    await dismissNextPasskeySheet(page);
    await signupRow(page, waiting).getByRole('button', { name: 'Approve with passkey' }).click();
    await expect(signupRow(page, waiting).getByRole('button', { name: 'Approve with passkey' })).toBeEnabled();
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
