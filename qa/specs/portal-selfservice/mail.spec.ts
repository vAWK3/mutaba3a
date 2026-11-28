import { test, expect } from '../../support/qa';
import { address, liveState, mailTo, setupLinkIn, skipSetupPasskey } from '../../support/selfService';
import { stubTurnstile } from '../../support/turnstile';

/**
 * MUT-468: the new mail frame, on the live dev API (support/selfservice-live.mjs). The API mails into its memory
 * outbox and serves the built portal on its own origin, which is also PORTAL_ORIGIN, so the mail's pictures load
 * from <origin>/mail/v2 exactly as they will from the production portal (MUT-484: transparent art). The mail is opened in the page as a mail app would.
 */

const HEADLINE = 'خطوة أخيرة: عيّن كلمة المرور';
const BUTTON = 'تعيين كلمة المرور';
const PASSWORD = 'a long enough passphrase';

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page, 'pass');
});

test('The Arabic signup mail is on brand, its pictures load from the portal, and it reads fully with images off', { tag: '@portal-selfservice.mail.mail-frame' }, async ({ page, request, step }) => {
  const email = address('mail-frame');
  const origin = liveState().origin;

  await step('Sign up in Arabic with a new business address', async () => {
    await page.goto('/signup');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByRole('button', { name: 'متابعة' }).click();
    await expect(page.getByText(email)).toBeVisible();
  });

  const mail = await mailTo(email, 'finish-signup');
  const setupLink = setupLinkIn(mail);

  await step('Open the signup mail: Arabic, right to left, the hello band, the envelope art and chip, the headline', async () => {
    await page.setContent(mail.html, { waitUntil: 'load' });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
    const header = page.getByRole('img', { name: 'ظرف داخل دائرة' });
    await expect(header).toBeVisible();
    await expect(header).toHaveAttribute('src', `${origin}/mail/v2/mail-header-hello-spot-email-2x.png`);
    // Loaded, not a broken-image box: the picture has real pixels.
    expect(await header.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320);
    await expect(page.getByRole('img', { name: 'أيقونة ظرف' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  await step('Its pictures come from the portal as PNGs cached for a year', async () => {
    const res = await request.get(`${origin}/mail/v2/mail-header-hello-spot-email-2x.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  await step('Turn images off and open it again: the headline, the button and the copyable link are all there', async () => {
    // A fresh page with pictures blocked before it loads, so no cached copy can stand in (review T2).
    const imagesOff = await page.context().newPage();
    await imagesOff.route('**/mail/v*/**', (route) => route.abort());
    await imagesOff.setContent(mail.html, { waitUntil: 'load' });
    expect(await imagesOff.getByRole('img', { name: 'ظرف داخل دائرة' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(0);
    await expect(imagesOff.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
    await expect(imagesOff.getByRole('link', { name: BUTTON })).toHaveAttribute('href', setupLink);
    await expect(imagesOff.getByText(setupLink)).toBeVisible();
    await imagesOff.close();
  });

  await step('Press the mail\'s button: /setup, "Finish creating your account"', async () => {
    await page.setContent(mail.html, { waitUntil: 'load' });
    await page.getByRole('link', { name: BUTTON }).click();
    // The portal strips the token from the address bar on arrival (MUT-236), so the URL ends at /setup.
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { level: 1, name: 'أكمل إنشاء حسابك' })).toBeVisible();
  });
});

test("An Arabic account's closing mail faces its directional art right to left", { tag: '@portal-selfservice.mail.mail-directional-art' }, async ({ page, step }) => {
  // TD-371: with open sign-up there is no review, so no account-ready mail; Close my account sends account-closing,
  // whose bin picture has a direction too (look.ts destructive-confirmation, rtl).
  const email = address('mail-rtl-art', 'gmail.com');
  const origin = liveState().origin;

  await step('Sign up in Arabic with a webmail address and finish /setup: it opens at once', async () => {
    await page.goto('/signup');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByRole('button', { name: 'متابعة' }).click();
    await expect(page.getByText(email)).toBeVisible();
    await page.goto(setupLinkIn(await mailTo(email, 'finish-signup')));
    await page.getByLabel('كلمة المرور الجديدة').fill(PASSWORD);
    await page.getByRole('checkbox', { name: /شروط الخدمة/ }).check();
    await page.getByRole('button', { name: 'أنشئ الحساب' }).click();
    await skipSetupPasskey(page, 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'الرئيسية' })).toBeVisible();
  });

  await step('Close the account from You › Account with the password', async () => {
    await page.goto('/you/account?closeAccount=true');
    const dialog = page.getByRole('dialog', { name: 'إغلاق حسابي' });
    await dialog.getByLabel('كلمة المرور').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'إغلاق حسابي' }).click();
    await expect(page.getByRole('heading', { name: 'حسابك قيد الإغلاق' })).toBeVisible();
  });

  await step('Open the closing mail: Arabic, right to left, headed by the mirrored bin picture, loaded', async () => {
    const mail = await mailTo(email, 'account-closing');
    expect(mail.locale).toBe('ar');
    await page.setContent(mail.html, { waitUntil: 'load' });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: /^سيُحذف حسابك بتاريخ/ })).toBeVisible();
    const header = page.getByRole('img', { name: 'سلة بغطاء مفتوح' });
    await expect(header).toHaveAttribute('src', `${origin}/mail/v2/mail-header-goodbye-destructive-confirmation-rtl-2x.png`);
    expect(await header.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320);
  });
});
