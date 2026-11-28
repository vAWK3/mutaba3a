import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { person } from '../../support/agent';
import { address, chooseLanguage, grantPilot, operatorAccount, revokeGrant, seedUsage } from '../../support/selfService';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-759 (plan `docs/designs/pilot-testers-business-plan.md`, QA scenarios): the free pilot on the live dev API
 * (support/selfservice-live.mjs). A pilot grant is made as `billing:grant --cohort` makes it (the admin route); the
 * tester signs in to the Welcome (MUT-755), sees the Pilot panel (MUT-753), the end (ADR-330) and an extension, and a
 * first scan is celebrated (ADR-332). The console half is in operator.spec.ts.
 */

const DAY = 86_400_000;
const longDay = (iso: string) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

async function openBilling(page: Page) {
  await openYou(page, 'account');
  await youRow(page, 'Billing').click();
  return page.getByRole('dialog', { name: 'Billing' });
}

test('A pilot tester signs in to the Welcome once, then Billing shows the Pilot panel with the end, the limits and the plans', { tag: '@portal-selfservice.pilot.pilot-panel' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const accountant = await operatorAccount(address('accountant'), 'en');
  const tester = await person(page, { agentAccess: false });
  const grant = await grantPilot(tester.id, { accountantId: accountant.id });

  await step('The accountant’s client, granted a Business pilot, opens MTB3A', async () => {
    await page.goto(`/p/${tester.profileId}`);
    const welcome = page.getByRole('dialog', { name: 'Welcome' });
    await expect(welcome).toBeVisible();
    await expect(page).toHaveURL(/pilotWelcome=true/);
    await expect(welcome.getByText(`Business, free until ${longDay(grant.expiresAt)}`)).toBeVisible();
    await expect(welcome.getByRole('listitem')).toHaveText(['Scan a receipt', 'Issue an invoice', 'Tell us what is unclear']);
    await expect(welcome.getByRole('checkbox', { name: 'You may watch and record my sessions in this pilot' })).not.toBeChecked();
  });

  await step('Tick the yes to watched sessions and choose Later', async () => {
    const welcome = page.getByRole('dialog', { name: 'Welcome' });
    await welcome.getByRole('checkbox').check();
    await welcome.getByRole('button', { name: 'Later' }).click();
    await expect(welcome).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get('/v1/billing')).json()).pilot).toMatchObject({ welcomeSeenAt: expect.any(String), watchConsentAt: expect.any(String) });
  });

  await step('Reload: the Welcome does not open again', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Welcome' })).toHaveCount(0);
  });

  await step('Open You › Account › Billing', async () => {
    const drawer = await openBilling(page);
    await expect(drawer.getByText('Pilot', { exact: true }).first()).toBeVisible();
    await expect(drawer.getByRole('heading', { name: `Free until ${longDay(grant.expiresAt)}` })).toBeVisible();
    await expect(drawer.getByText('Business · 100% off')).toBeVisible();
    await expect(drawer.getByText('0 of 250 documents')).toBeVisible();
    await expect(drawer.getByText('0 of 500 scans')).toBeVisible();
    const plans = drawer.getByTestId('pilot-plans');
    await expect(plans.getByTestId('pilot-plan-solo')).toContainText('₪39');
    await expect(plans.getByTestId('pilot-plan-business')).toContainText('₪89');
    await expect(plans.getByTestId('pilot-plan-firm')).toContainText('₪249');
    await expect(plans.getByText('Expected')).toHaveCount(3);
    await expect(drawer.getByRole('link', { name: 'Write to us' })).toHaveAttribute('href', /^mailto:/);
    await expect(drawer.getByRole('button', { name: 'Subscribe' })).toHaveCount(0);
  });

  await step('At 375 px and in Arabic', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await chooseLanguage(page, 'ar');
    await page.goto(`/p/${tester.profileId}?billing=true`);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: /^مجاني حتى / })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'the Pilot panel in Arabic at 375 px');
  });
});

test('When the pilot ends, Billing says Pilot ended with its scene', { tag: '@portal-selfservice.pilot.pilot-ended' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const tester = await person(page, { agentAccess: false });
  const grant = await grantPilot(tester.id);

  await step('The tester, mid-pilot, sees the Pilot panel', async () => {
    await page.goto(`/p/${tester.profileId}?billing=true`);
    await expect(page.getByRole('dialog', { name: /Welcome|Billing/ }).first()).toBeVisible();
    await expect.poll(async () => (await (await page.request.get('/v1/billing')).json()).pilot?.cohort).toBe('qa-pilot');
  });

  await step('The operator ends the pilot; the tester opens Billing', async () => {
    await revokeGrant(grant.id);
    await page.goto(`/p/${tester.profileId}?billing=true`);
    const drawer = page.getByRole('dialog', { name: 'Billing' });
    await expect(drawer.getByRole('heading', { name: 'Pilot ended' })).toBeVisible();
    await expect(drawer.locator('[data-scene="pilot-ended"]')).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Write to us' })).toHaveCount(0);
  });
});

test('The operator extends a pilot; Billing shows the new end and the Welcome does not come back', { tag: '@portal-selfservice.pilot.pilot-extension' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const tester = await person(page, { agentAccess: false });
  const first = await grantPilot(tester.id, { expiresAt: new Date(Date.now() + 20 * DAY).toISOString() });

  await step('The tester closes the Welcome and sees the end in 20 days', async () => {
    await page.goto(`/p/${tester.profileId}`);
    await page.getByRole('dialog', { name: 'Welcome' }).getByRole('button', { name: 'Later' }).click();
    const drawer = await openBilling(page);
    await expect(drawer.getByRole('heading', { name: `Free until ${longDay(first.expiresAt)}` })).toBeVisible();
  });

  await step('The operator revokes it and grants again for 45 days with the same cohort', async () => {
    await revokeGrant(first.id);
    const extended = await grantPilot(tester.id, { expiresAt: new Date(Date.now() + 45 * DAY).toISOString() });
    await page.goto(`/p/${tester.profileId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Welcome' })).toHaveCount(0);
    const drawer = await openBilling(page);
    await expect(drawer.getByRole('heading', { name: `Free until ${longDay(extended.expiresAt)}` })).toBeVisible();
  });
});

test('A tester’s first scan is celebrated once', { tag: '@portal-selfservice.pilot.pilot-first-scan' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const tester = await person(page, { agentAccess: false });
  await grantPilot(tester.id);

  await step('The tester opens MTB3A before any scan', async () => {
    await page.goto(`/p/${tester.profileId}`);
    await page.getByRole('dialog', { name: 'Welcome' }).getByRole('button', { name: 'Later' }).click();
    await expect(page.getByTestId('milestone-scan')).toHaveCount(0);
  });

  await step('A first scan is saved; the next read celebrates it', async () => {
    seedUsage(tester.id, 'business', { documents: 0, scans: 1 });
    await page.reload();
    const card = page.getByTestId('milestone-scan');
    await expect(card).toContainText('First scan saved');
    await expect(card.locator('[data-scene="milestone-first-scan"]')).toBeVisible();
  });

  await step('Reload: not again', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('milestone-scan')).toHaveCount(0);
  });
});
