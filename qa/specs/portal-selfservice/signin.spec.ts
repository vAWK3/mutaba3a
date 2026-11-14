import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { address, chooseLanguage, mailTo, operatorAccount, outbox, type Mail } from '../../support/selfService';
import { stubTurnstile } from '../../support/turnstile';

/**
 * MUT-618: "Email me a sign-in code", on the live dev API (support/selfservice-live.mjs). The code comes from the
 * memory outbox the way a person reads it from their mail. Turnstile is the page-routed stand-in (support/turnstile.ts).
 */

const PASSWORD = 'the account long passphrase';

const COPY = {
  en: { email: 'Email', link: 'Email me a sign-in code', title: 'Check your email', code: 'Sign-in code', submit: 'Sign in', lead: /has an MTB3A account, we’ve sent it a 6-digit code/, wrong: 'That code isn’t right. 4 tries left.' },
  ar: { email: 'البريد الإلكتروني', link: 'أرسل لي رمز دخول بالبريد', title: 'تفقّد بريدك الإلكتروني', code: 'رمز الدخول', submit: 'تسجيل الدخول', lead: /حساب في متابعة، فقد أرسلنا إليه رمزًا من 6 أرقام/, wrong: 'هذا الرمز غير صحيح. بقيت 4 محاولات.' },
} as const;

function codeIn(mail: Mail): string {
  const code = mail.text.match(/^\d{6}$/m)?.[0];
  expect(code, 'a 6-digit code on its own line').toBeTruthy();
  return code!;
}

async function askForCode(page: Page, email: string, language: 'en' | 'ar') {
  const copy = COPY[language];
  await page.goto('/sign-in');
  await page.getByLabel(copy.email).fill(email);
  await page.getByRole('button', { name: copy.link }).click();
  await expect(page.getByRole('heading', { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByText(copy.lead)).toBeVisible();
}

async function typeCode(page: Page, code: string, language: 'en' | 'ar') {
  const copy = COPY[language];
  await page.getByLabel(copy.code).fill(code);
  await page.getByRole('button', { name: copy.submit, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page, 'pass');
});

for (const language of ['en', 'ar'] as const) {
  test(`${language === 'en' ? 'English' : 'Arabic'}: an emailed code signs in; an address with no account gets nothing`, { tag: '@portal-selfservice.signin.email-code' }, async ({ page, step }) => {
    const copy = COPY[language];
    const email = address(`code-${language}`);
    await operatorAccount(email, language, PASSWORD);
    await chooseLanguage(page, language);
    let code = '';

    await step('On sign-in type your email and press Email me a sign-in code', async () => {
      await askForCode(page, email, language);
      await expect(page.getByLabel(copy.code)).toHaveAttribute('autocomplete', 'one-time-code');
    });
    await step('The mail carries the code in its subject and body, in the page’s language', async () => {
      const mail = await mailTo(email, 'sign-in-code');
      code = codeIn(mail);
      expect(mail.locale).toBe(language);
      expect(mail.subject).toContain(code);
    });
    await step('A wrong code says how many tries are left', async () => {
      await typeCode(page, code === '000000' ? '111111' : '000000', language);
      await expect(page.getByRole('alert')).toHaveText(copy.wrong);
    });
    await step('The right code lands on Home', async () => {
      await typeCode(page, code, language);
      await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
    });
    await step('An address with no account sees the same screen, and nothing is mailed', async () => {
      const nobody = address(`code-nobody-${language}`);
      await page.context().clearCookies();
      await askForCode(page, nobody, language);
      expect(await outbox(nobody)).toEqual([]);
    });
  });
}
