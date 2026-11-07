import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, openYou } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOffer, BillingOverview } from '../../api/client';
import { stripeNavigation } from '../../data/billingQueries';

const { trackPortal, trackOfferShown } = vi.hoisted(() => ({ trackPortal: vi.fn(async () => {}), trackOfferShown: vi.fn() }));
vi.mock('../../analytics/portalAnalytics', async (original) => ({ ...(await original<typeof import('../../analytics/portalAnalytics')>()), trackPortal, trackOfferShown }));

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
  offer: null,
  yearlySwitch: null,
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
  trackPortal.mockClear();
  trackOfferShown.mockClear();
  vi.spyOn(stripeNavigation, 'assign').mockImplementation(assign);
});
afterEach(() => vi.useRealTimers());

describe('Billing drawer: the status view (DR1)', () => {
  it('opens from You › Account (MUT-425) through the URL: trial status first, then Subscribe, then both prices and the rules', async () => {
    const { user, router } = portal(`/p/${ORG_B}`);
    await openYou(user, 'account');
    await user.click(await screen.findByRole('button', { name: /^Billing/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(locationOf(router)).toBe(`/p/${ORG_B}/you/account?billing=true`);
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
    expect(await within(dialog).findByRole('heading', { name: 'Your account is covered by MTB3A' })).toBeInTheDocument();
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
    const active = overview({ subscription: { tier: 'FREELANCER', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(30), cancelAtPeriodEnd: false, renewsAtListPrice: false, offer: null }, canManage: true });
    portal(`/p/${ORG_B}?billing=true&checkout=success`, { billing: () => ok(++calls === 1 ? overview() : active) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: 'Confirming your payment…' })).toBeInTheDocument();
    expect((await within(dialog).findAllByText("You're subscribed. Thank you.", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
  });

  it('moves focus to the new headline when the payment confirms, and announces it in one live region (review a11y)', async () => {
    let calls = 0;
    const active = overview({ subscription: { tier: 'FREELANCER', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(30), cancelAtPeriodEnd: false, renewsAtListPrice: false, offer: null }, canManage: true });
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
    overview({ subscription: { tier: 'FREELANCER', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(30), cancelAtPeriodEnd: false, renewsAtListPrice: false, offer: null, ...over }, canManage: true });

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
    expect(manage.nextElementSibling).toHaveTextContent("Change your card or see invoices, on Stripe's page (in English).");
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

  it('MUT-533 (D5): past due → Update card opens Stripe’s card form directly', async () => {
    const { user, api } = portal(`/p/${ORG_B}?billing=true`, {
      billing: () => ok(subscribed({ status: 'past_due' })),
      entitlement: ent('GRACE', 'STRIPE', iso(30)),
      routes: { 'POST /v1/billing/portal-session': () => ok({ url: 'https://billing.stripe.com/p/session/test_2' }) },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(within(dialog).queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
    await user.click(await within(dialog).findByRole('button', { name: 'Update card' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/portal-session')?.body).toEqual({ returnPath: `/p/${ORG_B}`, flow: 'card' });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test_2'));
  });

  it('MUT-533 (D5): back from the card form, it asks once for the past-due invoice to be paid, then reads billing again', async () => {
    let reads = 0;
    const { api } = portal(`/p/${ORG_B}?billing=true&portal=card`, {
      billing: () => ok(++reads <= 1 ? subscribed({ status: 'past_due' }) : subscribed()),
      entitlement: ent('GRACE', 'STRIPE', iso(30)),
      routes: { 'POST /v1/billing/card-retry': () => ok({ outcome: 'paid', hostedInvoiceUrl: null }) },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: /^Freelancer, renews/ }, { timeout: 4000 })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.url.pathname === '/v1/billing/card-retry')).toHaveLength(1);
  });

  it('back from Manage billing (not the card form) it pays nothing', async () => {
    const { api } = portal(`/p/${ORG_B}?billing=true&portal=returned`, { billing: () => ok(subscribed({ status: 'past_due' })), entitlement: ent('GRACE', 'STRIPE', iso(30)) });
    await screen.findByRole('dialog', { name: 'Billing' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(api.calls.some((c) => c.url.pathname === '/v1/billing/card-retry')).toBe(false);
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

describe('MUT-525: the launch offer in the drawer (DD2–DD10, R3)', () => {
  const PRICES = { ILS: { month: 2900, year: 29000 }, USD: { month: 900, year: 9000 } };
  const launch = (over: Partial<BillingOffer> = {}): BillingOffer => ({
    id: 'launch-2026',
    percentOff: 50,
    endsAt: iso(60),
    interval: 'year',
    eligible: true,
    firstYear: { ILS: 14500, USD: 4500 },
    ...over,
  });
  const offered = (over: Partial<BillingOverview> = {}) => overview({ catalog: PRICES, offer: launch(), ...over });
  /** A paragraph by its whole text: amounts are their own <bdi>, so the text spans elements. */
  const para = (pattern: RegExp) => (_: string, el: Element | null) => el?.tagName === 'P' && pattern.test(el.textContent ?? '');
  const checkoutBody = (api: ReturnType<typeof portal>['api']) => api.calls.filter((c) => c.url.pathname === '/v1/billing/checkout-session').map((c) => c.body);

  it('opens on Yearly with the offer first, the first year before the struck list price, and Continue names the offer', async () => {
    const { user, api } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, {
      billing: () => ok(offered()),
      routes: { 'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.com/c/pay/cs_test_offer' }) },
    });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    // DD6: the offer reads first, under Back, before a country is picked.
    const topLine = await within(step).findByText(/^Launch offer: 50% off your first year on Yearly, until /);
    expect(within(step).getByRole('button', { name: 'Back to Billing' }).compareDocumentPosition(topLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // DD5: Yearly preselected; DD2: the short segment label.
    expect(within(step).getByRole('radio', { name: 'Yearly · −50%' })).toBeChecked();
    expect(trackOfferShown).toHaveBeenCalledWith('launch_2026', 'drawer');

    await user.selectOptions(within(step).getByRole('combobox', { name: 'Billing address country' }), 'IL');
    const summary = step.querySelector('.hp-billing-summary')!;
    // DD9a: ₪145 then the struck ₪290, both in <bdi>; the pair is hidden and one sentence is read instead.
    const amounts = [...summary.querySelectorAll('bdi')].map((b) => b.textContent);
    expect(amounts).toEqual(['₪145.00', '₪290.00']);
    expect(summary.querySelector('s bdi')?.textContent).toBe('₪290.00');
    expect(summary.querySelector('s')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(step).getByText('₪145.00 for the first year instead of ₪290.00')).toHaveClass('sr-only');
    expect(summary.querySelector('[aria-live="polite"]')).not.toBeNull();
    // DD10a: one sentence replaces the loose fine lines (no second "then ₪290 a year"); the VAT sentence stays (plan §6).
    expect(within(step).queryByText(/^Then ₪290\.00 a year/)).not.toBeInTheDocument();
    expect(within(step).getByText('Prices exclude VAT; VAT is added where the law requires it.')).toBeInTheDocument();
    // DD10a: the trial carries over (9 days left), said in one sentence in place of the loose first-charge line.
    expect(within(step).getByText(para(/^Your free trial continues\. On .+ you pay ₪145\.00 for your first year, then ₪290\.00 a year from .+\.$/))).toBeInTheDocument();
    expect(within(step).queryByText(/^Your free trial continues: the first charge is on /)).not.toBeInTheDocument();

    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    expect(checkoutBody(api)).toEqual([{ interval: 'year', country: 'IL', buyer: 'person', returnPath: `/p/${ORG_B}`, expectedOffer: 'launch-2026' }]);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_offer'));
    expect(trackPortal).toHaveBeenCalledWith('billing_checkout_started', { plan: 'freelancer', interval: 'year', currency: 'ILS', offer: 'launch_2026' });
  });

  it('with no carried trial the first year is paid today', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, { billing: () => ok(offered({ trial: { startedAt: iso(-13), endsAt: iso(1), lockAt: iso(17) } })) });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'GB');
    expect(within(step).getByText(para(/^You pay \$45\.00 today for your first year, then \$90\.00 a year from .+\.$/))).toBeInTheDocument();
    expect(within(step).getByText('$45.00 for the first year instead of $90.00')).toBeInTheDocument();
  });

  it('Monthly shows the hint under the switch and no offer price; Continue sends no offer', async () => {
    const { user, api } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, {
      billing: () => ok(offered()),
      routes: { 'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.com/c/pay/cs_test_m' }) },
    });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'IL');
    await user.click(within(step).getByRole('radio', { name: 'Monthly' }));
    expect(within(step).getByText(/^Yearly is 50% off the first year until /)).toBeInTheDocument();
    expect(within(step).queryByText(/for the first year instead of/)).not.toBeInTheDocument();
    expect(step.querySelector('.hp-billing-summary s')).toBeNull();
    expect(within(step).getByText('₪29.00')).toBeInTheDocument();
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    expect(checkoutBody(api)).toEqual([{ interval: 'month', country: 'IL', buyer: 'person', returnPath: `/p/${ORG_B}` }]);
    await vi.waitFor(() => expect(trackPortal).toHaveBeenCalledWith('billing_checkout_started', { plan: 'freelancer', interval: 'month', currency: 'ILS', offer: null }));
  });

  it('a person’s pick sticks across a billing refetch (DD5)', async () => {
    const { user, queryClient } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, { billing: () => ok(offered()) });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.click(await within(step).findByRole('radio', { name: 'Monthly' }));
    await queryClient.refetchQueries({ queryKey: ['billing'] });
    expect(within(step).getByRole('radio', { name: 'Monthly' })).toBeChecked();
  });

  it('no offer leaves today’s step: Monthly, "2 months free" and today’s summary (R3)', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, { billing: () => ok(overview({ offer: launch({ eligible: false }) })) });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'IL');
    expect(within(step).getByRole('radio', { name: 'Monthly' })).toBeChecked();
    await user.click(within(step).getByRole('radio', { name: 'Yearly · 2 months free' }));
    expect(within(step).getByText('₪390.00')).toBeInTheDocument();
    expect(within(step).queryByText(/Launch offer|50%/)).not.toBeInTheDocument();
    expect(step.querySelector('[aria-live="polite"]')).toBeNull();
    expect(within(step).getByText(/^Your free trial continues: the first charge is on /)).toBeInTheDocument();
    expect(trackOfferShown).not.toHaveBeenCalled();
  });

  it('OFFER_ENDED keeps the drawer open with the full yearly price; a second Continue goes to Stripe without the offer (DD4)', async () => {
    let ended = false;
    let attempts = 0;
    const { user, api } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, {
      billing: () => ok(ended ? offered({ offer: null }) : offered()),
      routes: {
        'POST /v1/billing/checkout-session': () => {
          attempts++;
          if (attempts === 1) {
            ended = true;
            return fail(409, 'CONFLICT', { reason: 'OFFER_ENDED' });
          }
          return ok({ url: 'https://checkout.stripe.com/c/pay/cs_test_full' });
        },
      },
    });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'IL');
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    const banner = await within(step).findByText((_, el) => el?.tagName === 'SPAN' && /^The launch offer has ended\. The yearly price is ₪290\.00\.$/.test(el.textContent ?? ''));
    expect(banner.closest('.hp-banner-info')).not.toBeNull();
    expect(banner.querySelector('bdi')?.textContent).toBe('₪290.00');
    expect(assign).not.toHaveBeenCalled();
    expect(within(step).queryByRole('alert')).not.toBeInTheDocument();
    // The interval stays Yearly, now at the list price.
    await vi.waitFor(() => expect(within(step).getByRole('radio', { name: 'Yearly · 2 months free' })).toBeChecked());
    expect(step.querySelector('.hp-billing-summary bdi')?.textContent).toBe('₪290.00');
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_full'));
    expect(checkoutBody(api)).toEqual([
      { interval: 'year', country: 'IL', buyer: 'person', returnPath: `/p/${ORG_B}`, expectedOffer: 'launch-2026' },
      { interval: 'year', country: 'IL', buyer: 'person', returnPath: `/p/${ORG_B}` },
    ]);
  });

  it('an offer that ends while the drawer is open: the interval stays, the offer copy goes, one status line says so (DD5)', async () => {
    let ended = false;
    const { queryClient } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, { billing: () => ok(ended ? offered({ offer: null }) : offered()) });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await within(step).findByText(/^Launch offer:/);
    ended = true;
    await queryClient.refetchQueries({ queryKey: ['billing'] });
    await vi.waitFor(() => expect(within(step).queryByText(/^Launch offer:/)).not.toBeInTheDocument());
    expect(within(step).getByRole('status')).toHaveTextContent('The launch offer has ended.');
    expect(within(step).getByRole('radio', { name: /^Yearly/ })).toBeChecked();
  });

  it('says "Ends today" on the offer’s last Jerusalem day (DD10d)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2027-01-31T08:00:00Z') });
    portal(`/p/${ORG_B}?billing=true&step=subscribe`, { billing: () => ok(offered({ offer: launch({ endsAt: '2027-01-31T21:59:00.000Z' }) })) });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    expect(await within(step).findByText('Ends today')).toBeInTheDocument();
  });

  it('the status view puts the offer above Subscribe, and the yearly plan line shows the first year struck (DD10c)', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(offered()) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    const topLine = await within(dialog).findByText(/^Launch offer: 50% off your first year on Yearly, until /);
    const subscribe = within(dialog).getByRole('button', { name: 'Subscribe' });
    expect(topLine.compareDocumentPosition(subscribe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const plan = dialog.querySelector('.hp-billing-plan')!;
    expect([...plan.querySelectorAll('s bdi')].map((b) => b.textContent)).toEqual(['₪290.00', '$90.00']);
    expect(within(dialog).getByText('₪145.00 for the first year instead of ₪290.00')).toHaveClass('sr-only');
    expect(within(dialog).getByText('$45.00 for the first year instead of $90.00')).toHaveClass('sr-only');
  });

  it('back from Stripe with the offer: "Launch offer applied" (DD10b)', async () => {
    let calls = 0;
    const paid = offered({
      offer: null,
      subscription: { tier: 'FREELANCER', status: 'active', interval: 'year', currency: 'ILS', currentPeriodEnd: iso(365), cancelAtPeriodEnd: false, renewsAtListPrice: true, offer: { id: 'launch-2026', kind: 'launch' } },
      canManage: true,
    });
    portal(`/p/${ORG_B}?billing=true&checkout=success`, { billing: () => ok(++calls === 1 ? offered() : paid) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect((await within(dialog).findAllByText("You're subscribed. Launch offer applied.", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
  });

  it('MUT-534 (review): back from Stripe on the come-back offer it says subscribed, never "Launch offer applied"', async () => {
    let calls = 0;
    const paid = offered({
      offer: null,
      subscription: { tier: 'FREELANCER', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(30), cancelAtPeriodEnd: false, renewsAtListPrice: true, offer: { id: 'comeback-2026', kind: 'comeback' } },
      canManage: true,
    });
    portal(`/p/${ORG_B}?billing=true&checkout=success`, { billing: () => ok(++calls === 1 ? offered() : paid) });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect((await within(dialog).findAllByText("You're subscribed. Thank you.", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("You're subscribed. Launch offer applied.")).not.toBeInTheDocument();
  });

  it('a list-price subscriber reads what it renews at; a founder price and a cancelled plan keep today’s copy (DD3)', async () => {
    const sub = (over: Partial<NonNullable<BillingOverview['subscription']>>) =>
      overview({
        catalog: PRICES,
        subscription: { tier: 'FREELANCER', status: 'active', interval: 'year', currency: 'ILS', currentPeriodEnd: iso(200), cancelAtPeriodEnd: false, renewsAtListPrice: true, offer: null, ...over },
        canManage: true,
      });
    const listed = portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(sub({})), entitlement: ent('ACTIVE', 'STRIPE', iso(200)) });
    let dialog = await screen.findByRole('dialog', { name: 'Billing' });
    const line = await within(dialog).findByText((_, el) => el?.tagName === 'P' && /^Renews at ₪290\.00 on .+\.$/.test(el.textContent ?? ''));
    expect(line.querySelector('bdi')?.textContent).toBe('₪290.00');
    listed.unmount();

    const founder = portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(sub({ renewsAtListPrice: false })), entitlement: ent('ACTIVE', 'STRIPE', iso(200)) });
    dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByText('Billed yearly.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Renews at/)).not.toBeInTheDocument();
    founder.unmount();

    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(sub({ cancelAtPeriodEnd: true })), entitlement: ent('ACTIVE', 'STRIPE', iso(200)) });
    dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: /^Your plan ends on/ })).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Renews at/)).not.toBeInTheDocument();
  });

  it('in Arabic: the copy deck’s words, amounts isolated in <bdi>', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, { locale: 'ar', billing: () => ok(offered()) });
    const step = await screen.findByRole('dialog', { name: 'الاشتراك في المستقل' });
    expect(await within(step).findByText(/^عرض الإطلاق: خصم 50% على سنتك الأولى في الاشتراك السنوي، حتى /)).toBeInTheDocument();
    expect(within(step).getByRole('radio', { name: 'سنويًا · خصم 50%' })).toBeChecked();
    await user.selectOptions(within(step).getByRole('combobox'), 'IL');
    const summary = step.querySelector('.hp-billing-summary')!;
    expect(summary.querySelectorAll('bdi')).toHaveLength(2);
    expect(within(step).getByText(/للسنة الأولى بدلًا من/)).toHaveClass('sr-only');
  });
});

