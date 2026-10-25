import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { address, chooseLanguage, decideReview, expireSignupLinks, mailTo, operatorAccount, outbox, setupLinkIn, signInThroughForm } from '../../support/selfService';
import { stubTurnstile } from '../../support/turnstile';

/**
 * MUT-368: Create an account, on a live dev API (support/selfservice-live.mjs) that serves the built portal under its
 * real CSP, mails into its memory outbox and judges domains from the fixture table. Turnstile is the page-routed
 * stand-in for Cloudflare's test keys (support/turnstile.ts). Each test makes its own addresses.
 */

const PASSWORD = 'a long enough passphrase';

const COPY = {
  en: {
    title: 'Create your account',
    email: 'Email',
    continue: 'Continue',
    sent: 'Check your email',
    finish: 'Finish creating your account',
    password: 'New password',
    terms: /terms of service/,
    create: 'Create account',
    home: 'Owed',
    trial: 'Your free trial',
    trialStarted: 'Your 14-day free trial has started',
    openSoon: /Subscriptions open soon/,
    trialContinue: 'Continue',
    review: "We're reviewing your account",
    reviewBody: "We'll email you within 2 working days.",
  },
  ar: {
    title: 'أنشئ حسابك',
    email: 'البريد الإلكتروني',
    continue: 'متابعة',
    sent: 'تفقّد بريدك الإلكتروني',
    finish: 'أكمل إنشاء حسابك',
    password: 'كلمة المرور الجديدة',
    terms: /شروط الخدمة/,
    create: 'أنشئ الحساب',
    home: 'المستحق',
    trial: 'تجربتك المجانية',
    trialStarted: 'بدأت تجربتك المجانية لمدة 14 يومًا',
    openSoon: /يُفتح الاشتراك قريبًا/,
    trialContinue: 'متابعة',
    review: 'نراجع حسابك',
    reviewBody: 'سنراسلك خلال يومَي عمل.',
  },
} as const;

type Language = keyof typeof COPY;

async function askForLink(page: Page, email: string, language: Language) {
  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: COPY[language].title })).toBeVisible();
  await page.getByLabel(COPY[language].email).fill(email);
  await page.getByRole('button', { name: COPY[language].continue }).click();
  await expect(page.getByRole('heading', { level: 1, name: COPY[language].sent })).toBeVisible();
}

/** Open the signup mail's link and finish /setup; returns the mail. */
async function finishSetup(page: Page, email: string, language: Language) {
  const mail = await mailTo(email, 'finish-signup');
  await page.goto(setupLinkIn(mail));
  await expect(page.getByRole('heading', { level: 1, name: COPY[language].finish })).toBeVisible();
  await page.getByLabel(COPY[language].password).fill(PASSWORD);
  await page.getByRole('checkbox', { name: COPY[language].terms }).check();
  await page.getByRole('button', { name: COPY[language].create }).click();
  return mail;
}

/**
 * MUT-418: a new trial's first sign-in opens on "Your 14-day free trial has started". This API has no Stripe, so it
 * is the honest variant (subscriptions open soon, Continue only, no card). Continue lands on Home, once.
 */
async function expectHome(page: Page, language: Language) {
  const trial = page.getByRole('dialog', { name: COPY[language].trial });
  await expect(trial.getByRole('heading', { name: COPY[language].trialStarted })).toBeVisible();
  await expect(trial.getByText(COPY[language].openSoon)).toBeVisible();
  await expect(trial.getByRole('button', { name: /Add a card|أضف بطاقة/ })).toHaveCount(0);
  await trial.getByRole('button', { name: COPY[language].trialContinue, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: COPY[language].home })).toBeVisible();
}

async function expectUnderReview(page: Page, language: Language) {
  await expect(page.getByRole('heading', { level: 1, name: COPY[language].review })).toBeVisible();
  await expect(page.getByText(COPY[language].reviewBody)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page, 'pass');
});

test('A new person signs up in Arabic and lands signed in on their personal profile', { tag: '@portal-selfservice.signup.create' }, async ({ page, step }) => {
  const arabic = address('create-ar');
  await step('Open /signup with no language chosen: Arabic, right to left, the terms come with the password', async () => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { level: 1, name: COPY.ar.title })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('ستوافق على الشروط عند اختيار كلمة المرور.')).toBeVisible();
    await expect(page.getByTitle('Turnstile (QA stand-in)')).toBeVisible();
  });
  await step('Type a new business address and press Continue: "Check your email" names it', async () => {
    await page.getByLabel(COPY.ar.email).fill(arabic);
    await page.getByRole('button', { name: COPY.ar.continue }).click();
    await expect(page.getByRole('heading', { level: 1, name: COPY.ar.sent })).toBeVisible();
    await expect(page.getByText(arabic)).toBeVisible();
  });
  await step('The mail is in Arabic; its link opens "Finish creating your account" with the address read-only', async () => {
    const mail = await mailTo(arabic, 'finish-signup');
    expect(mail.locale).toBe('ar');
    await page.goto(setupLinkIn(mail));
    await expect(page.getByRole('heading', { level: 1, name: COPY.ar.finish })).toBeVisible();
    await expect(page.getByLabel('الحساب')).toHaveValue(arabic);
    await expect(page.getByLabel('العملة الرئيسية')).toHaveValue('ILS');
  });
  await step('Type a password, tick the terms and press Create account: Home of the personal profile, signed in', async () => {
    await page.getByLabel(COPY.ar.password).fill(PASSWORD);
    await page.getByRole('checkbox', { name: COPY.ar.terms }).check();
    await page.getByRole('button', { name: COPY.ar.create }).click();
    await expectHome(page, 'ar');
  });
});

