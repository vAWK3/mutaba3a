import { test, expect } from '../../support/qa';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';

/**
 * MUT-362 (design review DR4/DR5): Settings › Billing on a server without Stripe or GA prices. The live sandbox
 * always has prices, so this state is shown with the API stubbed; the paying flows run in portal-live.
 */

const DAY = 24 * 60 * 60 * 1000;

test('Before Stripe or the GA prices are set, Billing says subscriptions open soon and offers no Subscribe', { tag: '@portal.billing.open-soon' }, async ({ page, step }) => {
  const trialEnds = new Date(Date.now() + 9 * DAY).toISOString();
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), billing: { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: trialEnds } }] });
  await api.open(page, `/p/${OFFICE_A}`);
  // After open: the later route wins over the fake's catch-all.
  await page.route('**/v1/billing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: false,
        subscription: null,
        canManage: false,
        trial: { startedAt: new Date(Date.now() - 5 * DAY).toISOString(), endsAt: trialEnds, lockAt: new Date(Date.now() + 25 * DAY).toISOString() },
        catalog: { ILS: null, USD: null },
        countries: { consumer: [], customTaxId: ['IL', 'JO'] },
        coveredProfileIds: [OFFICE_A],
      }),
    }),
  );

  const drawer = await step('Open Billing from the account menu', async () => {
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Billing' }).click();
    return page.getByRole('dialog', { name: 'Billing' });
  });
  await step('See the trial first, and that subscriptions open soon', async () => {
    await expect(drawer.getByRole('heading', { name: '9 days left in your free trial' })).toBeVisible();
    await expect(drawer.getByText("Subscriptions open soon. We'll let you know before your trial ends.")).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Subscribe' })).toHaveCount(0);
    await expect(drawer.getByText(/₪|\$/)).toHaveCount(0);
  });
});
