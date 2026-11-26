import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview } from '../../api/client';
import { stripeNavigation } from '../../data/billingQueries';

/**
 * MUT-702 Part B (ADR-286, wireframes v3): with plans on sale the Subscribe step shows a plan row (live prices, a limits
 * line, the current plan not offered) and a billing address typed as free text, its country matched to our list.
 */

const PLANS: NonNullable<BillingOverview['plans']> = [
  { plan: 'solo', catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } },
  { plan: 'business', catalog: { ILS: { month: 8900, year: 89000 }, USD: { month: 2700, year: 27000 } }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
  { plan: 'firm', catalog: { ILS: { month: 24900, year: 249000 }, USD: { month: 7500, year: 75000 } }, limits: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 } },
];
const overview = (over: Partial<BillingOverview> = {}): BillingOverview => ({
  configured: true,
  subscription: null,
  canManage: false,
  trial: null,
  catalog: { ILS: { month: 2900, year: 29000 }, USD: { month: 1000, year: 10000 } },
  countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
  coveredProfileIds: [ORG_B],
  offer: null,
  yearlySwitch: null,
  currentPlan: 'starter',
  plans: PLANS,
  billingAddress: null,
  ...over,
});
const starter: BillingEntitlement = { state: 'ACTIVE', source: 'STARTER', tier: 'STARTER', until: null } as BillingEntitlement;

function portal(billing: () => Response, routes: Record<string, Handler> = {}) {
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing: starter })], 'en')),
    'GET /v1/billing': billing,
    ...emptyProfileRoutes(),
    ...routes,
  });
  return { ...renderPortal(`/p/${ORG_B}?billing=true&step=subscribe`), api };
}

const assign = vi.fn();
beforeEach(() => {
  assign.mockReset();
  vi.spyOn(stripeNavigation, 'assign').mockImplementation(assign);
});

describe('Subscribe with plans on sale (MUT-702 Part B)', () => {
  it('lists the plans with both currencies and a limits line until the address names a country', async () => {
    portal(() => ok(overview()));
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    expect(within(step).getByRole('radio', { name: /^Solo · ₪39\.00 or \$12\.00 a month/ })).toBeChecked();
    expect(within(step).getByRole('radio', { name: /^Business · ₪89\.00 or \$27\.00 a month/ })).toBeInTheDocument();
    expect(within(step).getByText('1 business · 50 documents · 100 scans a month')).toBeInTheDocument();
    expect(within(step).getByText('3 businesses · 250 documents · 500 scans a month')).toBeInTheDocument();
    expect(within(step).getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  });

  it('never offers the plan the person is on', async () => {
    portal(() => ok(overview({ currentPlan: 'solo' })));
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    expect(within(step).queryByRole('radio', { name: /^Solo/ })).not.toBeInTheDocument();
    expect(within(step).getByRole('radio', { name: /^Business/ })).toBeChecked();
  });

  it('an Israeli address prices in shekels with + VAT, and Continue sends the plan and the address', async () => {
    const { user, api } = portal(() => ok(overview()), { 'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.com/c/pay/cs_test_9' }) });
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    await user.click(within(step).getByRole('radio', { name: /^Business/ }));
    await user.type(within(step).getByRole('combobox', { name: 'Country' }), 'Israel');
    await user.type(within(step).getByRole('textbox', { name: 'Address' }), 'Az-Zahra St. 18');
    await user.type(within(step).getByRole('textbox', { name: 'City' }), 'Jerusalem');
    await user.type(within(step).getByRole('textbox', { name: 'Postal code' }), '9100000');
    expect(within(step).getByRole('radio', { name: /^Business · ₪89\.00 \+ VAT a month/ })).toBeInTheDocument();
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/checkout-session')?.body).toEqual({
      interval: 'month',
      country: 'IL',
      buyer: 'person',
      returnPath: `/p/${ORG_B}`,
      plan: 'business',
      address: { country: 'IL', line1: 'Az-Zahra St. 18', city: 'Jerusalem', postalCode: '9100000' },
    });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_9'));
  });

  it('a country that matches nothing says so and keeps Continue off', async () => {
    const { user } = portal(() => ok(overview()));
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    await user.type(within(step).getByRole('combobox', { name: 'Country' }), 'Isreal');
    await user.type(within(step).getByRole('textbox', { name: 'Address' }), 'Somewhere 1');
    await user.type(within(step).getByRole('textbox', { name: 'City' }), 'Somewhere');
    await user.type(within(step).getByRole('textbox', { name: 'Postal code' }), '1');
    expect(within(step).getByText('No match')).toBeInTheDocument();
    expect(within(step).getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  });

  it('a returning payer’s address is filled in, and a Jordanian one prices in dollars without + VAT', async () => {
    portal(() => ok(overview({ billingAddress: { country: 'JO', line1: 'Rainbow St. 12', city: 'Amman', postalCode: '11181' } })));
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    expect(within(step).getByRole('combobox', { name: 'Country' })).toHaveValue('Jordan');
    expect(within(step).getByRole('textbox', { name: 'City' })).toHaveValue('Amman');
    expect(within(step).getByRole('radio', { name: /^Solo · \$12\.00 a month/ })).toBeInTheDocument();
    expect(within(step).queryByText(/\+ VAT/)).not.toBeInTheDocument();
    expect(within(step).getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  });

  it('with no plans on sale the Freelancer step is unchanged', async () => {
    portal(() => ok(overview({ plans: [], currentPlan: null })));
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    expect(await within(step).findByRole('combobox', { name: 'Billing address country' })).toHaveValue('');
    expect(within(step).queryByTestId('billing-plan-row')).not.toBeInTheDocument();
  });
});
