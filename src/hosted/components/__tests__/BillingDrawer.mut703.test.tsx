import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview, Me } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-703 (UI half): the launch and come-back offers on Solo, Business and Firm, the first-year line under a plan row,
 * the opening interval, and the change pane's running-offer line. /v1 stubbed; amounts are the server's.
 */

const ENDS_AT = '2027-02-21T22:59:00.000Z';
const LAUNCH = 'launch-plans-2026';
const COMEBACK = 'comeback-plans-2026';
const PLANS = [
  {
    plan: 'solo',
    catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } },
    limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 },
    launch: { id: LAUNCH, firstYear: { ILS: 19500, USD: 6000 } },
  },
  {
    plan: 'business',
    catalog: { ILS: { month: 8900, year: 89000 }, USD: { month: 2700, year: 27000 } },
    limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 },
    launch: { id: LAUNCH, firstYear: { ILS: 44500, USD: 13500 } },
  },
] as NonNullable<BillingOverview['plans']>;
const OFFER = { id: LAUNCH, percentOff: 50, endsAt: ENDS_AT, interval: 'year', eligible: true, firstYear: { ILS: 19500, USD: 6000 } };

const overview = (over: Partial<BillingOverview> = {}): BillingOverview =>
  ({
    configured: true,
    subscription: null,
    canManage: false,
    trial: null,
    catalog: { ILS: null, USD: null },
    countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
    coveredProfileIds: [ORG_B],
    offer: OFFER,
    yearlySwitch: null,
    currentPlan: 'starter',
    plans: PLANS,
    billingAddress: { country: 'IL', line1: '1 Main', city: 'Haifa', postalCode: '12345' },
    usage: undefined,
    ...over,
  }) as BillingOverview;

const STARTER = { state: 'ACTIVE', source: 'STARTER', tier: 'STARTER', until: null } as BillingEntitlement;

function portal(path: string, billing: BillingOverview, routes: Record<string, Handler> = {}) {
  const base = me([profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing: STARTER })], 'en');
  const body: Me = { ...base, billingStanding: 'open', plan: { current: 'starter', businesses: null, soloTrialOffer: false } };
  const api = stubApi({ 'GET /v1/me': () => ok(body), 'GET /v1/billing': () => ok(billing), ...emptyProfileRoutes(), ...routes });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});

describe('the launch offer on a plan Checkout', () => {
  it('opens on Yearly and says the first year under each plan row', async () => {
    portal(`/p/${ORG_B}?billing=true&step=subscribe&billingPlan=business`, overview());
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    expect(await within(step).findByText(/First year ₪445\.00/)).toBeInTheDocument();
    expect(within(step).getByText(/First year ₪195\.00/)).toBeInTheDocument();
  });

  it('Monthly drops the first-year lines', async () => {
    portal(`/p/${ORG_B}?billing=true&step=subscribe&billingPlan=business`, overview());
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    await within(step).findByText(/First year ₪445/);
    fireEvent.click(within(step).getByRole('radio', { name: 'Monthly' }));
    await waitFor(() => expect(within(step).queryByText(/First year/)).not.toBeInTheDocument());
  });

  it('opens on Monthly with no line when the person is not eligible', async () => {
    portal(`/p/${ORG_B}?billing=true&step=subscribe&billingPlan=business`, overview({ offer: { ...OFFER, eligible: false } as BillingOverview['offer'] }));
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    await within(step).findByRole('radio', { name: /^Business/ });
    expect(within(step).queryByText(/First year/)).not.toBeInTheDocument();
  });

  it('Continue sends the plan offer as expectedOffer', async () => {
    const { api } = portal(`/p/${ORG_B}?billing=true&step=subscribe&billingPlan=business`, overview(), {
      'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.test/x' }),
    });
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    await within(step).findByText(/First year ₪445/);
    fireEvent.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(api.count('POST /v1/billing/checkout-session')).toBe(1));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/checkout-session')?.body).toMatchObject({ plan: 'business', interval: 'year', expectedOffer: LAUNCH });
  });
});

describe('the come-back price on a plan', () => {
  const comeback = { id: COMEBACK, firstMonth: { ILS: 2937, USD: 900 }, listMonth: { ILS: 8900, USD: 2700 }, firstYear: null, listYear: null };
  const withComeback = overview({ offer: { ...OFFER, eligible: false } as BillingOverview['offer'], plans: PLANS.map((p) => (p.plan === 'business' ? { ...p, comeback } : p)) as BillingOverview['plans'] });

  it('Monthly: names the first month and the list price of the chosen plan; sends its id', async () => {
    const { api } = portal(`/p/${ORG_B}?billing=true&step=subscribe&billingPlan=business`, withComeback, {
      'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.test/x' }),
    });
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    expect(await within(step).findByText(/₪29\.37/)).toBeInTheDocument();
    fireEvent.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(api.count('POST /v1/billing/checkout-session')).toBe(1));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/checkout-session')?.body).toMatchObject({ expectedOffer: COMEBACK });
  });
});
