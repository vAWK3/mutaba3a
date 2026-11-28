import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, OFFICE_B, office, type StubProfile } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-734 (wireframe mut-734 A): Change plan from Billing on the FakeApi's `paid` seed, which answers the preview, the
 * change and Undo as the server does, with a fixed ₪31.40 proration.
 */

const personal: StubProfile = { ...office(OFFICE_B, 'Personal'), type: 'PERSONAL', personalDefault: true };
const PRINT = '55555555-5555-4555-8555-555555555553';

async function openBilling(page: import('@playwright/test').Page) {
  await openYou(page, 'account');
  await youRow(page, 'Billing').click();
  return page.getByRole('dialog', { name: 'Billing' });
}

test("On Solo, Change plan › Business previews the amount charged now; Pay charges it and the done pane says You're on Business", { tag: '@portal.change-plan.upgrade-now' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], paid: { plan: 'solo' } });
  const pane = page.getByRole('dialog', { name: 'Change plan' });

  await step('As a Solo subscriber, open Billing and choose Change plan', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const billing = await openBilling(page);
    await billing.getByRole('button', { name: 'Change plan' }).click();
    await expect(pane.getByTestId('change-row-solo')).toContainText('Current');
    await expect(pane.getByRole('radio', { name: /^Solo/ })).toBeDisabled();
    await expect(pane.getByRole('radio', { name: /^Starter/ })).toBeEnabled();
    await expect(pane.getByRole('radio', { name: /^Firm/ })).toBeEnabled();
  });

  await step('Choose Business', async () => {
    await pane.getByRole('radio', { name: /^Business/ }).check();
    await expect(pane.getByTestId('change-preview')).toContainText('Charged now');
    await expect(pane.getByTestId('change-preview')).toContainText('₪31.40');
    await expect(page.getByRole('button', { name: 'Pay ₪31.40' })).toBeEnabled();
  });

  await step('Choose Pay ₪31.40', async () => {
    await page.getByRole('button', { name: 'Pay ₪31.40' }).click();
    const done = pane.getByTestId('plan-upgraded');
    await expect(done.getByRole('heading', { name: "You're on Business" })).toBeVisible();
    await expect(done.locator('[data-scene="plan-upgraded"]')).toHaveClass(/hp-scene--plan-upgraded/);
    expect(api.calls('POST', '/v1/billing/plan-change')[0]!.body).toMatchObject({ plan: 'business', expectedAmountDue: 3140 });
  });

  await step('Choose Done', async () => {
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog', { name: 'Billing' }).getByRole('heading', { name: /^Business, renews/ })).toBeVisible();
  });
});

test('On Business with two businesses, Change plan › Solo asks which business stays active; Confirm schedules it with a toast and Undo takes it back', { tag: '@portal.change-plan.downgrade-scheduled' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), office(PRINT, 'Nour Print'), personal], paid: { plan: 'business' } });
  const pane = page.getByRole('dialog', { name: 'Change plan' });

  await step('As a Business subscriber with two businesses, open Change plan and choose Solo', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const billing = await openBilling(page);
    await billing.getByRole('button', { name: 'Change plan' }).click();
    await pane.getByRole('radio', { name: /^Solo/ }).check();
    await expect(pane.getByTestId('change-preview')).toContainText(/^Solo from /);
    await expect(pane.getByTestId('business-checklist')).toContainText('0 of 1');
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  await step('Tick one business', async () => {
    const list = pane.getByTestId('business-checklist');
    await list.getByRole('checkbox', { name: /Nour Studio/ }).check();
    await expect(list).toContainText('1 of 1');
    await expect(list.getByRole('checkbox', { name: /Nour Print/ })).toBeDisabled();
    await expect(list).toContainText(/Read-only from /);
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    await expectNoHorizontalOverflow(page, 'Change plan, downgrade');
  });

  await step('Choose Confirm', async () => {
    await page.getByRole('button', { name: 'Confirm' }).click();
    const billing = page.getByRole('dialog', { name: 'Billing' });
    const line = billing.getByTestId('scheduled-change');
    await expect(line).toContainText('Scheduled');
    await expect(line).toContainText(/Solo from /);
    await expect(line.locator('[data-scene="change-scheduled"]')).toBeVisible();
    const toast = page.getByTestId('toast-live');
    await expect(toast).toContainText(/Solo from /);
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
    expect(api.calls('POST', '/v1/billing/plan-change')[0]!.body).toEqual({ plan: 'solo', activeBusinessIds: [OFFICE_A] });
  });

  await step('Choose Undo on the scheduled line', async () => {
    const billing = page.getByRole('dialog', { name: 'Billing' });
    await billing.getByTestId('scheduled-change').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('toast-live')).toContainText(/^Business renews /);
    await expect(billing.getByTestId('scheduled-change')).toHaveCount(0);
    await expect(billing.getByRole('button', { name: 'Change plan' })).toBeVisible();
  });
});

test("Cancel plan's confirm offers Move to Starter, which opens Change plan on Starter and schedules it", { tag: '@portal.change-plan.cancel-to-starter' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], paid: { plan: 'solo' } });

  await step('As a Solo subscriber, open Billing, choose Cancel plan, give a reason and Continue', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const billing = await openBilling(page);
    await billing.getByRole('button', { name: 'Cancel plan' }).click();
    const flow = page.getByRole('dialog', { name: 'Cancel plan' });
    await flow.getByRole('radio', { name: "I'm moving to another tool" }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(flow.getByRole('button', { name: 'Keep my plan' })).toBeVisible();
    await expect(flow.getByTestId('move-to-starter')).toBeVisible();
  });

  await step('Choose Move to Starter', async () => {
    await page.getByTestId('move-to-starter').click();
    const pane = page.getByRole('dialog', { name: 'Change plan' });
    await expect(pane.getByRole('radio', { name: /^Starter/ })).toBeChecked();
    await expect(pane.getByTestId('change-preview')).toContainText(/^Starter from /);
  });

  await step('Choose Confirm', async () => {
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('dialog', { name: 'Billing' }).getByTestId('scheduled-change')).toContainText(/Starter from /);
    expect(api.calls('POST', '/v1/billing/plan-change')[0]!.body).toEqual({ plan: 'starter' });
  });
});
