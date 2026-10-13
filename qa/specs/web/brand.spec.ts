import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome, openNewIncomeDrawer, localDateFromToday, switchToArabic, enableOptionalArea } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { ar } from '../../support/i18n';
import {
  CANVAS,
  SCHEMES,
  attachScreenshot,
  computedFont,
  expectNoHorizontalOverflow,
  fitProblems,
  loadedFaces,
  numbersIn,
  rootTokenNumbers,
  watchFontRequests,
} from '../../support/brand';

/**
 * Brand v2 foundation (MUT-102) in a real browser: colour contrast in light and
 * dark, the Thmanyah / Plex Mono faces in English and Arabic, the theme toggle's
 * four states, and layout at 375 and 1280. Token values are proved in Node
 * (src/styles/__tests__/brand.test.ts).
 */

const attentionRow = (page: Page, client: string, language: 'en' | 'ar' = 'en') =>
  page
    .getByRole('region', { name: language === 'en' ? 'Needs Attention' : ar.overview.needsAttention })
    .getByRole('row')
    .filter({ hasText: client });
const clientLink = (page: Page, name: string) => page.getByRole('main').getByRole('row').getByRole('link', { name, exact: true });

/** Two clients with money owed: Acme Studio $1,200 overdue, Beta Labs $300 due in 2 days */
async function logTwoClients(page: Page) {
  await openFreshApp(page, '/income');
  await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio', dueDate: localDateFromToday(-5) });
  await logIncome(page, { title: 'Brand book', amount: '300', client: 'Beta Labs', dueDate: localDateFromToday(2) });
}

for (const scheme of SCHEMES) {
  test(
    `${scheme} mode: Home, the payment drawer, Income, the income drawer, Clients beside a profile and Settings pass axe, colour contrast included`,
    { tag: '@web.brand.contrast-app' },
    async ({ page, step }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await logTwoClients(page);

      await step('Check Home', async () => {
        await page.goto('/app/');
        await expect(attentionRow(page, 'Acme Studio')).toBeVisible();
        await expectOnlyKnownAxeViolations(page, 'home');
      });

      await step('Check the payment drawer', async () => {
        await attentionRow(page, 'Acme Studio').getByRole('button', { name: 'Record Payment — Remaining: $1,200' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectOnlyKnownAxeViolations(page, 'paymentDrawer', '[role="dialog"]');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
      });

      await step('Check Income', async () => {
        await page.goto('/app/income');
        await expect(page.getByRole('main').getByText('Logo redesign')).toBeVisible();
        await expectOnlyKnownAxeViolations(page, 'income');
      });

      await step('Check the income drawer', async () => {
        await openNewIncomeDrawer(page);
        await expectOnlyKnownAxeViolations(page, 'incomeDrawer', '[role="dialog"]');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
      });

      await step('Check Clients with a profile open beside the list', async () => {
        await page.goto('/app/clients');
        await clientLink(page, 'Acme Studio').click();
        // The profile pane loads lazily; check it once its content is in
        await expect(page.getByRole('region', { name: 'Client profile' }).getByRole('heading', { name: 'Work and billing' })).toBeVisible();
        await expectOnlyKnownAxeViolations(page, 'clientsSplit');
      });

      await step('Enter moves focus into the profile, and the pane shows a focus ring', async () => {
        await clientLink(page, 'Acme Studio').focus();
        await page.keyboard.press('Enter');
        const profile = page.getByRole('region', { name: 'Client profile' });
        await expect(profile).toBeFocused();
        expect(await profile.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
      });

      await step('Check Settings', async () => {
        await page.goto('/app/settings');
        // Theme is a radio group inside Preferences since MUT-139, not a section heading
        await expect(page.getByRole('main').getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
        await expectOnlyKnownAxeViolations(page, 'settings');
      });
    },
  );

  test(`${scheme} mode: the landing page passes axe, colour contrast included`, { tag: '@web.brand.contrast-landing' }, async ({ page, step }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await step('Open the landing page', async () => {
      await page.goto('/');
      await expect(page.locator('#hero-title')).toBeVisible();
    });
    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'landing');
    });
  });
}

/**
 * Serif Display drawn from its 700 file. Some components still ask for
 * semibold (600); Thmanyah ships no 600, so the browser draws those with the
 * Bold file too (ADR-058). MUT-103's sweep moves them to --weight-bold.
 */
async function expectHeadingFace(page: Page, heading: Locator) {
  await expect(heading).toBeVisible();
  const font = await computedFont(heading);
  expect(font.family).toBe('Thmanyah Serif Display');
  expect(Number(font.weight)).toBeGreaterThanOrEqual(600);
  expect(await loadedFaces(page)).toContain('Thmanyah Serif Display 700');
}

for (const language of ['en', 'ar'] as const) {
  test(
    `${language === 'en' ? 'English' : 'Arabic'}: Thmanyah Sans body text, Serif Display 700 headings and Plex Mono tabular amounts, with no font CDN`,
    { tag: '@web.brand.type' },
    async ({ page, step }) => {
      const requests = watchFontRequests(page);
      await logTwoClients(page);
      if (language === 'ar') await switchToArabic(page);

      await step('Open Home: body is Thmanyah Sans at 16px, headings Serif Display 700', async () => {
        await page.goto('/app/');
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        const body = await computedFont(page.locator('body'));
        expect(body).toMatchObject({ family: 'Thmanyah Sans', size: '16px' });
        await expectHeadingFace(page, page.getByRole('heading', { level: 1 }).first());
        await expectHeadingFace(page, page.getByRole('main').getByRole('heading', { level: 2 }).first());
        expect(await loadedFaces(page)).toEqual(
          expect.arrayContaining(['Thmanyah Sans 400', 'Thmanyah Serif Display 700', 'IBM Plex Mono 400']),
        );
      });

      // Plex Mono's digits are all one width, so a figure in it is tabular whatever font-variant-numeric says
      await step('Amounts on Home, Income and Clients are Plex Mono (monospaced, so tabular)', async () => {
        const amounts: [string, Locator][] = [
          ['Home owed now', page.getByTestId('owed-now-amount').first()],
        ];
        for (const [label, amount] of amounts) {
          await expect(amount, label).toBeVisible();
          const font = await computedFont(amount);
          expect(font.stack, label).toContain('IBM Plex Mono');
          expect(font.numeric, label).toContain('tabular-nums');
        }
        await page.goto('/app/income');
        const incomeAmount = page.getByRole('main').getByRole('row').filter({ hasText: 'Logo redesign' }).getByText(/1,200/).first();
        await expect(incomeAmount).toBeVisible();
        expect((await computedFont(incomeAmount)).stack, 'Income row amount').toContain('IBM Plex Mono');
        await page.goto('/app/clients');
        const clientAmount = page.getByRole('main').getByRole('row').filter({ hasText: 'Acme Studio' }).getByText(/1,200/).first();
        await expect(clientAmount).toBeVisible();
        expect((await computedFont(clientAmount)).stack, 'Clients row amount').toContain('IBM Plex Mono');
      });

      await step('Open the landing page: body Thmanyah Sans, the headline and its inner lines Serif Display (TD-048)', async () => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        expect((await computedFont(page.locator('body'))).family).toBe('Thmanyah Sans');
        const headline = page.locator('#hero-title');
        await expectHeadingFace(page, headline);
        const lines = headline.locator('span');
        for (let i = 0; i < (await lines.count()); i++) expect((await computedFont(lines.nth(i))).family).toBe('Thmanyah Serif Display');
        expect(await loadedFaces(page)).toEqual(expect.arrayContaining(['Thmanyah Sans 400', 'Thmanyah Serif Display 700']));
      });

      await step('No font or stylesheet came from another origin', async () => {
        const { offOrigin, fonts } = requests();
        expect(offOrigin).toEqual([]);
        expect(fonts.some((url) => /thmanyahsans-Regular/.test(url))).toBe(true);
      });
    },
  );
}

