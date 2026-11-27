import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import { stripeNavigation } from '../../data/billingQueries';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-731 (Basel Q7): the one-time Solo trial step shows before the shell when the server offers it. The gate marks
 * the shell as shown during the same render /v1/me first answers, so the step must keep it from being marked shown,
 * as the terms step does; otherwise it could never appear. The step is dark (SOLO_TRIAL_CHECKOUT off), so the switch
 * is turned on here.
 */
const { trackPortal } = vi.hoisted(() => ({ trackPortal: vi.fn(async () => {}) }));
vi.mock('../../analytics/portalAnalytics', async (original) => ({ ...(await original<typeof import('../../analytics/portalAnalytics')>()), trackPortal }));

vi.mock('../../pages/onboarding/SoloTrialStep', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pages/onboarding/SoloTrialStep')>()),
  SOLO_TRIAL_CHECKOUT: true,
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Solo trial step at sign-in (MUT-731)', () => {
  it('shows before the shell when the server offers it', async () => {
    stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok({ ...me([profile()]), plan: { current: 'starter', businesses: null, soloTrialOffer: true } }),
      'POST /v1/billing/solo-trial/offered': () => ok({}),
    });
    renderPortal(`/p/${ORG_A}`);
    expect(await screen.findByTestId('solo-trial-step')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose how to start' })).toBeInTheDocument();
  });

  it('MUT-737 (AC6): counts the step shown once, and the choice (Stay on Starter)', async () => {
    trackPortal.mockClear();
    stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok({ ...me([profile()]), plan: { current: 'starter', businesses: null, soloTrialOffer: true } }),
      'POST /v1/billing/solo-trial/offered': () => ok({}),
    });
    const { user } = renderPortal(`/p/${ORG_A}`);
    await user.click(await screen.findByTestId('solo-trial-skip'));
    expect(trackPortal.mock.calls.filter(([event]) => event === 'onboarding_plan_shown')).toHaveLength(1);
    expect(trackPortal).toHaveBeenCalledWith('onboarding_plan_chosen', { choice: 'starter' });
  });

  it('is not shown when the server does not offer it', async () => {
    stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok({ ...me([profile()]), plan: { current: 'starter', businesses: null, soloTrialOffer: false } }),
    });
    renderPortal(`/p/${ORG_A}`);
    expect(await screen.findByRole('main')).toBeInTheDocument();
    expect(screen.queryByTestId('solo-trial-step')).not.toBeInTheDocument();
  });

  it('MUT-702 Part B: shows Solo’s live price, then Try Solo asks the billing address and opens the trial Checkout', async () => {
    const assign = vi.fn();
    vi.spyOn(stripeNavigation, 'assign').mockImplementation(assign);
    const api = stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok({ ...me([profile()]), plan: { current: 'starter', businesses: null, soloTrialOffer: true } }),
      'POST /v1/billing/solo-trial/offered': () => ok({}),
      'GET /v1/billing': () =>
        ok({
          configured: true,
          subscription: null,
          canManage: false,
          trial: null,
          catalog: { ILS: null, USD: null },
          countries: { consumer: [], consumerEverywhere: true, customTaxId: [] },
          coveredProfileIds: [],
          offer: null,
          yearlySwitch: null,
          currentPlan: 'starter',
          plans: [{ plan: 'solo', catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } }],
          billingAddress: null,
        }),
      'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.com/c/pay/cs_test_trial' }),
    });
    const { user } = renderPortal(`/p/${ORG_A}`);
    const step = await screen.findByTestId('solo-trial-step');
    expect(await within(step).findByText(/Then ₪39\.00 or \$12\.00 a month/)).toBeInTheDocument();
    await user.click(within(step).getByRole('button', { name: 'Try Solo free for 14 days' }));
    const address = await screen.findByTestId('solo-trial-address');
    await user.type(within(address).getByRole('combobox', { name: 'Country' }), 'Israel');
    await user.type(within(address).getByRole('textbox', { name: 'Address' }), 'Az-Zahra St. 18');
    await user.type(within(address).getByRole('textbox', { name: 'City' }), 'Jerusalem');
    await user.type(within(address).getByRole('textbox', { name: 'Postal code' }), '9100000');
    expect(within(address).getByText(/Then ₪39\.00 \+ VAT a month/)).toBeInTheDocument();
    await user.click(within(address).getByRole('button', { name: 'Continue to payment' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/checkout-session')?.body).toEqual({
      plan: 'solo',
      trial: true,
      interval: 'month',
      buyer: 'person',
      country: 'IL',
      address: { country: 'IL', line1: 'Az-Zahra St. 18', city: 'Jerusalem', postalCode: '9100000' },
      returnPath: '/',
    });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_trial'));
  });
});