test('The same in English: the page, the mail and Home are in English', { tag: '@portal-selfservice.signup.create' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const english = address('create-en');
  await step('Ask for a link in English', async () => {
    await askForLink(page, english, 'en');
  });
  await step('The mail is in English; finish /setup and land on Home', async () => {
    const mail = await finishSetup(page, english, 'en');
    expect(mail.locale).toBe('en');
    await expectHome(page, 'en');
  });
});

test('Signing up with an address that already has an account says the same thing, and the mail says how to sign in', { tag: '@portal-selfservice.signup.existing-email' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const email = address('existing');
  await operatorAccount(email, 'en', PASSWORD);
  await step('Sign up with the address of an existing account: the same "Check your email"', async () => {
    await askForLink(page, email, 'en');
  });
  await step('The outbox holds "you already have an account", and no signup link', async () => {
    await mailTo(email, 'account-exists');
    expect((await outbox(email)).map((m) => m.template)).not.toContain('finish-signup');
  });
});

test('A signup link opened after 24 hours says it expired and offers a new one', { tag: '@portal-selfservice.signup.expired-link' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const email = address('expired');
  await step('Ask for a link, and let it age past 24 hours', async () => {
    await askForLink(page, email, 'en');
    await mailTo(email, 'finish-signup');
    expireSignupLinks(email);
  });
  await step('Open it: "This link has expired", no password form, and Send a new link', async () => {
    await page.goto(setupLinkIn(await mailTo(email, 'finish-signup')));
    await expect(page.getByRole('heading', { level: 1, name: 'This link has expired' })).toBeVisible();
    await expect(page.getByLabel('New password')).toHaveCount(0);
    await page.getByRole('link', { name: 'Send a new link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
  });
});

test('A failed or refused check says so, keeps the address, and sends nothing while it failed', { tag: '@portal-selfservice.signup.check-refused' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const email = address('check');
  const signups: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/signups') signups.push(request.url());
  });
  await step('With the check failing, the widget says it couldn’t run, with Try again and the support address', async () => {
    await page.unroute('https://challenges.cloudflare.com/**');
    await stubTurnstile(page, 'fail');
    await page.goto('/signup');
    const failure = page.getByText(/The check that you're a person couldn't run/);
    await expect(failure).toBeVisible();
    await expect(failure.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(failure.getByRole('link')).toHaveAttribute('href', /^mailto:/);
  });
  await step('Press Continue: nothing is sent, and the address stays typed', async () => {
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Email')).toHaveValue(email);
    expect(signups).toEqual([]);
  });
  await step('With the check passing, the server refuses the token once: "The check didn’t pass", the address kept', async () => {
    await page.unroute('https://challenges.cloudflare.com/**');
    await stubTurnstile(page, 'pass');
    await page.route('**/v1/signups', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CHECK_FAILED', message: 'x', details: null, requestId: 'qa' } }) }), { times: 1 });
    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText("The check didn't pass. Try again.");
    await expect(page.getByLabel('Email')).toHaveValue(email);
  });
});

for (const [id, domain, copy] of [
  ['disposable', 'mailinator.com', "This address is from a throwaway email service. Use one you'll keep."],
  ['no-mail-domain', 'nomail.example', "This address can't receive email. Check it for typos, or use another one."],
] as const) {
  test(`A ${domain} address is refused under the field, the address kept, and no mail sent`, { tag: `@portal-selfservice.signup.${id}` }, async ({ page, step }) => {
    await chooseLanguage(page, 'en');
    const email = address(id, domain);
    await step(`Sign up with an @${domain} address`, async () => {
      await page.goto('/signup');
      await page.getByLabel('Email').fill(email);
      await page.getByRole('button', { name: 'Continue' }).click();
    });
    await step('The field says why, and keeps the address; nothing reaches the outbox', async () => {
      await expect(page.getByText(copy)).toBeVisible();
      await expect(page.getByLabel('Email')).toHaveValue(email);
      await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
      expect(await outbox(email)).toEqual([]);
    });
  });
}

test('Asking again for the same address within a minute says to wait, and keeps the address', { tag: '@portal-selfservice.signup.rate-limited' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const email = address('limited');
  await step('Ask for a link', async () => {
    await askForLink(page, email, 'en');
  });
  await step('Open /signup again and ask for the same address within the minute: wait a minute', async () => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('Please wait a minute before asking again.');
    await expect(page.getByLabel('Email')).toHaveValue(email);
  });
});

test('While signup is closed, /signup says accounts are by request and sign-in offers no Create an account', { tag: '@portal-selfservice.signup.closed' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  await page.route('**/v1/self-service', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signup: false, recovery: true }) }));
  await step('Open /signup: "Accounts are by request for now", linking the landing request form', async () => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts are by request for now' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request an account' })).toHaveAttribute('href', /\/hosted$/);
    await expect(page.getByLabel('Email')).toHaveCount(0);
  });
  await step('Open sign-in: Forgot your password? shows, Create an account doesn’t', async () => {
    await page.goto('/sign-in');
    await expect(page.getByRole('link', { name: 'Forgot your password?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);
  });
});

test('An address on a domain that passes the business checks signs up at once', { tag: '@portal-selfservice.signup.business-instant' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const email = address('instant', 'studio.example');
  await step('Sign up with an @studio.example address and finish /setup', async () => {
    await askForLink(page, email, 'en');
    await finishSetup(page, email, 'en');
  });
  await step('Signed in straight away on Home, with no review', async () => {
    await expectHome(page, 'en');
  });
});

for (const language of ['en', 'ar'] as const) {
  test(`A webmail signup waits for the operator, then signs in to Home once approved (${language})`, { tag: '@portal-selfservice.signup.review-webmail' }, async ({ page, step }) => {
    await chooseLanguage(page, language);
    const email = address(`review-${language}`, 'gmail.com');
    await step('Sign up with an @gmail.com address and finish /setup: the under-review screen', async () => {
      await askForLink(page, email, language);
      await finishSetup(page, email, language);
      await expectUnderReview(page, language);
      await expect(page.getByRole('link', { name: /@/ })).toHaveAttribute('href', /^mailto:/);
    });
    await step('Sign in with the new password: the same screen', async () => {
      await signInThroughForm(page, email, PASSWORD, language);
      await expectUnderReview(page, language);
    });
    await step('The operator approves; the approval mail arrives', async () => {
      await decideReview(email, 'approve');
      await mailTo(email, 'account-ready');
    });
    await step('Sign in again: Home', async () => {
      await signInThroughForm(page, email, PASSWORD, language);
      await expectHome(page, language);
    });
  });
}

test('A declined signup gets the decline mail, and sign-in is refused like any unknown account', { tag: '@portal-selfservice.signup.review-declined' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const email = address('declined', 'gmail.com');
  await step('Sign up with an @gmail.com address and finish /setup: under review', async () => {
    await askForLink(page, email, 'en');
    await finishSetup(page, email, 'en');
    await expectUnderReview(page, 'en');
  });
  await step('The operator declines; the mail names the support address', async () => {
    await decideReview(email, 'decline');
    const mail = await mailTo(email, 'account-declined');
    expect(mail.text).toMatch(/[\w.+-]+@[\w.-]+\.\w+/);
  });
  await step('Sign in with that address and password: refused like any unknown account', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signInThroughForm(page, email, PASSWORD, 'en');
    await expect(page.getByRole('alert')).toContainText("That email and password don't match.");
  });
});

