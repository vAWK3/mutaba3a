import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { EVENT_PATH, actAsPerson, type AnalyticsSpy, type SentEvent } from '../../support/posthog';

/**
 * The portal's opt-in anonymous usage counts (MUT-155, ADR-090). The QA build
 * carries a dummy key (qa.config.mjs) and qa/support/posthog.ts answers every
 * PostHog host locally, so these specs read exactly what the portal would
 * send, and nothing leaves. The guard's every rule is unit-tested in
 * src/lib/analytics; this proves the real build asks first and wires it.
 */

const PROMPT = 'Share anonymous usage?';
const TURN_ON = 'Share anonymous usage';

const seed = () => new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1 });

async function openPortal(page: Page, api: FakeApi) {
  // As an ordinary browser, so a silence can't be posthog-js's bot filter
  await actAsPerson(page);
  await api.open(page, `/p/${OFFICE_A}/payments`);
  await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
}

async function nextEvent(analytics: AnalyticsSpy, name: string): Promise<SentEvent> {
  await expect.poll(() => analytics.events().some((e) => e.event === name), { timeout: 15_000 }).toBe(true);
  return analytics.events().find((e) => e.event === name)!;
}

async function turnOnFromPrompt(page: Page, analytics: AnalyticsSpy) {
  await page.getByRole('region', { name: PROMPT }).getByRole('button', { name: TURN_ON }).click();
  await nextEvent(analytics, 'analytics_opted_in');
}

const posthogKeys = (page: Page) =>
  page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) => /ph_|posthog/i.test(key)));

test('the portal asks once and sends nothing before an answer', { tag: '@portal.usage-analytics.prompt-silent-until-chosen' }, async ({ page, step, analytics }) => {
  await step('Sign in and open Payments', async () => {
    await openPortal(page, seed());
  });

  await step('The notice asks, with two buttons of the same weight', async () => {
    const prompt = page.getByRole('region', { name: PROMPT });
    await expect(prompt).toBeVisible();
    const on = prompt.getByRole('button', { name: TURN_ON });
    const off = prompt.getByRole('button', { name: 'Not now' });
    await expect(on).toBeVisible();
    expect(await on.getAttribute('class')).toBe(await off.getAttribute('class'));
  });

  await step('Wait a few seconds without answering: not a single request goes to PostHog', async () => {
    await page.waitForTimeout(3_000);
    expect(analytics.requestCount()).toBe(0);
  });
});

test('turning sharing on counts it, then each opening, with no address and no cookie', { tag: '@portal.usage-analytics.opt-in-counts' }, async ({ page, step, analytics, context }) => {
  await step('Sign in and press "Share anonymous usage" in the notice', async () => {
    await openPortal(page, seed());
    await turnOnFromPrompt(page, analytics);
    await expect(page.getByRole('region', { name: PROMPT })).toHaveCount(0);
  });

  await step('analytics_opted_in says it came from the prompt, stamped by the contract guard', async () => {
    const optedIn = await nextEvent(analytics, 'analytics_opted_in');
    expect(optedIn.properties).toMatchObject({ prompt: 'first_run', surface: 'portal', locale: 'en', $geoip_disable: true });
  });

  await step('Reload the page: portal_opened is sent', async () => {
    await page.reload();
    await nextEvent(analytics, 'portal_opened');
  });

  await step('No event carries an address, a profile ID or a person; nothing in a cookie; only event posts', async () => {
    for (const event of analytics.events()) {
      for (const key of ['$current_url', '$pathname', '$host', '$referrer', '$referring_domain', '$set', '$set_once']) expect(event.properties).not.toHaveProperty(key);
      expect(JSON.stringify(event)).not.toContain(OFFICE_A);
    }
    expect((await context.cookies()).filter((c) => /ph_|posthog/i.test(c.name))).toEqual([]);
    for (const path of analytics.requestPaths()) expect(path).toMatch(EVENT_PATH);
  });
});

