import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview } from '../../api/client';
import { stripeNavigation } from '../../data/billingQueries';

/**
 * MUT-362 (plan §2.7–§2.8, design review DR1–DR13): Settings › Billing through the real portal, the account menu, the
 * router and the query client, with /v1 stubbed. Stripe's pages are never reached: the drawer's redirect is watched.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const ent = (state: BillingEntitlement['state'], source: BillingEntitlement['source'], until: string | null = null): BillingEntitlement => ({ state, source, tier: 'FREELANCER', until });

const overview = (over: Partial<BillingOverview> = {}): BillingOverview => ({
  configured: true,
  subscription: null,
  canManage: false,
  trial: { startedAt: iso(-5), endsAt: iso(9), lockAt: iso(25) },
  catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1000, year: 10000 } },
  countries: { consumer: ['IL', 'GB'], customTaxId: ['IL', 'JO'] },
  coveredProfileIds: [ORG_B],
  ...over,
});
const SHARED = '33333333-3333-4333-8333-333333333333';
const personal = (billing: BillingEntitlement) => profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing });

function portal(
  path: string,
  opts: { billing?: Handler; entitlement?: BillingEntitlement; locale?: 'en' | 'ar'; routes?: Record<string, Handler>; coOwned?: boolean } = {},
) {
  const shared = profile({ id: SHARED, name: 'Shared Studio', isPersonalDefault: false, owned: true, type: 'BUSINESS', writerOfRecord: null, billing: ent('ACTIVE', 'TRIAL', iso(9)) });
  const profiles = [personal(opts.entitlement ?? ent('ACTIVE', 'TRIAL', iso(9))), ...(opts.coOwned ? [shared] : [])];
  const api = stubApi({
    'GET /v1/me': () => ok(me(profiles, opts.locale ?? 'en')),
    'GET /v1/billing': opts.billing ?? (() => ok(overview())),
    ...emptyProfileRoutes(),
    ...opts.routes,
  });
  return { ...renderPortal(path), api };
}

const assign = vi.fn();
beforeEach(() => {
  assign.mockReset();
  vi.spyOn(stripeNavigation, 'assign').mockImplementation(assign);
});
afterEach(() => vi.useRealTimers());

describe('Billing drawer: the status view (DR1)', () => {
  it('opens from the account menu through the URL: trial status first, then Subscribe, then both prices and the rules', async () => {
    const { user, router } = portal(`/p/${ORG_B}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Billing' }));

    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true`);
    expect(within(dialog).getByText('Free trial')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: '9 days left in your free trial' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
    expect(within(dialog).getByText('₪39.00')).toBeInTheDocument();
    expect(within(dialog).getByText('$10.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Prices exclude VAT; VAT is added where the law requires it.')).toBeInTheDocument();
  });

  it('says "open soon" in place of Subscribe on a server without Stripe (DR5)', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(overview({ configured: false, catalog: { ILS: null, USD: null } })) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByText(/Subscriptions open soon/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('₪39.00')).not.toBeInTheDocument();
  });

  it('a no-expiry grant is covered, with no price and nothing to press (eng review D5)', async () => {
    portal(`/p/${ORG_B}?billing=true`, { entitlement: ent('ACTIVE', 'OPERATOR') });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: 'Your account is covered by Mutaba3a' })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Close']);
    expect(within(dialog).queryByText(/₪/)).not.toBeInTheDocument();
  });

  it('a failed load says so and retries', async () => {
    let attempts = 0;
    const { user } = portal(`/p/${ORG_B}?billing=true`, { billing: () => (++attempts === 1 ? fail(500, 'INTERNAL') : ok(overview())) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Couldn’t load your billing'.replace('’', "'"));
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
  });

  it('a co-owner is told shared profiles are covered by their creator’s plan (review D4)', async () => {
    portal(`/p/${ORG_B}?billing=true`, { coOwned: true });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByText("Shared profiles you co-own are covered by their creator's plan.")).toBeInTheDocument();
    // The shared profile isn't in the person's list: their payment wouldn't cover it.
    expect(within(dialog).queryByText('Shared Studio')).not.toBeInTheDocument();
  });

  it('opens in Arabic first', async () => {
    portal(`/p/${ORG_B}?billing=true`, { locale: 'ar' });
    const dialog = await screen.findByRole('dialog', { name: 'الاشتراك' });
    expect(await within(dialog).findByRole('heading', { name: 'بقيت 9 أيام من تجربتك المجانية' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'اشترك' })).toBeInTheDocument();
  });
});

describe('Billing drawer: the Subscribe step (DR2, DR6, DR7, DR11)', () => {
  it('starts with no country; Israel prices it in shekels; Continue opens Stripe with the choices', async () => {
    const { user, router, api } = portal(`/p/${ORG_B}?billing=true`, { routes: { 'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) } });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await user.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));

    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=subscribe`);
    const country = within(step).getByRole('combobox', { name: 'Billing address country' });
    expect(country).toHaveValue('');
    expect(within(step).getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
    expect(within(step).getByText(/It's in English/)).toBeInTheDocument();

    await user.selectOptions(country, 'IL');
    expect(within(step).getByText('₪39.00')).toBeInTheDocument();
    expect(within(step).getByRole('radio', { name: 'Yearly · 2 months free' })).toBeInTheDocument();
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));

    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/checkout-session')?.body).toEqual({ interval: 'month', country: 'IL', buyer: 'person', returnPath: `/p/${ORG_B}` });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'));
  });

  it('a person outside the consumer countries gets contact us, never the card form; a business can go on (AC2)', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=subscribe`);
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'JO');
    expect(within(step).getByText(/We can't sell to individuals in Jordan yet/)).toBeInTheDocument();
    expect(within(step).getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', expect.stringMatching(/^mailto:/));
    expect(within(step).getByRole('button', { name: 'Continue to payment' })).toBeDisabled();

    await user.click(within(step).getByRole('radio', { name: /For a business/ }));
    expect(within(step).getByText('$10.00')).toBeInTheDocument();
    expect(within(step).getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  });

  it('lists Palestine as Palestine (DR13) and goes back to the status view', async () => {
    const { user, router } = portal(`/p/${ORG_B}?billing=true&step=subscribe`);
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    expect(await within(step).findByRole('option', { name: 'Palestine' })).toHaveValue('PS');
    await user.click(within(step).getByRole('button', { name: 'Back to Billing' }));
    expect(await screen.findByRole('dialog', { name: 'Billing' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true`);
  });

  it('a payment page that won’t open says so and keeps the choices', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, { routes: { 'POST /v1/billing/checkout-session': () => fail(502, 'STRIPE_UNAVAILABLE') } });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'IL');
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    expect(await within(step).findByRole('alert')).toHaveTextContent("We couldn't reach the payment page");
    expect(within(step).getByRole('combobox', { name: 'Billing address country' })).toHaveValue('IL');
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('Billing drawer: back from Stripe (eng review D4)', () => {
  it('confirms while the webhook lands, then says thank you', async () => {
    let calls = 0;
    const active = overview({ subscription: { tier: 'FREELANCER', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(30), cancelAtPeriodEnd: false }, canManage: true });
    portal(`/p/${ORG_B}?billing=true&checkout=success`, { billing: () => ok(++calls === 1 ? overview() : active) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: 'Confirming your payment…' })).toBeInTheDocument();
    expect((await within(dialog).findAllByText("You're subscribed. Thank you.", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
  });

  it('moves focus to the new headline when the payment confirms, and announces it in one live region (review a11y)', async () => {
    let calls = 0;
    const active = overview({ subscription: { tier: 'FREELANCER', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(30), cancelAtPeriodEnd: false }, canManage: true });
    portal(`/p/${ORG_B}?billing=true&checkout=success`, { billing: () => ok(++calls === 1 ? overview() : active) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: 'Confirming your payment…' })).toHaveFocus();
    const headline = await within(dialog).findByRole('heading', { name: /^Freelancer, renews/ }, { timeout: 4000 });
    expect(headline).toHaveFocus();
    expect(within(dialog).getAllByRole('status').map((n) => n.textContent)).toEqual(["You're subscribed. Thank you."]);
  });

  it('a payment slow to show stops polling at 30 s and offers no second Subscribe (review)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    portal(`/p/${ORG_B}?billing=true&checkout=success`, {
      billing: () => {
        calls++;
        return ok(overview());
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await within(dialog).findByRole('heading', { name: 'Confirming your payment…' });
    await vi.advanceTimersByTimeAsync(32_000);
    expect((await within(dialog).findAllByText(/Your payment went through/)).length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    const settled = calls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(settled);
  });

  it('cancelled on Stripe’s page: nothing was charged', async () => {
    portal(`/p/${ORG_B}?billing=true&checkout=cancelled`);
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Nothing was charged.');
  });
});

describe('Billing drawer: Manage billing (AC3, eng review D6/D7)', () => {
  const subscribed = (over: Partial<NonNullable<BillingOverview['subscription']>> = {}) =>
    overview({ subscription: { tier: 'FREELANCER', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(30), cancelAtPeriodEnd: false, ...over }, canManage: true });

  it('opens the Customer Portal for a subscriber', async () => {
    const { user, api } = portal(`/p/${ORG_B}?billing=true`, {
      billing: () => ok(subscribed()),
      entitlement: ent('ACTIVE', 'STRIPE', iso(30)),
      routes: { 'POST /v1/billing/portal-session': () => ok({ url: 'https://billing.stripe.com/p/session/test_1' }) },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await user.click(await within(dialog).findByRole('button', { name: 'Manage billing' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/portal-session')?.body).toEqual({ returnPath: `/p/${ORG_B}` });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test_1'));
  });

  it('back from the Customer Portal, it picks up a cancel the webhook mirrors after the first read', async () => {
    let calls = 0;
    portal(`/p/${ORG_B}?billing=true&portal=returned`, {
      billing: () => ok(++calls === 1 ? subscribed() : subscribed({ cancelAtPeriodEnd: true })),
      entitlement: ent('ACTIVE', 'STRIPE', iso(30)),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: /^Freelancer, renews/ })).toBeInTheDocument();
    expect(await within(dialog).findByRole('heading', { name: /^Your plan ends on/ }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('back from the Customer Portal with nothing changed, it stops polling after 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    portal(`/p/${ORG_B}?billing=true&portal=returned`, {
      billing: () => {
        calls++;
        return ok(subscribed());
      },
      entitlement: ent('ACTIVE', 'STRIPE', iso(30)),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await within(dialog).findByRole('heading', { name: /^Freelancer, renews/ });
    await vi.advanceTimersByTimeAsync(32_000);
    const settled = calls;
    expect(settled).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(settled);
  });

  it('Active says how it’s billed, with the Stripe note under Manage billing (DR6)', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(subscribed()), entitlement: ent('ACTIVE', 'STRIPE', iso(30)) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByText('Billed monthly.')).toBeInTheDocument();
    const manage = within(dialog).getByRole('button', { name: 'Manage billing' });
    expect(manage.nextElementSibling).toHaveTextContent("Change your card, see invoices or cancel, on Stripe's page (in English).");
  });

  it('a first payment still pending (incomplete) is its own state, with Manage billing (review)', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(subscribed({ status: 'incomplete' })), entitlement: ent('READ_ONLY', 'TRIAL') });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: "Your first payment hasn't gone through yet" })).toBeInTheDocument();
    expect(within(dialog).getByText('Payment pending')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
  });

  it('opened without the return marker, it reads once and does not poll', async () => {
    let calls = 0;
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(++calls === 1 ? subscribed() : subscribed({ cancelAtPeriodEnd: true })), entitlement: ent('ACTIVE', 'STRIPE', iso(30)) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: /^Freelancer, renews/ })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(calls).toBe(1);
  });

  it('a cancelled plan says when it ends; an unpaid one sends the person to pay the open invoice', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(subscribed({ cancelAtPeriodEnd: true })), entitlement: ent('ACTIVE', 'STRIPE', iso(30)) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: /^Your plan ends on/ })).toBeInTheDocument();
  });

  it('unpaid → Pay in Manage billing', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(subscribed({ status: 'unpaid' })), entitlement: ent('READ_ONLY', 'STRIPE') });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('button', { name: 'Pay in Manage billing' })).toBeInTheDocument();
    expect(within(dialog).getByText('Payment failed')).toBeInTheDocument();
  });

  it('a failed Manage billing says so under the button that failed (DR4)', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true`, {
      billing: () => ok(subscribed()),
      entitlement: ent('ACTIVE', 'STRIPE', iso(30)),
      routes: { 'POST /v1/billing/portal-session': () => fail(502, 'STRIPE_UNAVAILABLE') },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    const manage = await within(dialog).findByRole('button', { name: 'Manage billing' });
    await user.click(manage);
    const alert = await within(dialog).findByRole('alert');
    expect(manage.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a deleted Stripe customer asks the person to write to us', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true`, {
      billing: () => ok(subscribed()),
      entitlement: ent('ACTIVE', 'STRIPE', iso(30)),
      routes: { 'POST /v1/billing/portal-session': () => fail(409, 'CONFLICT', { reason: 'BILLING_ACCOUNT_NEEDS_HELP' }) },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await user.click(await within(dialog).findByRole('button', { name: 'Manage billing' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("We couldn't open billing for your account");
    expect(within(dialog).getByRole('link', { name: 'Contact us' })).toBeInTheDocument();
  });
});

describe('Billing drawer: refusals and redirects (MUT-362 review)', () => {
  async function continueToPayment(user: Awaited<ReturnType<typeof portal>>['user']) {
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'IL');
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    return step;
  }

  it('a second tab already subscribed is told so, right above Continue, and never sent to Stripe', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, { routes: { 'POST /v1/billing/checkout-session': () => fail(409, 'CONFLICT', { reason: 'ALREADY_SUBSCRIBED' }) } });
    const step = await continueToPayment(user);
    const alert = await within(step).findByRole('alert');
    expect(alert).toHaveTextContent('You already have a subscription');
    expect(alert.closest('.drawer-footer')).not.toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('a refusal the drawer didn’t predict says billing changed and reads it again; too many tries says wait', async () => {
    let billingReads = 0;
    let answer = fail(409, 'CONFLICT', { reason: 'COVERED_BY_GRANT' });
    const { user } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, {
      billing: () => {
        billingReads++;
        return ok(overview());
      },
      routes: { 'POST /v1/billing/checkout-session': () => answer },
    });
    const step = await continueToPayment(user);
    expect(await within(step).findByRole('alert')).toHaveTextContent('Your billing changed since you opened this');
    await vi.waitFor(() => expect(billingReads).toBeGreaterThan(1));
    answer = fail(429, 'RATE_LIMITED');
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    expect(await within(step).findByText(/Too many tries in a minute/)).toBeInTheDocument();
  });

  it('never leaves for a page that isn’t Stripe’s', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, { routes: { 'POST /v1/billing/checkout-session': () => ok({ url: 'https://evil.example/pay' }) } });
    const step = await continueToPayment(user);
    expect(await within(step).findByRole('alert')).toHaveTextContent("We couldn't reach the payment page");
    expect(assign).not.toHaveBeenCalled();
  });

  it('during the trial the step says when the first charge falls (review D2)', async () => {
    portal(`/p/${ORG_B}?billing=true&step=subscribe`);
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    expect(await within(step).findByText(/^Your free trial continues: the first charge is on /)).toBeInTheDocument();
  });

  it('the step’s Back replaces its history entry: browser Back afterwards never reopens the step', async () => {
    const { user, router } = portal(`/p/${ORG_B}?billing=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await user.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    expect(within(step).getByRole('heading', { name: 'Subscribe to Freelancer' })).toHaveFocus();
    await user.click(within(step).getByRole('button', { name: /Back to Billing/ }));
    await screen.findByRole('dialog', { name: 'Billing' });
    router.history.back();
    await vi.waitFor(() => expect(locationOf(router)).not.toContain('step=subscribe'));
  });
});