for (const os of SCHEMES) {
  test(
    `under OS ${os}, the theme toggle's Light, Dark and System each paint the right canvas, and focus shows a ring`,
    { tag: '@web.brand.theme-states' },
    async ({ page, step }) => {
      await page.emulateMedia({ colorScheme: os, reducedMotion: 'reduce' });
      await openFreshApp(page, '/');
      const toggle = page.getByRole('button', { name: /^Theme: / });

      for (const [mode, expected] of [
        ['Light', CANVAS.light],
        ['Dark', CANVAS.dark],
        ['System', CANVAS[os]],
      ] as const) {
        await step(`Toggle to ${mode}`, async () => {
          // Three modes: at most two presses reach any of them
          for (let i = 0; i < 3 && (await toggle.getAttribute('aria-label')) !== `Theme: ${mode}`; i++) await toggle.click();
          await expect(toggle).toHaveAttribute('aria-label', `Theme: ${mode}`);
          await expect.poll(() => rootTokenNumbers(page, '--bg')).toEqual(numbersIn(expected));
        });
      }

      await step('Tab to a button: it shows the focus ring', async () => {
        await page.locator('body').click({ position: { x: 1, y: 1 } });
        let tag = '';
        for (let i = 0; i < 20 && tag !== 'BUTTON'; i++) {
          await page.keyboard.press('Tab');
          tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
        }
        expect(tag).toBe('BUTTON');
        const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
        expect(ring).not.toBe('none');
      });
    },
  );
}

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1280, height: 720 },
] as const;

/**
 * Overflow that predates Brand v2, measured on main (530aec2) before MUT-102.
 * A listed surface is annotated instead of failed; one that stops overflowing
 * is annotated too, so its entry can go.
 */
