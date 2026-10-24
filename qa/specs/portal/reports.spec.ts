import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { OFFICE_A, OFFICE_B, customer, office } from '../../support/portal';
import { FakeApi, category, expense, payment, todayInJerusalem, type FakeApiSeed, type StubReportRecords } from '../../support/portalApi';

/**
 * Reports (MUT-175): the hero, Lately, the chart and the lists, the ≈ total,
 * stepping through time, the All-profiles switch and its failures, Arabic on a
 * phone, and signed out. The fake API answers GET /v1/summaries/activity from
 * each profile's records the way the server does (qa/support/portalApi.ts);
 * dates are relative to today, so the stages read the same on any day.
 */

const TODAY = todayInJerusalem();
const THIS_MONTH = TODAY.slice(0, 7);
const month = (offset: number) => {
  const d = new Date(`${THIS_MONTH}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
};
/** Day `day` of the month `offset` months from this one. */
const on = (offset: number, day: number) => `${month(offset)}-${String(day).padStart(2, '0')}`;
const monthName = (m: string, year = false) => new Intl.DateTimeFormat('en-US', { month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const sameYear = (m: string) => m.slice(0, 4) === TODAY.slice(0, 4);
const named = (m: string) => monthName(m, !sameYear(m));

const food = category(1, 'Food');
const client = customer(0);
const reportsPath = (profile = OFFICE_A) => `/p/${profile}/reports`;
/** Text without the bidi isolates that keep names and amounts whole inside a sentence. */
const plain = (text: string) => text.replace(/[⁦-⁩]/g, '');

const thisMonth = (): StubReportRecords => ({
  payments: [payment(1, { customerId: client.id, amount: '1500.00', receivedOn: on(0, 1) })],
  expenses: [expense(1, { amount: '400.00', categoryId: food.id, occurredOn: on(0, 1) })],
});

/** Records since three months back: Food rises from 100 to 300 between the two latest complete months. */
const threeMonths = (): StubReportRecords => ({
  payments: [
    payment(1, { customerId: client.id, amount: '1000.00', receivedOn: on(-3, 1) }),
    payment(2, { customerId: client.id, amount: '1200.00', receivedOn: on(-2, 4) }),
    payment(3, { customerId: client.id, amount: '900.00', receivedOn: on(-1, 4) }),
    payment(4, { customerId: client.id, amount: '1500.00', receivedOn: on(0, 1) }),
  ],
  expenses: [expense(1, { amount: '100.00', categoryId: food.id, occurredOn: on(-2, 4) }), expense(2, { amount: '300.00', categoryId: food.id, occurredOn: on(-1, 4) })],
  daysToPaid: { samples: [11, 12, 13] },
});

function world(seed: Partial<FakeApiSeed> = {}) {
  return new FakeApi({ profiles: [office(OFFICE_A, 'Personal')], clients: 1, categories: [food], ...seed });
}

async function openReports(page: Page, api: FakeApi, language: 'en' | 'ar' = 'en', path = reportsPath()) {
  await api.open(page, path, language);
  await expect(page.getByRole('heading', { level: 1, name: language === 'ar' ? 'التقارير' : 'Reports' })).toBeVisible();
}

const hero = (page: Page) => page.getByRole('region', { name: 'Reports' });

test('With no records, Reports is one block that starts the first payment or expense', { tag: '@portal.reports.first-run' }, async ({ page, step }) => {
  const api = world({ reports: { [OFFICE_A]: { payments: [], expenses: [] } } });

  await step('Open Reports on a profile with no payments or expenses', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Reports' }).click();
  });

  await step('One block invites the first payment or expense, with nothing else around it', async () => {
    await expect(page.getByRole('heading', { name: 'Your reports start with your first payment or expense' })).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Add income' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record expense' })).toBeVisible();
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(page.locator('.hp-teaser')).toHaveCount(0);
  });
});

test('In the first month Received heads the page, then Spent, Kept, Owed now, the chart and a teaser', { tag: '@portal.reports.first-month' }, async ({ page, step }) => {
  const api = world({ reports: { [OFFICE_A]: thisMonth() } });

  await step('Log a payment and an expense this month, then open Reports', async () => {
    await openReports(page, api);
  });

  await step('Received is the anchor figure, Spent and Kept beside it in whole units', async () => {
    await expect(hero(page).locator('.hp-report-received .sr-only')).toHaveText('₪1,500');
    await expect(hero(page).locator('.hp-report-pair .sr-only')).toHaveText(['₪400', '₪1,100']);
    await expect(hero(page)).toContainText(`${monthName(THIS_MONTH, true)} · so far`);
    await expect(page.getByText(/Owed to you now/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/billed/i);
  });

  await step('Received and spent are drawn per day, the days still to come faint', async () => {
    const chart = page.getByRole('group', { name: 'Received and spent per day. Arrow keys move between days.' });
    await expect(chart).toBeVisible();
    await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();
    const daysLeft = new Date(Date.UTC(Number(THIS_MONTH.slice(0, 4)), Number(THIS_MONTH.slice(5, 7)), 0)).getUTCDate() - Number(TODAY.slice(8, 10));
    await expect(chart.locator('.hp-daybar-future')).toHaveCount(daysLeft);
  });

  await step('The teaser names next month, and Year says when it unlocks', async () => {
    await expect(page.locator('.hp-teaser')).toContainText(`Your first monthly recap arrives in ${named(month(1))}.`);
    const year = page.getByRole('radio', { name: 'Year' });
    await expect(year).toHaveAttribute('aria-disabled', 'true');
    await expect(year).toHaveAttribute('aria-description', `Unlocks in ${named(month(2))}`);
  });
});

test('With two complete months, Lately lists up to three insights and Year opens', { tag: '@portal.reports.third-month' }, async ({ page, step }) => {
  const api = world({ reports: { [OFFICE_A]: threeMonths() } });

  await step('Open Reports on a profile with records since three months back', async () => {
    await openReports(page, api);
  });

  await step('Lately: the category mover, client concentration, then days to get paid', async () => {
    const lately = page.locator('section', { has: page.getByRole('heading', { name: 'Lately' }) });
    await expect(lately.getByRole('listitem')).toHaveCount(3);
    const items = (await lately.getByRole('listitem').allTextContents()).map(plain);
    expect(items).toEqual([
      `Food: ₪300.00 in ${named(month(-1))}, ₪200.00 more than ${named(month(-2))}.`,
      'Client 1 paid 100% of what you received in the last 3 months.',
      'Clients typically pay in full 12 days after you log what they owe.',
    ]);
  });

  await step('Year can be chosen', async () => {
    const year = page.getByRole('radio', { name: 'Year' });
    await expect(year).not.toHaveAttribute('aria-disabled', 'true');
    await year.click();
    await expect(page.getByRole('group', { name: 'Received and spent per month. Arrow keys move between months.' })).toBeVisible();
  });
});

test('Two currencies make one ≈ total at today\'s rate, and the exact amounts are one tap away', { tag: '@portal.reports.converted-breakdown' }, async ({ page, step }) => {
  const records = thisMonth();
  records.payments.push(payment(2, { customerId: client.id, amount: '100.00', currency: 'USD', receivedOn: on(0, 1) }));
  const api = world({ reports: { [OFFICE_A]: records } });

  await step('Receive ILS and USD this month and open Reports', async () => {
    await openReports(page, api);
  });

  const trigger = page.getByRole('button', { name: /≈/ });
  await step('Received reads ≈ in ILS at today\'s rate', async () => {
    // 1,500 ILS + 100 USD at 0.27 USD per ILS
    await expect(trigger).toHaveAccessibleName('≈ ₪1,870');
  });

  await step('Tap it: the exact amount per currency, the rate line and the ECB date; Esc closes', async () => {
    await trigger.click();
    const panel = page.getByRole('group', { name: 'Exact amounts' });
    await expect(panel.getByRole('row', { name: /USD/ })).toContainText('$100.00');
    await expect(panel.getByRole('row', { name: /ILS/ })).toContainText('₪1,500.00');
    await expect(panel).toContainText("ECB · Oct 17, 2026 · today's rate");
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});

test('Week, Month and Year, and ‹ › step through time without changing what Lately says', { tag: '@portal.reports.period-step' }, async ({ page, step }) => {
  const api = world({ reports: { [OFFICE_A]: threeMonths() } });
  const lately = page.locator('section', { has: page.getByRole('heading', { name: 'Lately' }) });
  let before: string[] = [];

  await step('Open Reports on this month', async () => {
    await openReports(page, api);
    await expect(lately.getByRole('listitem')).toHaveCount(3);
    before = await lately.getByRole('listitem').allTextContents();
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  await step('Step to the previous month', async () => {
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page).toHaveURL(new RegExp(`at=${month(-1)}-01`));
    await expect(hero(page)).toContainText(monthName(month(-1), true));
    await expect(page.getByRole('button', { name: 'Next month' })).toBeEnabled();
    await expect(lately.getByRole('listitem')).toHaveText(before);
  });

  await step('Choose Week, then Year', async () => {
    await page.getByRole('radio', { name: 'Week' }).click();
    await expect(page).toHaveURL(/period=week/);
    await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await page.getByRole('radio', { name: 'Year' }).click();
    await expect(page).toHaveURL(/period=year/);
    await expect(hero(page)).toContainText(TODAY.slice(0, 4));
    await expect(lately.getByRole('listitem')).toHaveText(before);
  });
});

test('The All profiles switch is off by default; on, it combines every profile and says so', { tag: '@portal.reports.all-profiles-switch' }, async ({ page, step }) => {
  const studio: StubReportRecords = { payments: [payment(9, { customerId: client.id, amount: '500.00', receivedOn: on(0, 1) })], expenses: [] };
  const api = world({ profiles: [office(OFFICE_A, 'Personal'), office(OFFICE_B, 'Studio')], reports: { [OFFICE_A]: thisMonth(), [OFFICE_B]: studio } });
  const toggle = page.getByRole('switch', { name: 'All profiles' });

  await step('With two profiles, open Reports', async () => {
    await openReports(page, api);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(hero(page).locator('.hp-report-received .sr-only')).toHaveText('₪1,500');
  });

  await step('Turn on All profiles', async () => {
    await toggle.click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.getByRole('button', { name: 'All 2 profiles' })).toBeVisible();
    await expect(page.getByText("combined · other currencies at today's rate")).toBeVisible();
    await expect(page.getByText('Of which Personal: ≈ ₪1,500')).toBeVisible();
    await expect(hero(page).locator('.hp-report-received .sr-only')).toHaveText('₪2,000');
    const whoPaid = page.getByRole('region', { name: 'Who paid' });
    await expect(whoPaid.getByText('Client 1')).toHaveCount(2);
    await expect(whoPaid.getByText('Studio')).toBeVisible();
  });

  await step('Reload the page: it reopens combined', async () => {
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(hero(page).locator('.hp-report-received .sr-only')).toHaveText('₪2,000');
  });
});

test('In All profiles a profile that fails is named with its own Retry, and the rest still renders', { tag: '@portal.reports.profile-fails' }, async ({ page, step }) => {
  const studio: StubReportRecords = { payments: [payment(9, { customerId: client.id, amount: '500.00', receivedOn: on(0, 1) })], expenses: [], refuse: 500 };
  const api = world({ profiles: [office(OFFICE_A, 'Personal'), office(OFFICE_B, 'Studio')], reports: { [OFFICE_A]: thisMonth(), [OFFICE_B]: studio } });

  await step('Turn on All profiles while Studio\'s report fails to load', async () => {
    await openReports(page, api, 'en', `${reportsPath()}?scope=all`);
    await expect(page.getByText("1 of 2 profiles · Studio couldn't load")).toBeVisible();
    await expect(hero(page).locator('.hp-report-received .sr-only')).toHaveText('₪1,500');
  });

  await step('Retry once the server answers again', async () => {
    api.serveReports(OFFICE_B);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(hero(page).locator('.hp-report-received .sr-only')).toHaveText('₪2,000');
    await expect(page.getByText(/couldn't load/)).toHaveCount(0);
  });
});

test('A young profile\'s teaser offers the combined insights the older profiles already have', { tag: '@portal.reports.teaser-suggests-switch' }, async ({ page, step }) => {
  const api = world({ profiles: [office(OFFICE_A, 'Personal'), office(OFFICE_B, 'Studio')], reports: { [OFFICE_A]: thisMonth(), [OFFICE_B]: threeMonths() } });

  await step('Open Reports on the profile started this month', async () => {
    await openReports(page, api);
    await expect(page.locator('.hp-teaser')).toContainText(`Personal started in ${named(THIS_MONTH)}; insights unlock in ${named(month(1))}.`);
  });

  await step('Choose "See insights across all profiles"', async () => {
    await page.getByRole('button', { name: 'See insights across all profiles' }).click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.getByRole('heading', { name: 'Lately' })).toBeVisible();
  });
});

test('In Arabic on a phone Reports reads right to left without sideways scrolling', { tag: '@portal.reports.arabic' }, async ({ page, step }) => {
  const api = world({ reports: { [OFFICE_A]: threeMonths() } });

  await step('Open Reports in Arabic on a 375 px phone', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReports(page, api, 'ar');
  });

  await step('Right to left, the Arabic copy, and no sideways scroll', async () => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('radio', { name: 'شهر' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'الشهر السابق' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'مؤخرًا' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'أين ذهب المال' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

/** PORTAL_LANGUAGE_KEY in src/hosted/i18n/HostedLanguageProvider.tsx */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

test('Signed out on this device, Reports runs on the records kept in the browser', { tag: '@portal.reports.signed-out' }, async ({ page, step }) => {
  const requests: string[] = [];
  await page.context().route('**/v1/**', async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) });
  });
  await page.context().addInitScript(([key, value]) => localStorage.setItem(key, value), [PORTAL_LANGUAGE_KEY, 'en'] as const);

  await step('Signed out, open Reports', async () => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { name: 'Your reports start with your first payment or expense' })).toBeVisible();
  });

  await step('Add income from the first-run block and come back', async () => {
    await page.getByRole('link', { name: '+ Add income' }).click();
    const drawer = page.getByRole('dialog', { name: 'New income' });
    await drawer.getByRole('radio', { name: 'Received' }).click();
    await drawer.getByLabel('Amount').fill('250.00');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toBeHidden();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Reports' }).click();
    await expect(hero(page).locator('.hp-report-received .sr-only')).toHaveText('₪250');
  });

  await step('No report request reached the server', async () => {
    expect(requests.filter((path) => path.startsWith('/v1/summaries'))).toEqual([]);
  });
});

test('With one complete month, Lately is a factual recap of it, and the teaser names when the rest unlocks', { tag: '@portal.reports.second-month' }, async ({ page, step }) => {
  const records: StubReportRecords = {
    payments: [payment(1, { customerId: client.id, amount: '800.00', receivedOn: on(-1, 2) }), payment(2, { customerId: client.id, amount: '100.00', receivedOn: on(0, 1) })],
    expenses: [expense(1, { amount: '250.00', categoryId: food.id, occurredOn: on(-1, 3) })],
  };
  const api = world({ reports: { [OFFICE_A]: records } });

  await step('Open Reports on a profile that started early last month', async () => {
    await openReports(page, api);
  });

  await step('Lately recaps last month, with no comparison; the teaser names the month the rest unlocks', async () => {
    const lately = page.locator('section', { has: page.getByRole('heading', { name: 'Lately' }) });
    await expect(lately.getByRole('listitem')).toHaveCount(1);
    expect((await lately.getByRole('listitem').allTextContents()).map(plain)).toEqual([`In ${named(month(-1))}: ₪800.00 received, ₪250.00 spent. Most spending went to Food. Client 1 paid the most.`]);
    await expect(lately.locator('.hp-teaser')).toContainText(`Trends, your best month and how fast clients pay unlock in ${named(month(1))}.`);
  });
});

test('Lately rotates: insights seen on 3 earlier visits make way for the trend, the best month and the average', { tag: '@portal.reports.insights-rotate' }, async ({ page, step }) => {
  const api = world({ reports: { [OFFICE_A]: threeMonths() } });
  const lately = page.locator('section', { has: page.getByRole('heading', { name: 'Lately' }) });

  await step('Open Reports and come back three more times', async () => {
    await openReports(page, api);
    await expect(lately.getByRole('listitem')).toHaveCount(3);
    for (let visit = 0; visit < 3; visit++) {
      await page.reload();
      await expect(lately.getByRole('listitem')).toHaveCount(3);
    }
  });

  await step('The fourth visit leads with the trend, the best month and the 3-month average', async () => {
    await expect(lately.getByRole('listitem').first()).toContainText('Your best month in the last year');
    const items = (await lately.getByRole('listitem').allTextContents()).map(plain);
    expect(items).toEqual([
      `Your best month in the last year was ${named(month(-2))}: ₪1,200.00 received.`,
      `Received in ${named(month(-1))}: ₪900.00, ₪300.00 less than ${named(month(-2))}.`,
      'Over the last 3 months you received about ₪1,033.33 a month.',
    ]);
  });
});

test('With a rate missing, each currency stands on its own and the lists say which one they count', { tag: '@portal.reports.missing-rate' }, async ({ page, step }) => {
  const records = thisMonth();
  records.expenses.push(expense(2, { amount: '50.00', currency: 'USD', categoryId: food.id, occurredOn: on(0, 1) }));
  const api = world({ reports: { [OFFICE_A]: records }, fxRates: 'unavailable' });

  await step('Spend in ILS and USD this month while today\'s rates are unavailable, then open Reports', async () => {
    await openReports(page, api);
  });

  await step('The hero lists ILS and USD on their own lines, no ≈; both lists say they count ILS only', async () => {
    await expect(hero(page).locator('.hp-report-currency')).toHaveCount(2);
    await expect(hero(page)).not.toContainText('≈');
    await expect(hero(page)).toContainText('$50');
    await expect(page.getByRole('region', { name: 'Where it went' })).toContainText("In ILS only: today's rates aren't available");
  });
});

test('The chart answers the keyboard and says each day\'s values; reduced motion shows the figures at once', { tag: '@portal.reports.chart-keyboard' }, async ({ page, step }) => {
  const api = world({ reports: { [OFFICE_A]: thisMonth() } });
  const chart = page.getByRole('group', { name: 'Received and spent per day. Arrow keys move between days.' });

  await step('Open Reports with motion on: the bars grow in from nothing', async () => {
    await openReports(page, api);
    // DR21: the first bar starts at zero and grows to its height
    await expect.poll(async () => chart.locator('.hp-daybar-fill').first().evaluate((el) => (el as HTMLElement).style.transform)).toBe('scaleY(1)');
  });

  await step('Tab into the chart, move with the arrows, and choose a day with Enter', async () => {
    await chart.getByRole('button').first().focus();
    await page.keyboard.press('Home');
    await expect(chart.getByRole('button').first()).toBeFocused();
    const firstName = await chart.getByRole('button').first().getAttribute('aria-label');
    expect(plain(firstName ?? '')).toMatch(/: received ₪1,500\.00, spent ₪400\.00$/);
    await page.keyboard.press('ArrowRight');
    await expect(chart.getByRole('button').nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.hp-report-selected')).toContainText('Received ₪0.00 · Spent ₪0.00');
  });

  await step('With reduced motion the figures are final at once', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(hero(page).locator('.hp-report-received .hp-countup')).toHaveText('₪1,500');
    await expect(chart.locator('.hp-daybar-fill').first()).toHaveAttribute('style', /scaleY\(1\)/);
  });
});

test('A profile the person can\'t read is named and left out; alone, it explains itself', { tag: '@portal.reports.profile-forbidden' }, async ({ page, step }) => {
  const api = world({ profiles: [office(OFFICE_A, 'Personal'), office(OFFICE_B, 'Studio')], reports: { [OFFICE_A]: thisMonth(), [OFFICE_B]: { payments: [], expenses: [], refuse: 403 } } });

  await step('Turn on All profiles while Studio\'s payments are off limits', async () => {
    await openReports(page, api, 'en', `${reportsPath()}?scope=all`);
  });

  await step('Studio is named and left out; Personal\'s figures still show', async () => {
    await expect(page.getByText("Studio isn't included: you can't see its payments")).toBeVisible();
    await expect(hero(page).locator('.hp-report-received .sr-only')).toHaveText('₪1,500');
  });

  await step('Opening Studio\'s own Reports explains why there is nothing to see', async () => {
    await page.goto(reportsPath(OFFICE_B));
    await expect(page.getByRole('heading', { name: "You can't see this profile's payments" })).toBeVisible();
  });
});