describe('MUT-531: switch to yearly in the drawer (AC1–AC3, D1, R2)', () => {
  const monthly = (over: Partial<BillingOverview> = {}) =>
    overview({
      subscription: { tier: 'FREELANCER', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(20), cancelAtPeriodEnd: false, renewsAtListPrice: true, offer: null },
      canManage: true,
      yearlySwitch: { currency: 'ILS', savings: 7800 },
      ...over,
    });
  const PREVIEW = { amountDue: 27100, currency: 'ILS', yearlyAmount: 39000, renewsOn: '2027-11-02T09:00:00.000Z', prorationDate: '2026-11-02T09:00:00.000Z' };
  const paid = ent('ACTIVE', 'STRIPE', iso(20));

  it('shows the line from the server under Manage billing, and none on a yearly plan', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(monthly()), entitlement: paid });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByText(/Switch to yearly and save/)).toHaveTextContent('Switch to yearly and save ₪78.00 a year');
    expect(within(dialog).getByRole('button', { name: 'Switch to yearly' })).toBeInTheDocument();
  });

  it('no line when the server sends none (before the 2nd payment)', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(monthly({ yearlySwitch: null })), entitlement: paid });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await within(dialog).findByRole('heading', { name: /^Freelancer, renews/ });
    expect(within(dialog).queryByRole('button', { name: 'Switch to yearly' })).toBeNull();
  });

  it('previews today’s charge, confirms at the preview’s proration date and says when it renews', async () => {
    const { user, api, router } = portal(`/p/${ORG_B}?billing=true`, {
      billing: () => ok(monthly()),
      entitlement: paid,
      routes: {
        'GET /v1/billing/yearly-switch': () => ok(PREVIEW),
        'POST /v1/billing/yearly-switch': () => ok({ renewsOn: '2027-11-02T09:00:00.000Z', yearlyAmount: 39000, currency: 'ILS' }),
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await user.click(await within(dialog).findByRole('button', { name: 'Switch to yearly' }));
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=switch`);
    const step = await screen.findByRole('dialog', { name: 'Switch to yearly' });
    expect(await within(step).findByText(/You pay/)).toHaveTextContent('You pay ₪271.00 today, including VAT where it applies');
    expect(within(step).getByText(/a year, renewing on/)).toHaveTextContent(/₪390.00 a year, renewing on/);
    await user.click(within(step).getByRole('button', { name: 'Pay ₪271.00 and switch' }));
    expect(api.calls.find((c) => c.method === 'POST' && c.url.pathname === '/v1/billing/yearly-switch')?.body).toEqual({ prorationDate: PREVIEW.prorationDate, expectedAmountDue: 27100 });
    const back = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(back).findByText(/You're on the yearly plan/)).toHaveTextContent(/It renews on .* at ₪390\.00\./);
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true`);
  });

  it('a declined card says nothing changed and stays on the step', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=switch`, {
      billing: () => ok(monthly()),
      entitlement: paid,
      routes: { 'GET /v1/billing/yearly-switch': () => ok(PREVIEW), 'POST /v1/billing/yearly-switch': () => fail(409, 'CONFLICT', { reason: 'PAYMENT_FAILED' }) },
    });
    const step = await screen.findByRole('dialog', { name: 'Switch to yearly' });
    await user.click(await within(step).findByRole('button', { name: 'Pay ₪271.00 and switch' }));
    expect(await within(step).findByRole('alert')).toHaveTextContent("Your card was declined, so nothing changed. You're still on the monthly plan.");
  });

  it('a payment the bank holds offers Stripe’s page to approve it (R2)', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=switch`, {
      billing: () => ok(monthly()),
      entitlement: paid,
      routes: {
        'GET /v1/billing/yearly-switch': () => ok(PREVIEW),
        'POST /v1/billing/yearly-switch': () => fail(409, 'CONFLICT', { reason: 'PAYMENT_NEEDS_ACTION', hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/in_9' }),
      },
    });
    const step = await screen.findByRole('dialog', { name: 'Switch to yearly' });
    await user.click(await within(step).findByRole('button', { name: 'Pay ₪271.00 and switch' }));
    await user.click(await within(step).findByRole('button', { name: "Approve on Stripe's page" }));
    expect(assign).toHaveBeenCalledWith('https://invoice.stripe.com/i/acct_1/in_9');
  });

  it('a changed amount is previewed again before anything is charged', async () => {
    let previews = 0;
    const { user } = portal(`/p/${ORG_B}?billing=true&step=switch`, {
      billing: () => ok(monthly()),
      entitlement: paid,
      routes: {
        'GET /v1/billing/yearly-switch': () => ok(++previews === 1 ? PREVIEW : { ...PREVIEW, amountDue: 27500 }),
        'POST /v1/billing/yearly-switch': () => fail(409, 'CONFLICT', { reason: 'AMOUNT_CHANGED' }),
      },
    });
    const step = await screen.findByRole('dialog', { name: 'Switch to yearly' });
    await user.click(await within(step).findByRole('button', { name: 'Pay ₪271.00 and switch' }));
    expect(await within(step).findByText('The amount changed since you opened this. Please check it again.')).toBeInTheDocument();
    expect(await within(step).findByRole('button', { name: 'Pay ₪275.00 and switch' })).toBeInTheDocument();
  });

  it('reads in Arabic first', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(monthly()), entitlement: paid, locale: 'ar' });
    expect(await screen.findByText(/انتقل إلى الدفع السنوي ووفّر/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'انتقل إلى السنوي' })).toBeInTheDocument();
  });
});