test('with sharing on, a saved income is counted by currency and paid, nothing more', { tag: '@portal.usage-analytics.save-income-counts' }, async ({ page, step, analytics }) => {
  const drawer = page.getByRole('dialog', { name: 'New income' });

  await step('Turn sharing on', async () => {
    await openPortal(page, seed());
    await turnOnFromPrompt(page, analytics);
  });

  await step('Add a received income of 1,200 for Client 1', async () => {
    await page.locator('[data-income-add]').click();
    await drawer.getByLabel('Amount').fill('1,200');
    const client = drawer.getByLabel('Client (optional)');
    await client.fill('Client 1');
    await drawer.getByRole('listbox').getByRole('option', { name: 'Client 1', exact: true }).click();
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toHaveCount(0);
  });

  await step('income_recorded carries the currency and paid, and not the amount or the client', async () => {
    const income = await nextEvent(analytics, 'income_recorded');
    expect(income.properties).toMatchObject({ currency: 'ILS', paid: true, surface: 'portal' });
    expect(JSON.stringify(income)).not.toMatch(/1200|1,200|Client 1/);
  });
});

test('turning sharing off sends one last note, then nothing, and forgets the ID', { tag: '@portal.usage-analytics.opt-out-last-note' }, async ({ page, step, analytics }) => {
  await step('Turn sharing on', async () => {
    await openPortal(page, seed());
    await turnOnFromPrompt(page, analytics);
  });

  await step('Open the account menu and turn off "Share anonymous usage"', async () => {
    await page.getByRole('button', { name: /^Account/ }).click();
    const toggle = page.getByRole('menuitemcheckbox', { name: TURN_ON });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  await step('One analytics_opted_out was sent', async () => {
    await nextEvent(analytics, 'analytics_opted_out');
    expect(analytics.events().filter((e) => e.event === 'analytics_opted_out')).toHaveLength(1);
  });

  await step('Reload: nothing more is sent, the notice stays away, and no PostHog key is left', async () => {
    const before = analytics.requestCount();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(analytics.requestCount()).toBe(before);
    await expect(page.getByRole('region', { name: PROMPT })).toHaveCount(0);
    expect(await posthogKeys(page)).toEqual([]);
  });
});

test('signing out forgets the choice and the ID without sending anything', { tag: '@portal.usage-analytics.sign-out-resets' }, async ({ page, step, analytics }) => {
  await step('Turn sharing on', async () => {
    await openPortal(page, seed());
    await turnOnFromPrompt(page, analytics);
  });

  let before = 0;
  await step('Sign out from the account menu: nothing is sent and no PostHog key is left', async () => {
    before = analytics.requestCount();
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in\?reason=signed_out$/);
    await page.waitForTimeout(1_000);
    expect(analytics.requestCount()).toBe(before);
    expect(await posthogKeys(page)).toEqual([]);
  });

  await step('Sign in again: the notice asks again, and nothing is sent until it is answered', async () => {
    await page.getByLabel('Email').fill('nour@office.ps');
    await page.getByLabel('Password', { exact: true }).fill('qa-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('region', { name: PROMPT })).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(analytics.requestCount()).toBe(before);
  });
});

test('turning sharing off in one tab silences another open tab', { tag: '@portal.usage-analytics.other-tab-silenced' }, async ({ page, step, analytics, context }) => {
  const api = seed();
  const other = await context.newPage();
  const drawer = other.getByRole('dialog', { name: 'New income' });

  await step('Turn sharing on, then open Payments in a second tab', async () => {
    await openPortal(page, api);
    await turnOnFromPrompt(page, analytics);
    await openPortal(other, api);
    await expect.poll(() => analytics.events().filter((e) => e.event === 'portal_opened').length).toBe(1);
  });

  await step('In the first tab, turn off "Share anonymous usage" in the account menu', async () => {
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitemcheckbox', { name: TURN_ON }).click();
    await nextEvent(analytics, 'analytics_opted_out');
  });

  await step('In the second tab, add a received income: nothing is sent and no PostHog key comes back', async () => {
    const before = analytics.requestCount();
    await other.locator('[data-income-add]').click();
    await drawer.getByLabel('Amount').fill('300');
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer).toHaveCount(0);
    await other.waitForTimeout(2_000);
    expect(analytics.requestCount()).toBe(before);
    expect(await posthogKeys(other)).toEqual([]);
  });

  await step("The second tab's switch reads off too", async () => {
    await other.getByRole('button', { name: /^Account/ }).click();
    await expect(other.getByRole('menuitemcheckbox', { name: TURN_ON })).toHaveAttribute('aria-checked', 'false');
  });
});
