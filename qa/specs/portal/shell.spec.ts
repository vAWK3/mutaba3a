import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { attachScreenshot } from '../../support/brand';
import { OFFICE_A, OFFICE_B, customer, malafatFirm, office, openSignedInPortal } from '../../support/portal';
import { FakeApi, currencyBlock, customerSummary, payment, project, receivable, attachment, uid } from '../../support/portalApi';
import { openYou } from '../../support/you';
import { expectOnlyKnownAxeViolations } from '../../support/axe';

/**
 * The signed-in portal's shell (hosted-portal.md §7.1): Owed (the overview), the
 * four destinations and what sits one level in (MUT-424), the profile switcher and client detail, and the floating
 * chrome (MUT-426: the pill, the You island, the Reports corner icon, page motion). Every /v1 call is answered by
 * the in-memory API in qa/support/portalApi.ts.
 */

const portalI18n = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/hosted/i18n');
const AR_HOSTED = (
  JSON.parse(fs.readFileSync(path.join(portalI18n, 'ar.json'), 'utf8')) as {
    hosted: {
      shell: { sections: string };
      destinations: Record<'owed' | 'paid' | 'spent' | 'clients', string>;
      deeper: Record<'receivables' | 'conversions' | 'documents', { label: string }>;
      conversions: { title: string };
    };
  }
).hosted;
const AR = AR_HOSTED.shell;

const C1 = customer(0).id;
const C2 = customer(1).id;
const C3 = customer(2).id;
/** MUT-424: the four destinations, each page titled with its tab's word. */
const DESTINATIONS = ['Owed', 'Paid', 'Spent', 'Clients'] as const;

function seeded() {
  return new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Nour Accounting'), malafatFirm()],
    clients: 3,
    summary: [
      currencyBlock('ILS', {
        outstanding: '4500.00',
        overdue: '1200.00',
        proposed: '800.00',
        customers: [
          { customerId: C3, outstanding: '0.00', overdue: '0.00', lastPaymentOn: '2026-09-01', status: 'SETTLED' },
          { customerId: C2, outstanding: '3300.00', overdue: '0.00', lastPaymentOn: '2026-10-02', status: 'OUTSTANDING' },
          { customerId: C1, outstanding: '1200.00', overdue: '1200.00', status: 'OVERDUE' },
        ],
      }),
      currencyBlock('USD', { outstanding: '950.00', overdue: '0.00', customers: [{ customerId: C2, outstanding: '950.00', overdue: '0.00', status: 'OUTSTANDING' }] }),
    ],
  });
}