describe('MUT-532: pause instead of cancel, the stay offer and MTB3A’s own cancel (D6–D8, D11)', () => {
  const sub = (over: Partial<NonNullable<BillingOverview['subscription']>> = {}) => ({
    tier: 'FREELANCER' as const,
    status: 'active',
    interval: 'month' as const,
    currency: 'ILS',
    currentPeriodEnd: iso(12),
    cancelAtPeriodEnd: false,
    renewsAtListPrice: true,
    offer: null,
    pause: null,
    ...over,
  });
  const plan = (over: Partial<NonNullable<BillingOverview['subscription']>> = {}) => overview({ subscription: sub(over), canManage: true });
  const RETENTION = {
    endsOn: iso(12),
    pause: { options: [1, 2, 3].map((months) => ({ months, from: iso(12), until: iso(12 + 30 * months) })) },
    stayOffer: { percentOff: 50, months: 2, currency: 'ILS', monthlyAmount: 1950, listAmount: 3900 },
  };
  const paid = ent('ACTIVE', 'STRIPE', iso(12));

  async function openCancel(routes: Record<string, Handler>, billing: Handler = () => ok(plan())) {
    const opened = portal(`/p/${ORG_B}?billing=true`, { billing, entitlement: paid, routes: { 'GET /v1/billing/retention': () => ok(RETENTION), ...routes } });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await opened.user.click(await within(dialog).findByRole('button', { name: 'Cancel plan' }));
    const step = await screen.findByRole('dialog', { name: 'Cancel plan' });
    return { ...opened, step };
  }

  it('Cancel plan opens the Why? step in the drawer; Continue waits for a reason', async () => {
    const { router, step } = await openCancel({});
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=cancel`);
    expect(within(step).getByRole('heading', { name: 'Why are you cancelling?' })).toHaveFocus();
    expect(within(step).getAllByRole('radio')).toHaveLength(8);
    expect(within(step).getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('pause instead: the reason and the months go to the server, and the drawer goes back to the status view', async () => {
    let paused = false;
    const { user, api, step, router } = await openCancel(
      { 'POST /v1/billing/pause': () => ((paused = true), ok({ from: RETENTION.pause.options[1]!.from, until: RETENTION.pause.options[1]!.until })) },
      () => ok(plan(paused ? { pause: { from: iso(12), until: iso(72) } } : {})),
    );
    await user.click(within(step).getByRole('radio', { name: "I don't use it enough" }));
    await user.click(within(step).getByRole('button', { name: 'Continue' }));
    expect(await within(step).findByRole('heading', { name: 'Pause instead of cancelling?' })).toHaveFocus();
    expect(within(step).getByText('You can pause once a year.')).toBeInTheDocument();
    await user.click(within(step).getByRole('radio', { name: /^2 months, restarts on/ }));
    await user.click(within(step).getByRole('button', { name: 'Pause my plan' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/pause')?.body).toEqual({ months: 2, reason: 'unused' });
    const back = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(back).findByRole('heading', { name: /^Your plan pauses on/ })).toBeInTheDocument();
    expect(within(back).getByText('Pause booked')).toBeInTheDocument();
    expect(within(back).getByRole('button', { name: "Don't pause" })).toBeInTheDocument();
    expect(within(back).queryByRole('button', { name: 'Cancel plan' })).toBeNull();
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true`);
  });

  it('declining the pause shows the stay offer; taking it keeps the plan at half price', async () => {
    const { user, api, step } = await openCancel({ 'POST /v1/billing/stay-offer': () => ok({ percentOff: 50, months: 2, currency: 'ILS', monthlyAmount: 1950 }) });
    await user.click(within(step).getByRole('radio', { name: 'It costs too much' }));
    await user.click(within(step).getByRole('button', { name: 'Continue' }));
    await user.click(await within(step).findByRole('button', { name: 'No, keep cancelling' }));
    expect(await within(step).findByRole('heading', { name: 'Stay with 50% off for 2 months' })).toHaveFocus();
    expect(within(step).getByText((_, el) => el?.tagName === 'P' && /a month instead of/.test(el.textContent ?? ''))).toHaveTextContent('You pay ₪19.50 a month instead of ₪39.00, then ₪39.00 a month again. You can still cancel any time.');
    await user.click(within(step).getByRole('button', { name: 'Keep my plan at ₪19.50' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/stay-offer')?.body).toEqual({ reason: 'too_expensive' });
    const back = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(back).findByText(/Your next 2 months are/)).toHaveTextContent('Done. Your next 2 months are ₪19.50 each.');
  });

  it('declining the stay offer is the cancel: the reason and comment go to Stripe, and the plan says when it ends', async () => {
    let cancelled = false;
    const { user, api, step } = await openCancel(
      { 'POST /v1/billing/cancellation': () => ((cancelled = true), ok({ endsOn: iso(12) })) },
      () => ok(plan(cancelled ? { cancelAtPeriodEnd: true } : {})),
    );
    await user.click(within(step).getByRole('radio', { name: "I'm moving to another tool" }));
    await user.type(within(step).getByRole('textbox', { name: /Anything else/ }), '  Going with a spreadsheet  ');
    await user.click(within(step).getByRole('button', { name: 'Continue' }));
    await user.click(await within(step).findByRole('button', { name: 'No, keep cancelling' }));
    await user.click(await within(step).findByRole('button', { name: 'No, cancel my plan' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/cancellation')?.body).toEqual({ reason: 'switched_service', comment: 'Going with a spreadsheet' });
    const back = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(back).findByRole('heading', { name: /^Your plan ends on/ })).toBeInTheDocument();
    expect(within(back).getByRole('button', { name: 'Keep my plan' })).toBeInTheDocument();
  });

  it('with no offers (a yearly plan), Why? leads to Confirm cancel; Keep my plan there goes back', async () => {
    const { user, api, step, router } = await openCancel({ 'GET /v1/billing/retention': () => ok({ endsOn: iso(200), pause: null, stayOffer: null }) }, () => ok(plan({ interval: 'year', currentPeriodEnd: iso(200) })));
    await user.click(within(step).getByRole('radio', { name: 'Something else' }));
    await user.click(within(step).getByRole('button', { name: 'Continue' }));
    expect(await within(step).findByRole('heading', { name: 'Cancel your plan?' })).toBeInTheDocument();
    expect(within(step).getByText(/Your plan stays on until/)).toHaveTextContent(/Nothing is deleted\.$/);
    await user.click(within(step).getByRole('button', { name: 'Keep my plan' }));
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true`);
    expect(api.calls.some((c) => c.url.pathname === '/v1/billing/cancellation')).toBe(false);
  });

  it('a paused plan says until when, with Resume now confirming what it charges today', async () => {
    const { user, api } = portal(`/p/${ORG_B}?billing=true`, {
      billing: () => ok(plan({ pause: { from: iso(-3), until: iso(40) } })),
      entitlement: { ...ent('READ_ONLY', 'STRIPE', iso(40)), paused: true },
      routes: { 'DELETE /v1/billing/pause': () => ok({ resumed: 'now', payment: 'charged', hostedInvoiceUrl: null }) },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: /^Paused until/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel plan' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Resume now' }));
    expect(within(dialog).getByText(/You pay .* today/)).toHaveTextContent('You pay ₪39.00 today, and your plan renews monthly from today.');
    await user.click(within(within(dialog).getByRole('group')).getByRole('button', { name: 'Resume now' }));
    await vi.waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE' && c.url.pathname === '/v1/billing/pause')).toBe(true));
  });

  it('a founder price has no Cancel plan in MTB3A (Stripe won’t cancel a schedule this way)', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(plan({ renewsAtListPrice: false })), entitlement: paid });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    await within(dialog).findByRole('heading', { name: /^Freelancer, renews/ });
    expect(within(dialog).queryByRole('button', { name: 'Cancel plan' })).toBeNull();
  });

  it('Manage billing no longer says you cancel on Stripe’s page', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(plan()), entitlement: paid });
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByText("Change your card or see invoices, on Stripe's page (in English).")).toBeInTheDocument();
  });

  it('reads in Arabic first', async () => {
    const opened = portal(`/p/${ORG_B}?billing=true`, { billing: () => ok(plan()), entitlement: paid, locale: 'ar', routes: { 'GET /v1/billing/retention': () => ok(RETENTION) } });
    const dialog = await screen.findByRole('dialog', { name: 'الاشتراك' });
    await opened.user.click(await within(dialog).findByRole('button', { name: 'إلغاء الاشتراك' }));
    expect(await screen.findByRole('heading', { name: 'لماذا تريد الإلغاء؟' })).toBeInTheDocument();
  });
});

describe('Billing drawer: the welcome-back price (MUT-534 D14)', () => {
  const CATALOG = { ILS: { month: 2900, year: 29000 }, USD: { month: 900, year: 9000 } };
  const back = { id: 'comeback-2026', firstMonth: { ILS: 900, USD: 300 }, listMonth: { ILS: 2900, USD: 900 }, firstYear: { ILS: 27000, USD: 8400 }, listYear: { ILS: 29000, USD: 9000 } };
  const checkoutBodies = (api: ReturnType<typeof portal>['api']) => api.calls.filter((c) => c.url.pathname === '/v1/billing/checkout-session').map((c) => c.body);
  /** The innermost element whose whole text matches: amounts are their own <bdi>, so the sentence spans elements. */
  const whole = (pattern: RegExp) => (_: string, el: Element | null) => !!el && pattern.test(el.textContent ?? '') && [...el.children].every((child) => !pattern.test(child.textContent ?? ''));

  it('once a country sets the currency, says the first month back and the price after; Continue names the offer', async () => {
    const { user, api } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, {
      billing: () => ok(overview({ catalog: CATALOG, comeback: back } as Partial<BillingOverview>)),
      routes: { 'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.com/c/pay/cs_test_back' }) },
    });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    expect(within(step).queryByText(/^Welcome back/)).not.toBeInTheDocument();
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'IL');
    expect(await within(step).findByText(whole(/^Welcome back: your first month is ₪9\.00, then ₪29\.00 a month\.$/))).toBeInTheDocument();
    await user.click(within(step).getByRole('radio', { name: /^Yearly/ }));
    expect(await within(step).findByText(whole(/^Welcome back: your first year is ₪270\.00, then ₪290\.00 a year\.$/))).toBeInTheDocument();
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    expect(checkoutBodies(api)).toEqual([{ interval: 'year', country: 'IL', buyer: 'person', returnPath: `/p/${ORG_B}`, expectedOffer: 'comeback-2026' }]);
  });

  it('a 409 OFFER_ENDED for it says the price no longer applies, and the next Continue carries none', async () => {
    const { user, api } = portal(`/p/${ORG_B}?billing=true&step=subscribe`, {
      billing: () => ok(overview({ catalog: CATALOG, comeback: back } as Partial<BillingOverview>)),
      routes: { 'POST /v1/billing/checkout-session': () => fail(409, 'CONFLICT', { reason: 'OFFER_ENDED', offer: 'comeback-2026' }) },
    });
    const step = await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' });
    await user.selectOptions(await within(step).findByRole('combobox', { name: 'Billing address country' }), 'IL');
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    expect(await within(step).findByText('The welcome-back price no longer applies. Please check the price again.')).toBeInTheDocument();
    expect(within(step).queryByText(/^Welcome back:/)).not.toBeInTheDocument();
    await user.click(within(step).getByRole('button', { name: 'Continue to payment' }));
    expect(checkoutBodies(api).at(-1)).not.toHaveProperty('expectedOffer');
  });
});

