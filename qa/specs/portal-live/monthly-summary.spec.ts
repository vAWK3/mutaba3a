import { test, expect } from '../../support/qa';
import type { Page } from '@playwright/test';
import { advanceClock, customerOnClock, finishSignupInPage, invoicesOf, liveState, outboxOf, provisionPerson, requestSignup, runMailJob, signIn, subscribeByApi } from '../../support/livePortal';
import { openYou } from '../../support/you';

/**
 * MUT-535 (ADR-259): the monthly summary mail on the portal-live API (memory mailer, real Postgres, Stripe's sandbox
 * for the yearly line). The job reports the month before today's in Jerusalem, so each flow records last month and
 * runs the operator's door, then reads the mail from the dev outbox.
 */

const DAY_S = 24 * 60 * 60;
const SUMMARY = 'monthly-summary';

/** Last month in Jerusalem: a day in it, its last day, and its name in English and Arabic (Levantine). */
function lastMonth(): { day: (d: number) => string; en: string; ar: string } {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number) as [number, number];
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  const first = new Date(Date.UTC(year, month - 1, 1));
  const name = (locale: string) => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(first);
  return { day: (d) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, en: name('en-US'), ar: name('ar-PS-u-nu-latn') };
}

let ik = 0;
async function record(page: Page, profileId: string, path: string, body: Record<string, unknown>): Promise<{ id: string }> {
  // A session's writes come from the portal's own origin (the API refuses another site's).
  const headers = { origin: liveState().portalOrigin, 'x-mutaba3a-profile': profileId, 'idempotency-key': `qa-mut535-${Date.now()}-${++ik}` };
  const res = await page.request.post(path, { data: body, headers });
  expect(res.status(), `${path} ${await res.text()}`).toBe(201);
  return res.json();
}

async function summariesTo(email: string) {
  return (await outboxOf(email)).filter((m) => m.template === SUMMARY);
}

/** Runs the operator's door until this person's summary is in the outbox (other QA people may be ahead of them). */
async function mailedOnce(email: string) {
  await expect.poll(async () => {
    await runMailJob('monthly-summary-mail');
    return (await summariesTo(email)).length;
  }, { timeout: 90_000 }).toBe(1);
  return (await summariesTo(email))[0]!;
}

test('The monthly summary - last month per currency, the same Owed as the overview, one mail a month', { tag: '@portal-live.monthly-summary.monthly-summary-mail' }, async ({ page, step }) => {
  const month = lastMonth();
  const person = await step('A new trialist records ₪12,400 and $900 received last month, and ₪3,200 owed that fell due last month', async () => {
    const p = await finishSignupInPage(page, await requestSignup('en', 'summary'), 'en');
    await record(page, p.personalId, '/v1/income', { kind: 'received', amount: '12400.00', currency: 'ILS', occurredOn: month.day(5) });
    await record(page, p.personalId, '/v1/income', { kind: 'received', amount: '900.00', currency: 'USD', occurredOn: month.day(7) });
    const client = await record(page, p.personalId, '/v1/customers', { name: 'Haddad Studio' });
    await record(page, p.personalId, '/v1/income', { kind: 'owed', amount: '3200.00', currency: 'ILS', occurredOn: month.day(2), dueDate: month.day(15), customerId: client.id, title: 'Logo work' });
    return p;
  });
  const mail = await step('The monthly job runs: one mail with last month per currency', async () => {
    const m = await mailedOnce(person.email);
    expect(m.subject).toBe(`Your ${month.en} in MTB3A`);
    expect(m.text).toContain(`Came in during ${month.en}: ₪12,400 · $900`);
    expect(m.text).toContain('Still owed: ₪3,200');
    expect(m.text).toContain('Overdue: ₪3,200 (1 entry)');
    return m;
  });
  await step('Open the mail’s Open link: home on In & out (MUT-657 E-5); Owed shows the same ₪3,200 owed', async () => {
    const link = mail.text.match(/https?:\/\/\S+\/p\/[0-9a-f-]{36}\?view=in-out/)?.[0];
    expect(link).toBeTruthy();
    await page.goto(link!);
    await expect(page).toHaveURL(/\?view=in-out$/);
    await page.goto(link!.replace('?view=in-out', '/owed'));
    const owed = page.locator('.hp-stat').filter({ hasText: 'Owed' }).first();
    await expect(owed).toContainText('3,200', { timeout: 30_000 });
  });
  await step('The job runs again: nothing more this month', async () => {
    await runMailJob('monthly-summary-mail');
    expect(await summariesTo(person.email)).toHaveLength(1);
  });
});