test('signed in, the portal opens on Owed for the first profile, and each of the four destinations is one click away', { tag: '@portal.shell.navigate' }, async ({ page, step }) => {
  const api = seeded();

  await step('Open the portal signed in', async () => {
    await api.open(page, '/');
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
  });

  await step('The overview shows what is owed, overdue and proposed, overdue clients first', async () => {
    const strip = page.getByRole('group', { name: 'ILS' });
    await expect(strip).toContainText('Owed');
    await expect(strip).toContainText('4,500.00');
    await expect(strip).toContainText('1,200.00');
    await expect(strip).toContainText('800.00');
    await expect(page.getByText(/^As of /)).toBeVisible();
    const rows = page.getByRole('table', { name: 'Owed' }).getByRole('row');
    await expect(rows.nth(1)).toContainText('Client 1');
    await expect(rows.nth(1)).toContainText('Overdue');
    await expect(rows.nth(2)).toContainText('Client 2');
    await expect(rows.nth(3)).toContainText('Client 3');
  });

  await step('Screenshot the shell, for the spacing review (MUT-165 D9)', async () => {
    await attachScreenshot(page, 'portal-shell-overview-en');
  });

  await step('Switch the overview to USD', async () => {
    await page.getByRole('tab', { name: 'USD' }).click();
    await expect(page).toHaveURL(/currency=USD/);
    await expect(page.getByRole('group', { name: 'USD' })).toContainText('950.00');
    await expect(page.getByRole('table', { name: 'Owed' }).getByRole('row')).toHaveCount(2);
  });

  await step('Visit each of the four destinations from the pill', async () => {
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav.getByRole('link')).toHaveText([...DESTINATIONS]);
    for (const destination of DESTINATIONS) {
      await nav.getByRole('link', { name: destination, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: destination })).toBeVisible();
      await expect(nav.getByRole('link', { name: destination, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  await step('Choose عربي on You › App, then go back to Conversions: the shell turns right to left, in the portal’s Arabic', async () => {
    await openYou(page, 'app');
    await page.getByRole('main').getByRole('button', { name: 'عربي' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const nav = page.getByRole('navigation', { name: AR.sections });
    await expect(nav.getByRole('link', { name: AR_HOSTED.destinations.clients, exact: true })).toBeVisible();
    await nav.getByRole('link', { name: AR_HOSTED.destinations.paid, exact: true }).click();
    await page.getByRole('link', { name: new RegExp(`^${AR_HOSTED.deeper.conversions.label}`) }).click();
    await expect(page.getByRole('heading', { level: 1, name: AR_HOSTED.conversions.title })).toBeVisible();
    await attachScreenshot(page, 'portal-shell-conversions-ar');
  });

  await step('Every figure came from this profile', async () => {
    const profileCalls = api.log.filter((call) => call.path !== '/v1/me' && !call.path.startsWith('/v1/me/'));
    expect(profileCalls.length).toBeGreaterThan(0);
    for (const call of profileCalls) expect(call.headers['x-mutaba3a-profile']).toBe(OFFICE_A);
  });
});

/** MUT-424: [destination, its one-level-in row, the page it opens, that page's path]. */
const ONE_LEVEL_IN = [
  ['Owed', 'Receivables', 'Receivables', 'receivables'],
  ['Paid', 'Currency conversions', 'Conversions', 'conversions'],
  ['Clients', 'Documents', 'Documents', 'documents'],
] as const;

test('from Owed, Paid and Clients, Receivables, Conversions and Documents are one link away, and each links back', { tag: '@portal.shell.one-level-in' }, async ({ page, step }) => {
  const api = seeded();
  const nav = page.getByRole('navigation', { name: 'Sections' });
  const main = page.getByRole('main');

  await step('Open the portal signed in', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
  });

  for (const [destination, row, title, segment] of ONE_LEVEL_IN) {
    await step(`From ${destination}, open ${row}: ${destination} stays lit`, async () => {
      await nav.getByRole('link', { name: destination, exact: true }).click();
      await page.getByRole('navigation', { name: `More in ${destination}` }).getByRole('link', { name: new RegExp(`^${row}`) }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/${segment}$`));
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(nav.getByRole('link', { name: destination, exact: true })).toHaveAttribute('aria-current', 'page');
    });

    await step(`Go back to ${destination} from the page's own link`, async () => {
      await main.getByRole('link', { name: destination, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: destination })).toBeVisible();
    });
  }

  await step('A deep link to Receivables lights Owed, in Arabic too', async () => {
    await api.open(page, `/p/${OFFICE_A}/receivables`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const arNav = page.getByRole('navigation', { name: AR.sections });
    await expect(arNav.getByRole('link', { name: AR_HOSTED.destinations.owed, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(main.getByRole('link', { name: AR_HOSTED.destinations.owed, exact: true })).toBeVisible();
    await attachScreenshot(page, 'portal-shell-receivables-ar');
  });
});

test('switching profile from You › Profiles keeps the section, and a profile that is not yours says so', { tag: '@portal.shell.switch-profile' }, async ({ page, step }) => {
  const api = seeded();

  await step('Open Payments on Nour Studio', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await expect(page.getByRole('heading', { level: 1, name: 'Paid' })).toBeVisible();
  });

  const main = page.getByRole('main');
  await step('Open You › Profiles from the profile name: each profile with what kind it is, and the local-profiles footer', async () => {
    await openYou(page, 'profiles');
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/you\\?from=payments$`));
    await expect(main.getByRole('button', { name: /Nour Studio/ })).toHaveAttribute('aria-current', 'true');
    await expect(main.getByRole('button', { name: /Nour Accounting/ })).toContainText('Business');
    await expect(main.getByRole('button', { name: /Haddad & Partners/ })).toContainText('Income recorded by Malafat');
    await expect(main).toContainText('Your local profiles stay in the MTB3A app on your device.');
  });

  await step('Switch to Nour Accounting: back on Payments, now for that profile', async () => {
    await main.getByRole('button', { name: /Nour Accounting/ }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}/payments$`));
    await expect(page.getByRole('link', { name: 'You · Nour Accounting' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Paid' })).toBeVisible();
    await expect.poll(() => api.last('GET', /^\/v1\/payments$/)?.headers['x-mutaba3a-profile']).toBe(OFFICE_B);
  });

  await step('Open a profile id that is not on the account', async () => {
    await page.goto(`/p/${uid(0x5, 1)}/clients`);
    await expect(page.getByRole('heading', { name: "This profile isn't available" })).toBeVisible();
  });

  await step('Go to the first profile from there', async () => {
    await page.getByRole('button', { name: 'Go to Nour Studio' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
  });
});

test('a client opens to its summary and matters, then its own receivables, payments and documents', { tag: '@portal.shell.client-detail' }, async ({ page, step }) => {
  const logo = project(1, C1, 'Logo redesign');
  const site = project(2, C1, 'Website');
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio')],
    clients: 2,
    projects: [logo, site, project(3, C2, 'Other client matter')],
    summary: [currencyBlock('ILS', { outstanding: '1200.00', overdue: '1200.00', customers: [{ customerId: C1, outstanding: '1200.00', overdue: '1200.00', status: 'OVERDUE' }] })],
    customerSummaries: [
      customerSummary(C1, {
        currency: 'ILS',
        outstanding: '1200.00',
        overdue: '1200.00',
        lastPaymentOn: '2026-09-20',
        status: 'OVERDUE',
        matters: [
          { projectId: logo.id, agreed: '3000.00', posted: '3000.00', paid: '1800.00', outstanding: '1200.00', status: 'OVERDUE' },
          { projectId: site.id, agreed: '2000.00', posted: '2000.00', paid: '2000.00', outstanding: '0.00', status: 'PAID_IN_FULL' },
        ],
      }),
    ],
    receivables: [
      receivable(1, { customerId: C1, projectId: logo.id, gross: '1200.00', status: 'OVERDUE', origin: 'INSTALLMENT', dueDate: '2026-09-30' }),
      receivable(2, { customerId: C2, gross: '300.00' }),
    ],
    payments: [payment(1, { customerId: C1, amount: '1800.00', number: 'PAY-0101' }), payment(2, { customerId: C2, amount: '50.00', number: 'PAY-0202' })],
    attachments: [attachment(1, { filename: 'invoice-logo.pdf', customerId: C1, invoiceNumber: 'INV-7' }), attachment(2, { filename: 'other.pdf', customerId: C2 })],
  });

  await step('Open Clients and choose Client 1', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await page.getByRole('link', { name: 'Client 1' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Client 1' })).toBeVisible();
  });

  await step('The summary shows the last payment, the ILS figures and each matter', async () => {
    await expect(page.getByText('Last payment: Sep 20, 2026')).toBeVisible();
    const strip = page.getByRole('group', { name: 'ILS' });
    await expect(strip).toContainText('Outstanding');
    await expect(strip).toContainText('1,200.00');
    await expect(strip).toContainText('Overdue');
    const matters = page.getByRole('table', { name: 'Matters' });
    await expect(matters.getByRole('row', { name: /Logo redesign/ })).toContainText('Overdue');
    await expect(matters.getByRole('row', { name: /Website/ })).toContainText('Paid in full');
  });

  await step('Receivables tab: only this client’s, with no client column', async () => {
    await page.getByRole('tab', { name: 'Receivables' }).click();
    await expect(page).toHaveURL(/tab=receivables/);
    const table = page.getByRole('table', { name: 'Receivables' });
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Logo redesign');
    await expect(table.getByRole('columnheader', { name: 'Client' })).toHaveCount(0);
    expect(api.last('GET', /^\/v1\/receivables$/)?.query.get('customerId')).toBe(C1);
  });

  await step('Payments tab: this client’s payments', async () => {
    await page.getByRole('tab', { name: 'Payments' }).click();
    const table = page.getByRole('table', { name: 'Payments' });
    await expect(table).toContainText('PAY-0101');
    await expect(table).not.toContainText('PAY-0202');
  });

  await step('Documents tab: this client’s documents', async () => {
    await page.getByRole('tab', { name: 'Documents' }).click();
    const table = page.getByRole('table', { name: 'Documents' });
    await expect(table).toContainText('invoice-logo.pdf');
    await expect(table).not.toContainText('other.pdf');
  });

  await step('Back to All clients', async () => {
    await page.getByRole('link', { name: 'All clients' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  });
});

test('an account with no profile yet is offered New profile and Sign out', { tag: '@portal.shell.no-profiles' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [] });

  await step('Sign in to an account with no profile', async () => {
    await api.open(page, '/');
    await expect(page.getByRole('heading', { name: "You don't have a profile yet" })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
  });

  await step('New profile opens the New profile drawer', async () => {
    await page.getByRole('main').getByRole('button', { name: '+ New profile' }).click();
    await expect(page.getByRole('dialog', { name: 'New profile' })).toBeVisible();
    await expect(page).toHaveURL(/newProfile=true/);
  });

  await step('Back closes it; Sign out is there beside it', async () => {
    await page.goBack();
    await expect(page.getByRole('dialog', { name: 'New profile' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});

test('once firm features are on, the Overview shows one note that Dismiss keeps gone, in English and Arabic', { tag: '@portal.shell.firm-enabled-banner' }, async ({ page, step }) => {
  const TEXT = "Firm features are on for Khatib Law. New tools show up here as they're released.";
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Khatib Law'), firm: true }, { ...office(OFFICE_B, 'Sader Office'), firm: true }] });

  await step('Sign in to the firm profile: the Overview shows the note', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await expect(page.getByRole('heading', { name: 'Owed' })).toBeVisible();
    await expect(page.getByRole('note').filter({ hasText: TEXT })).toBeVisible();
  });

  await step('Dismiss it', async () => {
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText(TEXT)).toHaveCount(0);
  });

  await step('Reload the portal: it stays gone', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Owed' })).toBeVisible();
    await expect(page.getByText(TEXT)).toHaveCount(0);
  });

  await step('In Arabic, on the other firm profile: right to left, and the note in Arabic', async () => {
    await api.open(page, `/p/${OFFICE_B}`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('note').filter({ hasText: 'ميزات المكتب مفعّلة لملف Sader Office' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إغلاق' })).toBeVisible();
  });
});

/** The logotype's mask file, in the dev server (/src/assets/…) or a build (/assets/wordmark-<hash>.svg). */
const WORDMARK_FILE = /\/wordmark[^/]*\.svg$/;

test('sign-in, the tab title and You › App name the product MTB3A in English and متابعة in Arabic', { tag: '@portal.shell.mtb3a-name' }, async ({ page, step }) => {
  const wordmarkFetches: string[] = [];
  page.on('request', (request) => {
    if (WORDMARK_FILE.test(new URL(request.url()).pathname)) wordmarkFetches.push(request.url());
  });

  await step('Open sign-in in English on a cold load: a 40px mark with the MTB3A logotype, fetched once', async () => {
    await page.route('**/v1/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) }));
    await page.addInitScript(() => {
      if (localStorage.getItem('mutaba3a-portal-language') === null) localStorage.setItem('mutaba3a-portal-language', 'en');
    });
    await page.goto('/sign-in');
    const lockup = page.locator('.hp-wordmark');
    await expect(lockup.getByRole('img', { name: 'MTB3A' })).toBeVisible();
    await expect(lockup.locator('img')).toHaveAttribute('width', '40');
    await expect(page).toHaveTitle('MTB3A');
    await page.waitForLoadState('networkidle');
    // The preload is used, not fetched a second time (eng re-run R3); Chromium only (R6)
    expect(wordmarkFetches).toHaveLength(1);
    const initiators = await page.evaluate(() =>
      performance.getEntriesByType('resource').filter((entry) => /\/wordmark[^/]*\.svg$/.test(new URL(entry.name).pathname)).map((entry) => (entry as PerformanceResourceTiming).initiatorType),
    );
    expect(initiators).toEqual(['link']);
    await attachScreenshot(page, 'mtb3a-signin-en');
  });

  await step('In forced colours (high contrast) the logotype is the page text’s colour, and the mark has a ring', async () => {
    await page.emulateMedia({ forcedColors: 'active' });
    const colours = await page.locator('.hp-wordmark').evaluate((lockup) => ({
      logotype: getComputedStyle(lockup.querySelector('.logotype')!).backgroundColor,
      text: getComputedStyle(document.querySelector('h1')!).color,
      ring: getComputedStyle(lockup.querySelector('.wordmark-mark')!).outlineStyle,
    }));
    expect(colours.logotype).toBe(colours.text);
    expect(colours.ring).toBe('solid');
    await attachScreenshot(page, 'mtb3a-signin-en-forced-colors');
    await page.emulateMedia({ forcedColors: 'none' });
  });

  await step('Switch to Arabic: متابعة as live text, no logotype, and the tab follows', async () => {
    await page.getByRole('button', { name: 'عربي' }).click();
    await expect(page.locator('.hp-wordmark .brand-name-ar')).toHaveText('متابعة');
    await expect(page.getByRole('img', { name: 'MTB3A' })).toHaveCount(0);
    await expect(page).toHaveTitle('متابعة');
    await attachScreenshot(page, 'mtb3a-signin-ar');
  });

  await step('Sign in at desktop width: the chrome has no wordmark, the tab says MTB3A, and You › App shows a 32px mark', async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openSignedInPortal(page, { profiles: [office(OFFICE_A, 'Sader Office')], path: '/' });
    await expect(page.locator('.hp-chrome .hp-wordmark')).toHaveCount(0);
    await expect(page).toHaveTitle('MTB3A');
    await openYou(page, 'app');
    const lockup = page.locator('.hp-you-wordmark');
    await expect(lockup.getByRole('img', { name: 'MTB3A' })).toBeVisible();
    await expect(lockup.locator('img')).toHaveAttribute('width', '32');
    await attachScreenshot(page, 'mtb3a-you-app-en');
  });
});

/* ---------- MUT-426: the floating chrome ---------- */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };
const NARROW = { width: 320, height: 640 };
type Box = { x: number; y: number; width: number; height: number };
const boxOf = async (page: Page, selector: string): Promise<Box> => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box;
};
/** The edge offset of the chrome's objects (--hp-chrome-gap = --space-4). */
const GAP = 16;
const NEAR = 2;

function crowded() {
  return new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), office(OFFICE_B, 'Nour Accounting')], clients: 40 });
}

async function noSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test('the pill, the You island and Reports float over the page at every width, mirrored in Arabic, with no sidebar or header bar', { tag: '@portal.shell.floating-chrome' }, async ({ page, step }) => {
  const api = crowded();

  await step('On a desktop, Reports is top start, the pill top centre and the island top end', async () => {
    await page.setViewportSize(DESKTOP);
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    expect(await page.evaluate(() => ({ aside: document.querySelectorAll('aside').length, bars: [...document.querySelectorAll('header')].filter((h) => !h.closest('main')).length }))).toEqual({ aside: 0, bars: 0 });
    const [reports, pill, island] = [await boxOf(page, '.hp-reports'), await boxOf(page, '.hp-pill'), await boxOf(page, '.hp-island')];
    expect(Math.abs(reports.x - GAP)).toBeLessThan(NEAR);
    expect(Math.abs(pill.x + pill.width / 2 - DESKTOP.width / 2)).toBeLessThan(NEAR);
    expect(Math.abs(DESKTOP.width - GAP - (island.x + island.width))).toBeLessThan(NEAR);
    for (const box of [reports, pill, island]) expect(Math.abs(box.y - GAP)).toBeLessThan(NEAR);
    await attachScreenshot(page, 'portal-chrome-desktop-en');
  });

  await step('Scrolled, the list runs under the glass and the page stays axe-clean', async () => {
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expectOnlyKnownAxeViolations(page, 'portalSignedIn');
    await attachScreenshot(page, 'portal-chrome-desktop-scrolled-en');
  });

  await step('In dark mode the glass and the ring keep their contrast', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectOnlyKnownAxeViolations(page, 'portalSignedIn');
    await attachScreenshot(page, 'portal-chrome-desktop-dark');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  await step('In Arabic on a desktop, Reports and the island swap sides', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const [reports, island] = [await boxOf(page, '.hp-reports'), await boxOf(page, '.hp-island')];
    expect(Math.abs(DESKTOP.width - GAP - (reports.x + reports.width))).toBeLessThan(NEAR);
    expect(Math.abs(island.x - GAP)).toBeLessThan(NEAR);
    await attachScreenshot(page, 'portal-chrome-desktop-ar');
  });

  await step('On a 375px phone, the pill and the island circle sit at the bottom and Reports at the top end', async () => {
    await page.setViewportSize(PHONE);
    await api.open(page, `/p/${OFFICE_A}/clients`);
    const [reports, pill, island] = [await boxOf(page, '.hp-reports'), await boxOf(page, '.hp-pill'), await boxOf(page, '.hp-island')];
    expect(Math.abs(PHONE.width - GAP - (reports.x + reports.width))).toBeLessThan(NEAR);
    expect(Math.abs(reports.y - GAP)).toBeLessThan(NEAR);
    expect(Math.abs(PHONE.height - GAP - (pill.y + pill.height))).toBeLessThan(island.height);
    expect(island.x).toBeGreaterThan(pill.x + pill.width - NEAR);
    await expect(page.locator('.hp-island-name')).toBeHidden();
    await expect(page.locator('.hp-island')).toHaveAttribute('aria-label', 'You · Nour Studio');
    expect(await noSidewaysScroll(page)).toBe(true);
    await attachScreenshot(page, 'portal-chrome-phone-en');
  });

  await step('Typing in the page search hides the bottom bar for the keyboard; leaving the field brings it back', async () => {
    const bar = page.locator('.hp-chrome-bar');
    await page.locator('.hp-page .hp-search input').focus();
    await expect(bar).toBeHidden();
    await page.locator('.hp-page .hp-search input').blur();
    await expect(bar).toBeVisible();
  });

  await step('In Arabic on the phone, Reports moves to the top start and the island to the pill’s left', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`, 'ar');
    const [reports, pill, island] = [await boxOf(page, '.hp-reports'), await boxOf(page, '.hp-pill'), await boxOf(page, '.hp-island')];
    expect(Math.abs(reports.x - GAP)).toBeLessThan(NEAR);
    expect(island.x + island.width).toBeLessThan(pill.x + NEAR);
    await attachScreenshot(page, 'portal-chrome-phone-ar');
  });

  for (const language of ['en', 'ar'] as const) {
    await step(`At 320px in ${language === 'en' ? 'English' : 'Arabic'}, nothing scrolls sideways and no tab label is cut`, async () => {
      await page.setViewportSize(NARROW);
      await api.open(page, `/p/${OFFICE_A}/clients`, language);
      expect(await noSidewaysScroll(page)).toBe(true);
      const cut = await page.locator('.hp-pill a').evaluateAll((links) => links.filter((link) => link.scrollWidth > link.clientWidth).map((link) => link.textContent));
      expect(cut).toEqual([]);
      const bar = await boxOf(page, '.hp-chrome-bar');
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(NARROW.width);
      await attachScreenshot(page, `portal-chrome-320-${language}`);
    });
  }
});

test('the You island names the profile, opens You › Profiles lit, and a second press returns to the exact page', { tag: '@portal.shell.island' }, async ({ page, step }) => {
  const api = seeded();
  const island = page.locator('.hp-island');

  await step('Open a client: the island shows the profile name and its ring', async () => {
    await page.setViewportSize(DESKTOP);
    await api.open(page, `/p/${OFFICE_A}/clients/${C1}`);
    await expect(page.locator('.hp-island-name')).toHaveText('Nour Studio');
    // The outer 4px ring is a profile colour (a --profile-ring-* token), not the neutral one
    expect(await page.locator('.hp-island-avatar').evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/oklch\([^)]+\) 0px 0px 0px 4px$/);
    await expect(island).not.toHaveAttribute('aria-current', 'page');
  });

  await step('Press the island: You › Profiles opens and the island is lit', async () => {
    await island.click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/you\\?from=clients&back=`));
    await expect(island).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('nav.hp-section-tabs--segmented').getByRole('link').first()).toHaveAttribute('aria-current', 'page');
    await attachScreenshot(page, 'portal-island-on-en');
  });

  await step('Press it again: back on that client, not the Clients list', async () => {
    await island.click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/clients/${C1}$`));
    await expect(island).not.toHaveAttribute('aria-current', 'page');
  });

  await step('Open You again, then leave it from a tab', async () => {
    await island.click();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Paid', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/payments$`));
    await expect(island).not.toHaveAttribute('aria-current', 'page');
  });

  await step('From Reports, switching profile lands on the other profile’s Reports', async () => {
    await page.locator('.hp-reports').click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}/reports$`));
    await expect(page.locator('.hp-reports')).toHaveAttribute('aria-current', 'page');
    await openYou(page, 'profiles');
    await page.getByRole('main').getByRole('button', { name: /Nour Accounting/ }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}/reports$`));
  });
});

/**
 * The view transitions the router starts, read in the page: the type it named and the animation on the incoming
 * page's snapshot (`::view-transition-new(root)`). jsdom has no view transitions, so this is the motion's proof (D6).
 */
async function watchViewTransitions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { types: string[]; incoming: string[] }[] = [];
    (window as unknown as { __qaVt: typeof log }).__qaVt = log;
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((arg: StartViewTransitionOptions | ViewTransitionUpdateCallback) => {
      const transition = start(arg as StartViewTransitionOptions);
      const entry = { types: typeof arg === 'object' && arg.types ? [...arg.types] : [], incoming: [] as string[] };
      log.push(entry);
      void transition.ready.then(() => {
        entry.incoming = document
          .getAnimations()
          .filter((animation) => (animation.effect as KeyframeEffect | null)?.pseudoElement === '::view-transition-new(root)')
          .map((animation) => (animation as CSSAnimation).animationName);
      });
      return transition;
    }) as typeof document.startViewTransition;
  });
}