test('At 375 px in Arabic, every signup screen fits with nothing scrolling sideways', { tag: '@portal-selfservice.signup.375' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const email = address('narrow', 'gmail.com');
  await step('/signup in Arabic: the card and the check fit', async () => {
    await page.goto('/signup');
    await expect(page.getByTitle('Turnstile (QA stand-in)')).toBeVisible();
    await expectNoHorizontalOverflow(page, '/signup at 375 px');
    const card = await page.locator('form.hp-signin-card').boundingBox();
    const check = await page.locator('.hp-turnstile').boundingBox();
    expect(check!.x).toBeGreaterThanOrEqual(card!.x);
    expect(check!.x + check!.width).toBeLessThanOrEqual(card!.x + card!.width);
  });
  await step('"Check your email" fits', async () => {
    await page.getByLabel(COPY.ar.email).fill(email);
    await page.getByRole('button', { name: COPY.ar.continue }).click();
    await expect(page.getByRole('heading', { level: 1, name: COPY.ar.sent })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'check your email at 375 px');
  });
  await step('/setup for the new account fits', async () => {
    await page.goto(setupLinkIn(await mailTo(email, 'finish-signup')));
    await expect(page.getByRole('heading', { level: 1, name: COPY.ar.finish })).toBeVisible();
    await expectNoHorizontalOverflow(page, '/setup at 375 px');
  });
  await step('The under-review screen fits', async () => {
    await page.getByLabel(COPY.ar.password).fill(PASSWORD);
    await page.getByRole('checkbox', { name: COPY.ar.terms }).check();
    await page.getByRole('button', { name: COPY.ar.create }).click();
    await expectUnderReview(page, 'ar');
    await expectNoHorizontalOverflow(page, 'under review at 375 px');
  });
});
