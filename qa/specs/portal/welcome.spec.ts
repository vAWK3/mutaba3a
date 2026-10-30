import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { MODE_KEY, OFFICE_A, office, signedOutServer } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * The first-visit welcome (MUT-513, ADR-230). Nothing is stubbed but the server's one answer: every /v1 request is a
 * 401, as the API gives with nobody signed in, and this browser has chosen nothing yet (no `mut-mode`).
 */

const WELCOME_AR = 'كل مبلغ في مكانه.';
const WELCOME_EN = 'Every amount, accounted for.';
const PHONE = { width: 375, height: 812 };

const welcomeHeading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const modeHint = (page: Page) => page.evaluate((key) => localStorage.getItem(key), MODE_KEY);

test('A first visit with nobody signed in shows the welcome in Arabic, not the app, and saves nothing', { tag: '@portal.welcome.first-visit' }, async ({ page, step }) => {
  const server = await signedOutServer(page, null, null);

  await step('Open the portal for the first time, with nobody signed in', async () => {
    await page.goto('/');
    await expect(welcomeHeading(page, WELCOME_AR)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  await step('The account door and the this-device door are both there', async () => {
    const account = page.getByRole('region', { name: 'بحساب' });
    await expect(account.getByRole('link', { name: 'تسجيل الدخول' })).toBeVisible();
    await expect(account.getByRole('link', { name: 'أنشئ حسابًا' })).toBeVisible();
    const device = page.getByRole('region', { name: 'على هذا الجهاز فقط' });
    await expect(device.getByRole('button', { name: 'جرّبها على هذا الجهاز' })).toBeVisible();
  });

  await step('The this-device door says plainly what this browser keeps, and promises no phone', async () => {
    const device = page.getByRole('region', { name: 'على هذا الجهاز فقط' });
    await expect(device.getByRole('listitem')).toHaveText([
      'تبقى في هذا المتصفح فقط. بلا حساب، ولا يُرسَل إلينا شيء.',
      'مسح بيانات هذا الموقع يمحوها.',
      'احفظ نسخة منها من بياناتك › تنزيل سجلاتي.',
      'لا تنتقل إلى حساب لاحقًا.',
    ]);
    await expect(device).not.toContainText('هاتف');
  });

  await step('No app, nothing saved, and only the first-visit check reached the server', async () => {
    await expect(page.getByRole('navigation', { name: 'الأقسام' })).toHaveCount(0);
    expect(await modeHint(page)).toBeNull();
    expect(server.requests).toEqual(['GET /v1/me']);
  });
});

test('A browser with a live session but no saved mode goes straight to its account, never to the welcome', { tag: '@portal.welcome.live-session' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });

  await step('Open the portal signed in, in a browser that has no saved mode: the account opens, no welcome', async () => {
    await api.open(page, '/', 'en', { mode: null });
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await expect(welcomeHeading(page, WELCOME_EN)).toHaveCount(0);
    expect(await modeHint(page)).toBe('remote');
  });
});

test('Try it on this device opens the app in one tap, and the welcome never shows again', { tag: '@portal.welcome.try-local' }, async ({ page, step }) => {
  await signedOutServer(page, 'en', null);

  await step('Open the portal for the first time, in English', async () => {
    await page.goto('/');
    await expect(welcomeHeading(page, WELCOME_EN)).toBeVisible();
  });

  await step('Choose Try it on this device', async () => {
    await page.getByRole('button', { name: 'Try it on this device' }).click();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    expect(await modeHint(page)).toBe('local');
  });

  await step('Reload the page: the app again, no welcome', async () => {
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await expect(welcomeHeading(page, WELCOME_EN)).toHaveCount(0);
  });
});

test('Sign in goes to sign-in, and coming back without signing in returns to the welcome', { tag: '@portal.welcome.sign-in-door' }, async ({ page, step }) => {
  await signedOutServer(page, 'en', null);

  await step('Open the portal for the first time, in English', async () => {
    await page.goto('/');
    await expect(welcomeHeading(page, WELCOME_EN)).toBeVisible();
  });

  await step('Choose Sign in: the sign-in form opens', async () => {
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  await step('Go back: the welcome again, still undecided', async () => {
    await page.goBack();
    await expect(welcomeHeading(page, WELCOME_EN)).toBeVisible();
    expect(await modeHint(page)).toBeNull();
  });
});

test('Create an account goes to the signup page', { tag: '@portal.welcome.signup-door' }, async ({ page, step }) => {
  await signedOutServer(page, 'en', null);

  await step('Open the portal for the first time, in English, and choose Create an account', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });
});

test('Deep links never show the welcome', { tag: '@portal.welcome.deep-link-skips' }, async ({ page, step }) => {
  await signedOutServer(page, 'en', null);

  await step('Open /sign-in: the sign-in page, no welcome', async () => {
    await page.goto('/sign-in');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(welcomeHeading(page, WELCOME_EN)).toHaveCount(0);
  });

  await step('Open /signup: its own page, no welcome', async () => {
    await page.goto('/signup');
    await expect(page).toHaveURL(/\/signup$/);
    await expect(welcomeHeading(page, WELCOME_EN)).toHaveCount(0);
  });

  await step("Open a profile's page: sign-in, keeping where it was headed", async () => {
    await page.goto(`/p/${OFFICE_A}/receivables`);
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(`/p/${OFFICE_A}/receivables`)}$`));
    await expect(welcomeHeading(page, WELCOME_EN)).toHaveCount(0);
  });
});

test("When the server can't be reached, the welcome still opens with a Retry, and Retry asks again", { tag: '@portal.welcome.offline' }, async ({ page, step }) => {
  await signedOutServer(page, 'en', null);
  await page.route('**/v1/me', (route) => route.abort('internetdisconnected'), { times: 1 });

  await step("Open the portal for the first time while the check can't reach the server", async () => {
    await page.goto('/');
    await expect(welcomeHeading(page, WELCOME_EN)).toBeVisible();
    await expect(page.getByRole('status')).toContainText("Can't reach MTB3A right now");
  });

  await step('Press Retry once the server answers', async () => {
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText("Can't reach MTB3A right now")).toHaveCount(0);
    await expect(welcomeHeading(page, WELCOME_EN)).toBeVisible();
    expect(await modeHint(page)).toBeNull();
  });
});

test("With this site's storage blocked, the welcome still opens and Try still opens the app for this visit", { tag: '@portal.welcome.blocked-storage' }, async ({ page, step }) => {
  await signedOutServer(page, 'en', null);
  // A browser that refuses to save anything for this site: every localStorage write throws
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    };
  });

  await step('Open the portal for the first time in a browser that refuses to save anything for this site', async () => {
    await page.goto('/');
    await expect(welcomeHeading(page, WELCOME_EN)).toBeVisible();
  });

  await step('Choose Try it on this device: the app opens for this visit, though nothing could be saved', async () => {
    await page.getByRole('button', { name: 'Try it on this device' }).click();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    expect(await modeHint(page)).toBeNull();
  });
});

test('You › Account › What is MTB3A? reopens the welcome, and Continue on this device goes back to the app', { tag: '@portal.welcome.reopen' }, async ({ page, step }) => {
  await signedOutServer(page);

  await step('Open the portal on this device, in English', async () => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  });

  await step('Open You › Account and choose What is MTB3A?', async () => {
    await openYou(page, 'account');
    await youRow(page, 'What is MTB3A?').click();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(welcomeHeading(page, WELCOME_EN)).toBeVisible();
  });

  await step('Choose Continue on this device: back to the app', async () => {
    await page.getByRole('button', { name: 'Continue on this device' }).click();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  });
});

test('The welcome fits a 375px phone in Arabic with no horizontal scroll', { tag: '@portal.welcome.phone-fit' }, async ({ page, step }) => {
  await page.setViewportSize(PHONE);
  await signedOutServer(page, null, null);

  await step('Open the portal for the first time on a 375px-wide screen', async () => {
    await page.goto('/');
    await expect(welcomeHeading(page, WELCOME_AR)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
    const art = await page.getByRole('img', { name: 'باب مفتوح يقود إليه درب منقّط' }).boundingBox();
    const title = await welcomeHeading(page, WELCOME_AR).boundingBox();
    expect(art!.y + art!.height).toBeLessThanOrEqual(title!.y);
  });
});

test('With reduced motion the welcome only fades in, and the illustration is still', { tag: '@portal.welcome.reduced-motion' }, async ({ page, step }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signedOutServer(page, 'en', null);

  await step('Open the portal for the first time with reduced motion requested', async () => {
    await page.goto('/');
    await expect(welcomeHeading(page, WELCOME_EN)).toBeVisible();
    const animation = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);
    expect(await animation('.hp-welcome-title')).toBe('hp-welcome-fade');
    expect(await animation('.hp-welcome-door')).toBe('hp-welcome-fade');
    for (const part of ['.hp-welcome-arch', '.hp-welcome-path', '.hp-welcome-nuqta', '.hp-welcome-sparkle']) expect(await animation(part)).toBe('none');
  });
});