const transitions = (page: Page) => page.evaluate(() => (window as unknown as { __qaVt: { types: string[]; incoming: string[] }[] }).__qaVt);
const lastTransition = async (page: Page) => {
  await expect.poll(async () => (await transitions(page)).at(-1)?.incoming.length ?? 0).toBeGreaterThan(0);
  return (await transitions(page)).at(-1);
};

test('pages slide by depth, mirrored in Arabic, the You page grows from the island, and reduced motion cross-fades', { tag: '@portal.shell.page-motion' }, async ({ page, step }) => {
  const api = seeded();
  await watchViewTransitions(page);
  const nav = page.getByRole('navigation', { name: 'Sections' });

  await step('Open Owed: the browser takes view-transition types, as the router checks them', async () => {
    await page.setViewportSize(DESKTOP);
    await api.open(page, `/p/${OFFICE_A}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
    expect(await page.evaluate(() => [CSS.supports('selector(:active-view-transition-type(a))'), CSS.supports('selector(:active-view-transition-type(a)')])).toEqual([true, true]);
  });

  await step('Owed → Receivables slides forward, in from the inline end', async () => {
    await page.getByRole('navigation', { name: 'More in Owed' }).getByRole('link', { name: /^Receivables/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Receivables' })).toBeVisible();
    expect(await lastTransition(page)).toEqual({ types: ['forward'], incoming: ['hp-vt-in-from-right'] });
  });

  await step('Its back link slides the other way', async () => {
    await page.getByRole('main').getByRole('link', { name: 'Owed', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
    expect(await lastTransition(page)).toEqual({ types: ['back'], incoming: ['hp-vt-in-from-left'] });
  });

  await step('Tab to tab cross-fades', async () => {
    await nav.getByRole('link', { name: 'Paid', exact: true }).click();
    expect(await lastTransition(page)).toEqual({ types: ['fade'], incoming: ['hp-vt-fade-in'] });
  });

  await step('The You page grows out of the island', async () => {
    await page.locator('.hp-island').click();
    expect(await lastTransition(page)).toEqual({ types: ['island'], incoming: ['hp-vt-grow-from-right'] });
  });

  await step('Opening a drawer starts no transition: drawers never fade the page', async () => {
    await page.locator('nav.hp-section-tabs--segmented').getByRole('link').nth(1).click();
    const before = (await transitions(page)).length;
    await page.getByRole('button', { name: /^Billing/ }).click();
    await expect(page.getByRole('dialog', { name: 'Billing' })).toBeVisible();
    expect((await transitions(page)).length).toBe(before);
    await page.keyboard.press('Escape');
  });

  await step('In Arabic, forward comes in from the left and back from the right', async () => {
    await api.open(page, `/p/${OFFICE_A}`, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator(`a[href="/p/${OFFICE_A}/receivables"]`).first().click();
    expect(await lastTransition(page)).toEqual({ types: ['forward'], incoming: ['hp-vt-in-from-left'] });
    await page.getByRole('main').getByRole('link', { name: AR_HOSTED.destinations.owed, exact: true }).click();
    expect(await lastTransition(page)).toEqual({ types: ['back'], incoming: ['hp-vt-in-from-right'] });
  });

  await step('With reduced motion, the same move only cross-fades', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await api.open(page, `/p/${OFFICE_A}`);
    await page.locator(`a[href="/p/${OFFICE_A}/receivables"]`).first().click();
    expect(await lastTransition(page)).toEqual({ types: ['forward'], incoming: ['hp-vt-fade-in'] });
  });
});

test('with reduced transparency the pill and the island are solid, with no blur', { tag: '@portal.shell.reduced-transparency' }, async ({ page, step }) => {
  const api = seeded();
  const glass = () => page.locator('.hp-pill').evaluate((el) => ({ filter: getComputedStyle(el).backdropFilter, background: getComputedStyle(el).backgroundColor }));
  /** The alpha of a computed colour, in any notation: `… / 0.74)` or rgba's fourth value; 1 when it has none. */
  const alphaOf = (color: string) => {
    const slash = /\/\s*([\d.]+)\)$/.exec(color);
    if (slash) return Number(slash[1]);
    const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(color);
    return rgba ? Number(rgba[1]) : 1;
  };

  await step('By default the pill is glass: blurred and see-through', async () => {
    await page.setViewportSize(DESKTOP);
    await api.open(page, `/p/${OFFICE_A}`);
    const { filter, background } = await glass();
    expect(filter).toContain('blur');
    expect(alphaOf(background)).toBeLessThan(1);
  });

  await step('Ask for reduced transparency (Chromium, through the DevTools protocol): solid, no blur', async () => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await expect.poll(async () => (await glass()).filter).toBe('none');
    expect(alphaOf((await glass()).background)).toBe(1);
    await attachScreenshot(page, 'portal-chrome-reduced-transparency');
  });
});

test('the keyboard meets Reports, the four tabs, then the island, each with a visible focus ring', { tag: '@portal.shell.keyboard' }, async ({ page, step }) => {
  const api = seeded();
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { name: el?.getAttribute('aria-label') ?? el?.textContent ?? '', current: el?.getAttribute('aria-current') ?? null, ring: el ? getComputedStyle(el).boxShadow : 'none' };
    });

  await step('Tab from the top of Payments', async () => {
    await page.setViewportSize(DESKTOP);
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await expect(page.getByRole('heading', { level: 1, name: 'Paid' })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const now = await focused();
      expect(now.ring, `${now.name} shows a focus ring`).not.toBe('none');
      seen.push(now);
    }
    expect(seen.map((item) => item.name)).toEqual(['Reports', 'Owed', 'Paid', 'Spent', 'Clients', 'You · Nour Studio']);
    expect(seen.map((item) => item.current)).toEqual([null, null, 'page', null, null, null]);
  });

  await step('Enter on the island opens You, where the island is aria-current', async () => {
    await page.keyboard.press('Enter');
    await expect(page.locator('.hp-island')).toHaveAttribute('aria-current', 'page');
  });
});