const KNOWN_OVERFLOW: Record<string, { note: string; maxContentWidth: number }> = {
  // 678px on main; up to 726px with Brand v2's body 16 (Arabic, measured 2026-10-12). Fails if it grows.
  'Income@375': { note: 'TD-083: the Income top bar, status tabs and table are wider than a phone', maxContentWidth: 726 },
  // --drawer-width is 480px: the drawer is 105px wider than the window, same on main
  'Payment drawer@375': { note: 'TD-083: drawers are a fixed 480px (--drawer-width), wider than a phone', maxContentWidth: 480 },
  // MUT-103 baseline, measured on main a48f72d (2026-10-13) before the sweep: opened over Income, so Income's width shows through
  'Income drawer@375': { note: 'TD-083: opens over Income, which is wider than a phone; drawers are a fixed 480px', maxContentWidth: 726 },
};

/** The widest thing sticking out: the page's content width, or a dialog's width. */
async function contentWidth(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(
      document.documentElement.scrollWidth,
      ...[...document.querySelectorAll('[role="dialog"]')].map((d) => Math.round(d.getBoundingClientRect().width)),
    ),
  );
}

async function expectFits(page: Page, surface: string, width: number) {
  const known = KNOWN_OVERFLOW[`${surface}@${width}`];
  if (!known) return expectNoHorizontalOverflow(page, surface);
  const problems = await fitProblems(page);
  const measured = await contentWidth(page);
  expect(measured, `${surface} at ${width}px got wider than its known overflow`).toBeLessThanOrEqual(known.maxContentWidth);
  test.info().annotations.push({
    type: problems.length > 0 ? 'known-overflow' : 'known-overflow-gone',
    description: `${surface} at ${width}px (${measured}px wide): ${known.note}${problems.length > 0 ? ` (${problems.join('; ')})` : ' — fits now; remove from KNOWN_OVERFLOW'}`,
  });
}

/**
 * MUT-103's screen matrix (eng review D4): every core screen in both schemes,
 * both languages, at phone and desktop width. Screenshots are attached per cell
 * for the before/after review; the optional areas are switched on first.
 */
for (const scheme of SCHEMES) {
  for (const viewport of VIEWPORTS) {
    for (const language of ['en', 'ar'] as const) {
      test(
        `${scheme} mode at ${viewport.width}px in ${language === 'en' ? 'English' : 'Arabic'}: Home, Clients, Income, both drawers, Settings, Import, Expenses and Planning fit the window`,
        { tag: '@web.brand.layout' },
        async ({ page, step }) => {
          // Drawers settle at once, so their box is measured where it rests
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
          await logTwoClients(page);
          await enableOptionalArea(page, 'Expenses');
          await enableOptionalArea(page, 'Planning');
          if (language === 'ar') await switchToArabic(page);
          await page.setViewportSize(viewport);
          const shot = (name: string) => attachScreenshot(page, `${scheme}-${viewport.width}-${language}-${name}`);

          await step('Home', async () => {
            await page.goto('/app/');
            await expect(page.getByTestId('owed-now-amount').first()).toBeVisible();
            await expectFits(page, 'Home', viewport.width);
            await shot('home');
          });

          await step('Clients, then a client beside the list', async () => {
            await page.goto('/app/clients');
            await expect(clientLink(page, 'Acme Studio')).toBeVisible();
            await expectFits(page, 'Clients', viewport.width);
            if (viewport.width === 1280) {
              // D5: --table-row-height went 44 -> 48 for a roomier touch target; `height` is a
              // floor on `.data-table td`, so padding alone can't shrink a row back under it.
              const row = page.getByRole('main').getByRole('row').filter({ hasText: 'Acme Studio' });
              expect((await row.boundingBox())!.height, 'Clients row height').toBeGreaterThanOrEqual(48);
            }
            await clientLink(page, 'Acme Studio').click();
            await expect(page.getByRole('heading', { level: 1, name: 'Acme Studio' })).toBeVisible();
            await expectFits(page, 'Client', viewport.width);
            await shot('clients');
          });

          await step('Income, the payment drawer and the income drawer', async () => {
            await page.goto('/app/income');
            await expect(page.getByRole('main').getByText('Logo redesign')).toBeVisible();
            await expectFits(page, 'Income', viewport.width);
            await shot('income');
            await page.getByRole('main').getByText('Logo redesign').click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await expectFits(page, 'Income drawer', viewport.width);
            await shot('income-drawer');
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog')).toBeHidden();
            await page.goto('/app/');
            // The client cell is a link, so the row's one button is Record Payment
            await attentionRow(page, 'Acme Studio', language).getByRole('button').click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await expectFits(page, 'Payment drawer', viewport.width);
            await shot('drawer');
            await page.keyboard.press('Escape');
          });

          await step('Settings and Import', async () => {
            await page.goto('/app/settings');
            await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
            await expectFits(page, 'Settings', viewport.width);
            await shot('settings');
            await page.goto('/app/settings/import');
            await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
            await expectFits(page, 'Import', viewport.width);
            await shot('import');
          });

          await step('Expenses and Planning', async () => {
            await page.goto('/app/expenses');
            await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
            await expectFits(page, 'Expenses', viewport.width);
            await shot('expenses');
            await page.goto('/app/planning');
            await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
            await expectFits(page, 'Planning', viewport.width);
            await shot('planning');
          });
        },
      );
    }
  }
}
