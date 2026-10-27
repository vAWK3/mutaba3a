import { test, expect } from '../../support/qa';
import { address, liveState, mailTo, setupLinkIn } from '../../support/selfService';
import { stubTurnstile } from '../../support/turnstile';

/**
 * MUT-468: the new mail frame, on the live dev API (support/selfservice-live.mjs). The API mails into its memory
 * outbox and serves the built portal on its own origin, which is also PORTAL_ORIGIN, so the mail's pictures load
 * from <origin>/mail/v1 exactly as they will from app.mtb3a.com. The mail is opened in the page as a mail app would.
 */

const HEADLINE = 'خطوة أخيرة: عيّن كلمة المرور';
const BUTTON = 'تعيين كلمة المرور';

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
    await expect(header).toHaveAttribute('src', `${origin}/mail/v1/mail-header-hello-spot-email-2x.png`);
    // Loaded, not a broken-image box: the picture has real pixels.
    expect(await header.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320);
    await expect(page.getByRole('img', { name: 'أيقونة ظرف' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  await step('Its pictures come from the portal as PNGs cached for a year', async () => {
    const res = await request.get(`${origin}/mail/v1/mail-header-hello-spot-email-2x.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  await step('Turn images off and open it again: the headline, the button and the copyable link are all there', async () => {
    await page.route('**/mail/v1/**', (route) => route.abort());
    await page.setContent(mail.html, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
    await expect(page.getByRole('link', { name: BUTTON })).toHaveAttribute('href', setupLink);
    await expect(page.getByText(setupLink)).toBeVisible();
  });

  await step('Press the mail\'s button: /setup, "Finish creating your account"', async () => {
    await page.getByRole('link', { name: BUTTON }).click();
    await expect(page).toHaveURL(/\/setup#/);
    await expect(page.getByRole('heading', { level: 1, name: 'أكمل إنشاء حسابك' })).toBeVisible();
  });
});