test('Turn the monthly summary off from its mail, in Arabic, and back on', { tag: '@portal-live.monthly-summary.monthly-summary-off-link' }, async ({ page, step }) => {
  const month = lastMonth();
  const person = await step('An Arabic trialist gets the monthly summary', async () => {
    const p = await finishSignupInPage(page, await requestSignup('ar', 'summaryoff'), 'ar');
    await record(page, p.personalId, '/v1/income', { kind: 'received', amount: '400.00', currency: 'ILS', occurredOn: month.day(5) });
    return p;
  });
  const link = await step('The mail is in Arabic and says how to turn it off', async () => {
    const m = await mailedOnce(person.email);
    expect(m.subject).toBe(`${month.ar} في متابعة`);
    expect(m.text).toContain('لا تريد هذه الرسالة الشهرية؟ أوقفها.');
    return m.text.match(/https?:\/\/\S+\/mail-off#[A-Za-z0-9_.-]+/)?.[0];
  });
  await step('Open its link: the page asks first and changes nothing', async () => {
    expect(link).toBeTruthy();
    await page.goto(link!);
    await expect(page.getByRole('heading', { name: 'إيقاف الملخّص الشهري؟' })).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).hash).toBe('');
    expect((await (await page.request.get('/v1/me/monthly-summary-mail')).json()).on).toBe(true);
  });
  await step('Press أوقفه: it is off, and You › Account’s switch says so', async () => {
    await page.getByRole('button', { name: 'أوقفه' }).click();
    await expect(page.getByRole('heading', { name: 'أُوقف الملخّص الشهري.' })).toBeVisible();
    expect((await (await page.request.get('/v1/me/monthly-summary-mail')).json()).on).toBe(false);
  });
  await step('Press أعِد تشغيله: it is on again', async () => {
    await page.getByRole('button', { name: 'أعِد تشغيله' }).click();
    await expect(page.getByRole('heading', { name: 'الملخّص الشهري مُفعَّل.' })).toBeVisible();
  });
});

test('You › Account’s Monthly summary email switch - off, then on, kept after a reload', { tag: '@portal-live.monthly-summary.monthly-summary-account-switch' }, async ({ page, step }) => {
  const month = lastMonth();
  const person = await step('A trialist with last month recorded opens You › Account', async () => {
    const p = await finishSignupInPage(page, await requestSignup('en', 'summaryswitch'), 'en');
    await record(page, p.personalId, '/v1/income', { kind: 'received', amount: '400.00', currency: 'ILS', occurredOn: month.day(5) });
    // A new signup lands on the trial's welcome step (MUT-418); the person answers it first.
    await page.getByRole('dialog', { name: 'Your free trial' }).getByRole('button', { name: 'Not now' }).click();
    await openYou(page, 'account');
    return p;
  });
  const toggle = page.getByRole('switch', { name: /Monthly summary email/ });
  await step('The switch starts on; turn it off and reload: still off, and the job skips them', async () => {
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.reload();
    await openYou(page, 'account');
    await expect(page.getByRole('switch', { name: /Monthly summary email/ })).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
    await runMailJob('monthly-summary-mail');
    expect(await summariesTo(person.email)).toHaveLength(0);
  });
  await step('Turn it on again: the next run mails them', async () => {
    await page.getByRole('switch', { name: /Monthly summary email/ }).click();
    await expect(page.getByRole('switch', { name: /Monthly summary email/ })).toHaveAttribute('aria-checked', 'true');
    await mailedOnce(person.email);
  });
});

test('After a monthly payer’s 2nd payment the summary carries Switch to yearly', { tag: '@portal-live.monthly-summary.monthly-summary-yearly-line' }, async ({ page, step }) => {
  const month = lastMonth();
  // An operator-made account (its setup link handed over, never mailed): mailed all the same (Basel, 2026-11-22, TD-315).
  const person = await provisionPerson('en', 'summaryyearly');
  await step('A monthly subscriber in shekels has paid two months and recorded ₪400 received last month', async () => {
    const { customerId, clockId } = await customerOnClock(person, Math.floor(Date.now() / 1000) - 31 * DAY_S - 3 * 60 * 60);
    await subscribeByApi(customerId);
    await advanceClock(clockId, Math.floor(Date.now() / 1000) - 120);
    await expect.poll(async () => (await invoicesOf(customerId)).filter((i) => i.total > 0).length, { timeout: 60_000 }).toBe(2);
    await signIn(page, person);
    await record(page, person.personalId, '/v1/income', { kind: 'received', amount: '400.00', currency: 'ILS', occurredOn: month.day(5) });
  });
  const mail = await step('The monthly job runs: the mail says Switch to yearly and save ₪58 a year', async () => {
    await expect.poll(async () => {
      await runMailJob('monthly-summary-mail');
      return (await summariesTo(person.email)).length;
    }, { timeout: 90_000 }).toBe(1);
    const [m] = await summariesTo(person.email);
    expect(m!.text).toContain('Switch to yearly and save ₪58 a year:');
    return m!;
  });
  await step('Open its link: Billing’s Switch to yearly', async () => {
    const link = mail.text.match(/https?:\/\/\S+\/\?billing=true&step=switch/)?.[0];
    expect(link).toBeTruthy();
    await page.goto(link!);
    await expect(page.getByRole('dialog', { name: 'Switch to yearly' })).toBeVisible({ timeout: 45_000 });
  });
});
