import { usageView, type UsageView } from '../usage/caps.js';
import { resetsOn, usageMonthOf } from '../usage/month.js';
import { userSubjectKey } from '../usage/subject.js';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { setupLinkOrigin } from '../auth/account-setup.js';
import {
  accountantCatalogFrom,
  accountantCheckoutRefusalOf,
  ALL_ACCOUNTANT_LOOKUP_KEYS,
  ALL_GA_LOOKUP_KEYS,
  checkoutRefusalOf,
  planAccountantCheckout,
  type AccountantCatalog,
  type AccountantPersonBilling,
  currentSubscription,
  EVERY_COUNTRY,
  isReturnPath,
  planCheckout,
  type BillingCountries,
  type AppliedOffer,
  type BillingInterval,
  type Catalog,
  type CheckoutRefusal,
  type PersonBilling,
  addressRefusalOf,
  ISRAEL_VAT,
  israelVatPercent,
  soloTrialOpen,
  type PlanCatalogs,
} from '../billing/checkout.js';
import type { BillingProvider } from '../billing/provider.js';
import { planChangeView } from '../billing/plan-change.js';
import { PILOT_PRICES, PILOT_PRICES_EXPECTED, pilotOf, pilotPlansOf } from '../billing/pilot.js';
import { giftAvailable, giftCovers, giftUntil, NO_GIFT } from '../usage/gift.js';
import { stripeProvider } from '../billing/stripe/provider.js';
import { firstYearOf, OFFERS, offerEligible, offerView, type Offer, type OfferEntry } from '../billing/offer.js';
import { offerOrNothing } from '../billing/offer-read.js';
import { comebackRefusalOf, comebackSubscriptionRefusalOf, type ComebackOffer } from '../billing/comeback.js';
import { comebackFactsOf, comebackOfferOrNothing } from '../billing/comeback-read.js';
import { entitlementsWithFactsFor } from '../billing/coverage.js';
import { businessCapView as viewOf } from '../billing/business-cap.js';
import { profilePlanSubscriptions, trialTimelineOf } from '../billing/entitlement.js';
import { currentPlanOf, PLAN_LIMITS, PLAN_NAMES, type PlanName } from '../billing/plans.js';
import { accountantPlanSubscriptions, resolveAccountantPlan } from '../billing/accountant-plan.js';
import { catalogOf, catalogOrNothing, NO_CATALOG, yearlySwitchLine } from '../billing/yearly-switch-line.js';
import type { PlanGateway } from '../billing/stripe/plan-gateway.js';
import { CATALOG_TTL_MS, type CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import { StripeGatewayError } from '../billing/stripe/gateway.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { ownedProfilesOf, profileTypeOf } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import type { BillingSubscriptionRecord, JsonObject, LedgerStore, Organization, UserRecord } from '../repositories/ports.js';
import { ActivationCheckoutRequestSchema, BillingOverviewSchema, BillingRedirectSchema, CardRetryResponseSchema, CheckoutSessionRequestSchema, ErrorEnvelopeSchema, PilotWelcomeSeenSchema, PortalSessionRequestSchema, ProvisionCustomerParamSchema } from '../schemas.js';

/**
 * MUT-362 (plan §2.4, ADR-170): Settings › Billing. Signed in only, outside PORTAL_ROUTES (the signed-out portal has
 * no billing), and person-level: the person pays, so none of these names a profile. Never billing-gated: a lapsed or
 * locked person must still be able to subscribe (spike §4.3).
 *
 *   GET  /v1/billing                   the drawer's one read: subscription, trial, prices, country rules
 *   POST /v1/billing/checkout-session  a Stripe Checkout URL (eng review D3: the person's own customer, found or made)
 *   POST /v1/billing/portal-session    a Stripe Customer Portal URL for the linked customer
 *   POST /v1/billing/card-retry        MUT-533 (D5): back from the card form, pay the past-due invoice on the new card
 *   POST /v1/billing/pilot-welcome     MUT-752 (ADR-296): the pilot Welcome was closed (once per person)
 */
export const BILLING_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/billing',
  'POST /v1/billing/checkout-session',
  'POST /v1/billing/portal-session',
  'POST /v1/billing/card-retry',
  'POST /v1/billing/pilot-welcome',
]);

/** Each session press can cost Stripe calls; ten a minute is far above any person's need. */
export const BILLING_SESSION_POLICY = { perMinute: 10 } as const;

export interface BillingRouteOptions {
  /** Null: Stripe isn't configured; GET says so, the two POSTs answer 503 BILLING_NOT_CONFIGURED. */
  checkout: CheckoutGateway | null;
  countries: BillingCountries;
  limiter: RateLimiter;
  /** Where Stripe sends the person back (the setup-link rule: PORTAL_ORIGIN, else the request's own origin). */
  portalOrigin?: string | undefined;
  logger: Pick<Logger, 'warn' | 'error'>;
  /** MUT-525 (D12): the campaigns whose Stripe coupons may make an offer. Defaults to offers.json. */
  offers?: readonly OfferEntry[];
  /** MUT-531: the plan door, for the paid-invoice count behind `yearlySwitch`. Null: no switch line. */
  plan?: PlanGateway | null;
  /** MUT-565 (ACCOUNTANT_ACCESS): GET /v1/billing reports `accountantPlan`. Absent = off. */
  accountantAccess?: boolean;
  /** MUT-565 (ACCOUNTANT_PLAN): Checkout sells the plan only while the cap is on too. Absent = off. */
  accountantPlanOn?: boolean;
  /** MUT-702 Part B (PLAN_CHECKOUT): Solo, Business and Firm are on sale. Absent = off (only the legacy Freelancer Checkout). */
  planSales?: boolean;
}

export const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const MINUTE_MS = 60 * 1000;
/** Refusals Stripe will repeat however often it's asked: the operator's to fix, so never "try again". */
const PERMANENT_STRIPE_ERRORS: ReadonlySet<string> = new Set(['StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError', 'StripeIdempotencyError']);
const NO_ACCOUNTANT_CATALOG: AccountantCatalog = { ILS: null, USD: null };
/** MUT-535: moved to billing/yearly-switch-line.ts; re-exported for billing-plan.ts. */
export { catalogOf };
export const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
export const refusedResponses = {
  401: errorResponse('No valid session'),
  403: errorResponse('PRINCIPAL_NOT_ACCEPTED, or CROSS_SITE_REQUEST'),
  409: errorResponse(
    'CONFLICT; `details.reason` is ALREADY_SUBSCRIBED, RESUME_IN_PORTAL, CONTACT_US, NOTHING_TO_COVER, COVERED_BY_MALAFAT, COVERED_BY_GRANT, ' +
      'NO_BILLING_ACCOUNT, BILLING_ACCOUNT_NEEDS_HELP (a Stripe customer gone, or a refusal Stripe will repeat: the operator fixes it), ' +
      'OFFER_ENDED (`expectedOffer` no longer applies; no Checkout was made), MUT-702 Part B: TRIAL_NOT_OFFERED (the Solo trial isn’t ' +
      'offered to this account) or PLAN_CHECKOUT_OFF (Solo, Business and Firm aren’t on sale on this server)',
  ),
  422: errorResponse('VALIDATION_FAILED: a malformed body, a return path outside the portal, or `details.reason` COUNTRY_NEEDS_BUSINESS or ADDRESS_INVALID (MUT-702 Part B)'),
  429: errorResponse(`RATE_LIMITED: more than ${BILLING_SESSION_POLICY.perMinute} billing sessions a minute; \`Retry-After\` says when`),
  502: errorResponse('STRIPE_UNAVAILABLE: Stripe did not answer in time (a timeout, a rate limit, its own error); a retry may work'),
  503: errorResponse('BILLING_NOT_CONFIGURED: no Stripe on this server, or `details.reason` PRICES_NOT_SET'),
} as const;

export function billingRoutes(store: LedgerStore, options: BillingRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  const offers = options.offers ?? OFFERS;
  // MUT-702 Part B (ADR-288): the plans on sale go through the provider port; its one adapter is Stripe.
  const provider = options.planSales && options.checkout ? stripeProvider(options.checkout) : null;

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/billing',
      tags: ['Billing'],
      summary: "The signed-in person's subscription, trial, prices and country rules",
      description:
        'One read for Settings › Billing. `catalog` holds the GA list prices from Stripe (lookup keys `freelancer_list_{monthly|yearly}_{ils|usd}`), ' +
        `cached for ${CATALOG_TTL_MS / MINUTE_MS} minutes; a currency without both sellable prices is null, and a Stripe failure here makes both null rather than failing the read. ` +
        '`coveredProfileIds`: the profiles a payment would cover (the ones the person created). Person-level: no X-Mutaba3a-Profile. ' +
        '`offer` (MUT-525): the launch offer while its Stripe coupon runs, with the first year per currency and whether this person gets it ' +
        '(never had a subscription); null when there is none or Stripe could not be asked. Its `endsAt` is an hour before the coupon’s own end. ' +
        '`comeback` (MUT-534): once the come-back mail has offered it and the person still may have it, what the first month and first year back ' +
        'cost per currency (the list prices less the come-back coupon), and the list prices after them; null otherwise. ' +
        '`currentPlan` (MUT-702): solo, business, firm or the legacy freelancer, the best plan covering any profile the person created (an operator grant, ' +
        'a subscription, or the running trial, which is business); null when nothing covers them. ' +
        '`pilot` (MUT-752): the free pilot (an operator grant with a cohort) while it runs and the person doesn’t pay: its end, whether the Welcome was closed, ' +
        'and the plans with their Expected prices and limits; null otherwise.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'Billing', content: { 'application/json': { schema: BillingOverviewSchema } } }, 401: refusedResponses[401], 403: refusedResponses[403] },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      const [summary, catalog, owned] = await Promise.all([
        store.billing.summaryOf(user.id),
        options.checkout ? catalogOrNothing(options.checkout, options.logger, c.get('requestId')) : NO_CATALOG,
        ownedWithEntitlements(store, user.id, now),
      ]);
      // MUT-565 (ADR-251): everything below is the profile plan's; the Accountant plan has its own field.
      const subscriptions = profilePlanSubscriptions(summary.subscriptions);
      const shown = currentSubscription(subscriptions, now);
      const offer = options.checkout ? await offerOrNothing(options.checkout, offers, catalog, now, false, options.logger, c.get('requestId')) : null;
      const comeback = options.checkout ? await comebackFor(store, user.id, subscriptions, now, offers, options.checkout, options.logger, false) : null;
      const accountantPlan = options.accountantAccess ? await accountantPlanView(store, user.id, summary, now, options.checkout, options.logger, c.get('requestId')) : null;
      const yearlySwitch = shown && options.plan ? await yearlySwitchLine(store, user.id, options.plan, shown, catalog, now, options.logger, c.get('requestId')) : null;
      const [plans, billingAddress] = provider
        ? await Promise.all([plansView(provider, options.logger, c.get('requestId')), summary.account ? addressOrNothing(provider, summary.account.stripeCustomerId, options.logger, c.get('requestId')) : null])
        : [[], null];
      return c.json(
        {
          configured: options.checkout !== null,
          subscription: shown && summary.account ? subscriptionView(shown, summary.account.currency) : null,
          canManage: summary.account !== null,
          trial: summary.trialStartedAt ? trialView(summary.trialStartedAt) : null,
          catalog: { ILS: amountsOf(catalog.ILS), USD: amountsOf(catalog.USD) },
          countries: countriesView(options.countries),
          coveredProfileIds: owned.profiles.map((p) => p.id),
          offer: offer ? offerView(offer, offerEligible(offer, subscriptions, offer.interval), catalog) : null,
          yearlySwitch,
          comeback: comeback ? { id: comeback.id, firstMonth: comeback.firstMonth, listMonth: comeback.listMonth, firstYear: comeback.firstYear, listYear: comeback.listYear } : null,
          accountantPlan,
          // MUT-702 (ADR-275): provider-neutral, from the same entitlements the gate reads.
          currentPlan: currentPlanOf(owned.entitlements),
          // MUT-735 (ADR-281): one primary-key read of this month's counters.
          usage: await billingUsage(store, user.id, owned, now),
          // MUT-731 (ADR-284): Starter's choice and the pick-your-business state, from the same coverage read.
          ...starterView(store, user.id, owned),
          // MUT-702 Part B (ADR-288): the plans on sale and the saved billing address (prefill).
          plans,
          billingAddress,
          // MUT-750 (ADR-290): the rate the portal shows as the VAT line for an Israeli address.
          vatRate: vatRateView(options.countries),
          // MUT-752 (ADR-296): the free pilot, from the same facts and `now` as the entitlements.
          pilot: await pilotView(store, user.id, owned, now),
          // MUT-734 (ADR-291): the scheduled change and where the person may move (only while plans are on sale).
          ...(provider ? planChangeView(shown, await store.billing.planChangesOf(user.id)) : { scheduledChange: null, pendingChange: null, planChange: { canUpgradeTo: [], canDowngradeTo: [] } }),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/checkout-session',
      tags: ['Billing'],
      summary: 'Open Stripe Checkout for a plan',
      description:
        "Creates a subscription Checkout Session on the person's own Stripe customer (the linked one, else one found or made with their id in its " +
        'metadata) and returns its URL. ILS for Israel, USD elsewhere; a person (no tax ID) in any country open to consumers (every country while billing-countries.json says "*"); a business proves it is one. Stripe itself is ' +
        "asked for the customer's subscriptions first (ALREADY_SUBSCRIBED even before the webhook lands), and the customer's other open Checkouts " +
        'are expired. During the free trial the subscription starts with the rest of it. The subscription reaches the account through the Stripe ' +
        'webhook. Audited `billing.checkout_started` on each profile the person owns. MUT-525: a yearly Checkout by someone who never had a ' +
        'subscription (the mirror and Stripe agree) carries the launch coupon while it runs; a coupon that is gone or can’t be read means ' +
        'full price. `expectedOffer`, the offer the drawer showed: if it no longer applies, 409 OFFER_ENDED and no Checkout. ' +
        'MUT-702 Part B (ADR-288, PLAN_CHECKOUT): `plan` solo, business or firm sells that plan through the provider port (Stripe, sold by ' +
        'Barmajiyat). It needs `address`, whose country must be `country`: it is saved on the customer first, sets the currency and Stripe ' +
        'Tax computes the tax from it (18% VAT on top in Israel); Stripe’s page shows it and can’t change it. The person’s other open ' +
        'profile-plan Checkouts are expired. No offers apply until MUT-703. `trial: true` (Solo only) carries the one-time 14-day Solo ' +
        'trial with a card required, for an account web onboarding offered it to that never used it.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: CheckoutSessionRequestSchema } } } },
      responses: { 200: { description: 'The Checkout page', content: { 'application/json': { schema: BillingRedirectSchema } } }, ...refusedResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const checkout = requireCheckout(options.checkout);
      const returnUrl = returnUrlOf(c, body.returnPath, options.portalOrigin);
      // MUT-565 (ADR-251): the Accountant plan's Checkout is its own path; nothing below applies to it.
      if (body.plan === 'accountant') {
        // Review: no sale while the cap is off (nothing to pay for), whatever ACCOUNTANT_ACCESS says.
        if (!options.accountantAccess || !options.accountantPlanOn) throw new ApiError('NOT_FOUND', 'Not found');
        const url = await accountantCheckout(c, store, checkout, user, body, returnUrl, now, options);
        return c.json({ url }, 200);
      }
      if (body.plan === 'solo' || body.plan === 'business' || body.plan === 'firm') {
        const url = await planSale(c, store, checkout, user, { ...body, plan: body.plan }, returnUrl, now, options, provider);
        return c.json({ url }, 200);
      }
      // MUT-731: the Solo trial is bought only with `plan: solo`.
      if (body.trial) throw refusalError('TRIAL_NOT_OFFERED');
      const legacy = { interval: body.interval, country: body.country, buyer: body.buyer };
      const [summary, owned] = await Promise.all([store.billing.summaryOf(user.id), ownedWithEntitlements(store, user.id, now)]);
      // MUT-565: only the profile plan's subscriptions; an Accountant plan never makes this one ALREADY_SUBSCRIBED.
      const profileSubscriptions = profilePlanSubscriptions(summary.subscriptions);
      const person: PersonBilling = { subscriptions: profileSubscriptions, owned: owned.entitlements };
      const refusal = checkoutRefusalOf({ ...body, now }, person, options.countries);
      if (refusal) throw refusalError(refusal);

      const trialEndsAt = summary.trialStartedAt ? trialTimelineOf(summary.trialStartedAt).endsAt : null;
      const catalog = await viaStripe(() => catalogOf(checkout), user, null, options.logger);
      const plan = planCheckout({ userId: user.id, ...legacy, returnUrl, now, trialEndsAt }, person, options.countries, catalog);
      if (!plan.ok) throw refusalError(plan.code);
      const linked = summary.account?.stripeCustomerId ?? null;
      const { url, applied } = await viaStripe(
        async () => {
          const customer = linked ?? (await checkout.findOrCreateCustomer(personOf(user)));
          // Review: the mirror can be late (a slow webhook, a failed one), so Stripe's own word decides before money moves.
          const inStripe = profilePlanSubscriptions(await checkout.subscriptionsOf(customer));
          const everSubscribed = [...person.subscriptions, ...inStripe];
          const stillRefused = checkoutRefusalOf({ ...body, now }, { ...person, subscriptions: everSubscribed }, options.countries);
          if (stillRefused) throw refusalError(stillRefused);
          // MUT-525 (OV-4): the offer is decided only now, on the mirror and Stripe together (D2), from a fresh coupon read (D6).
          const offer = body.interval === 'year' ? await offerOrNothing(checkout, offers, catalog, now, true, options.logger, c.get('requestId')) : null;
          let applied = offerEligible(offer, everSubscribed, body.interval) ? appliedOffer(offer!, catalog, plan.currency, body.interval) : null;
          // MUT-534 (D13, D14): otherwise the come-back offer, on the mirror's facts and Stripe's own list (R7), from a fresh coupon.
          if (!applied) {
            const back = await comebackFor(store, user.id, profileSubscriptions, now, offers, checkout, options.logger, true);
            const usedInStripe = back !== null && inStripe.some((s) => s.offerId === back.id && !NEVER_PAID.has(s.status));
            if (back && !usedInStripe) applied = comebackApplied(back, plan.currency, body.interval);
          }
          // DD4: the drawer showed an offer that no longer applies: no silent full price, the person decides again.
          if (body.expectedOffer && applied?.id !== body.expectedOffer) {
            throw new ApiError('CONFLICT', CONFLICT_MESSAGES.OFFER_ENDED, { reason: 'OFFER_ENDED', offer: body.expectedOffer });
          }
          const final = applied ? planCheckout({ userId: user.id, ...legacy, returnUrl, now, trialEndsAt, offer: applied }, person, options.countries, catalog) : plan;
          if (!final.ok) throw refusalError(final.code);
          // Only the newest Checkout can be paid: another tab's, or an abandoned one, can't charge a second time.
          await checkout.expireOpenCheckouts(customer, 'freelancer');
          return { ...(await checkout.createCheckoutSession({ ...final.params, customer })), applied };
        },
        user,
        linked,
        options.logger,
      );
      const metadata = { plan: 'freelancer', interval: body.interval, currency: plan.currency, buyer: body.buyer, country: body.country, offer: applied?.id ?? null };
      await auditOn(store, owned.profiles, user, 'billing.checkout_started', metadata, c.get('requestId'), options.logger);
      return c.json({ url }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/accountant/customers/{userId}/checkout-session',
      tags: ['Accountants'],
      summary: 'Take the card of a customer you created, in Stripe’s page, before they claim the account (MUT-766)',
      description:
        'ADR-295. An approved accountant (ACCOUNTANT_PROVISIONING) opens Stripe Checkout for a paid plan (solo, business or firm) on behalf of a ' +
        'customer he created who has not set a password yet; the customer is the payer (their subscription, their profiles, their Stripe ' +
        'customer) and enters the card and the bank’s check on Stripe’s page. The same Checkout as the customer’s own (PLAN_CHECKOUT): the ' +
        'address is required and saved first, the customer’s other open Checkouts are expired. The Stripe customer carries no email until the ' +
        'customer claims the account (then the verified address). The rate limit counts against the accountant; audited `billing.checkout_started` ' +
        'with the accountant as actor and `payerUserId`. The subscription arrives by the webhook (the desk shows it as `paid`). 404 for another ' +
        'accountant’s customer, a claimed one, or with the feature off. Additive since 1.161.0-mut766.',
      security: SESSION_ONLY,
      request: { params: ProvisionCustomerParamSchema, body: { required: true, content: { 'application/json': { schema: ActivationCheckoutRequestSchema } } } },
      responses: { ...refusedResponses, 200: { description: 'The Checkout page', content: { 'application/json': { schema: BillingRedirectSchema } } }, 403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNTANT_NOT_APPROVED'), 404: errorResponse('No unclaimed customer of yours by this id, or the feature is off') },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const approval = await store.provision.approvalOf(user.id);
      if (!approval?.enabled) throw new ApiError('ACCOUNTANT_NOT_APPROVED', 'The operator has not approved you to create customers');
      const customer = await store.provision.unclaimedCustomerOf(user.id, c.req.valid('param').userId);
      if (!customer) throw new ApiError('NOT_FOUND', 'Customer not found');
      const body = c.req.valid('json');
      const now = c.get('now')();
      // The accountant's presses, not the customer's, are what is limited.
      await limit(c, options.limiter, user.id, now);
      const checkout = requireCheckout(options.checkout);
      const returnUrl = returnUrlOf(c, body.returnPath, options.portalOrigin);
      const url = await startPlanCheckout(c, store, checkout, { payer: customer, actor: user, unclaimed: true }, body, returnUrl, now, options, provider);
      return c.json({ url }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/portal-session',
      tags: ['Billing'],
      summary: 'Open the Stripe Customer Portal (card, invoices, cancel at period end)',
      description:
        "Needs a Stripe customer linked to the person (409 NO_BILLING_ACCOUNT otherwise). Audited `billing.portal_opened` on each profile the person owns. " +
        "MUT-533: `flow: card` opens Stripe's card form directly and comes back to the drawer once the card is saved.",
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: PortalSessionRequestSchema } } } },
      responses: { 200: { description: 'The Customer Portal', content: { 'application/json': { schema: BillingRedirectSchema } } }, ...refusedResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const { returnPath, flow } = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const checkout = requireCheckout(options.checkout);
      const returnUrl = returnUrlOf(c, returnPath, options.portalOrigin);
      const summary = await store.billing.summaryOf(user.id);
      if (!summary.account) throw refusalError('NO_BILLING_ACCOUNT');
      const customer = summary.account.stripeCustomerId;
      const { url } = await viaStripe(() => checkout.createPortalSession({ customer, returnUrl: `${returnUrl}?billing=true&portal=${flow === 'card' ? 'card' : 'returned'}`, ...(flow ? { flow } : {}) }), user, customer, options.logger);
      const profiles = await ownedProfilesOf(store, user.id);
      await auditOn(store, profiles, user, 'billing.portal_opened', {}, c.get('requestId'), options.logger);
      return c.json({ url }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/card-retry',
      tags: ['Billing'],
      summary: 'Pay the past-due invoice now, on the card just saved',
      description:
        "MUT-533 (D5): Stripe's card form makes the new card the customer's default but pays nothing until its next retry, so the drawer " +
        'calls this once on its way back (`?portal=card`). When the plan Billing shows is past_due with an open failed invoice, Stripe is asked ' +
        'to pay that invoice now, keyed on the invoice and its attempt count (a double press replays). `paid`, `declined` (the plan stays past ' +
        'due and Stripe keeps retrying), `needs-action` (Stripe’s invoice page, where the bank’s check happens) or `nothing-due` (nothing ' +
        'charged). Audited `billing.payment_retried` with the outcome. Additive since 1.98.0-mut533.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'What Stripe did', content: { 'application/json': { schema: CardRetryResponseSchema } } }, ...refusedResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const nothing = { outcome: 'nothing-due' as const, hostedInvoiceUrl: null };
      const plan = options.plan;
      if (!plan) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server');
      const summary = await store.billing.summaryOf(user.id);
      // MUT-565 review: the profile plan's past-due invoice first, else the Accountant plan's (one customer, one card).
      const pastDue = [profilePlanSubscriptions(summary.subscriptions), accountantPlanSubscriptions(summary.subscriptions)]
        .map((subs) => currentSubscription(subs, now))
        .find((s) => s?.status === 'past_due');
      const shown = pastDue;
      if (!summary.account || !shown) return c.json(nothing, 200);
      const customer = summary.account.stripeCustomerId;
      const result = await viaStripe(
        async () => {
          const facts = await plan.failedPaymentOf(shown.stripeSubscriptionId);
          if (!facts?.episode || facts.status !== 'past_due') return nothing;
          return plan.retryPayment(facts.episode.invoiceId, facts.episode.attemptCount);
        },
        user,
        customer,
        options.logger,
      );
      if (result.outcome !== 'nothing-due') {
        const profiles = await ownedProfilesOf(store, user.id);
        await auditOn(store, profiles, user, 'billing.payment_retried', { outcome: result.outcome }, c.get('requestId'), options.logger);
      }
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/pilot-welcome',
      tags: ['Billing'],
      summary: 'The pilot Welcome was closed',
      description:
        'MUT-752 (ADR-296, eng review D2): web or phone calls this when the pilot tester closes the Welcome (Later or its main action). From then ' +
        '`GET /v1/billing` `pilot.welcomeSeenAt` is set and the Welcome does not open again, on any device, also after the pilot is extended. ' +
        'Idempotent: the first instant is kept. Stored on the person, so it is accepted whether or not a pilot is running. Additive since 1.162.0-mut752.',
      security: SESSION_ONLY,
      responses: {
        200: { description: 'Recorded', content: { 'application/json': { schema: PilotWelcomeSeenSchema } } },
        401: refusedResponses[401],
        403: refusedResponses[403],
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const seen = await store.billing.markPilotWelcomeSeen(user.id, c.get('now')());
      if (!seen) throw new ApiError('UNAUTHENTICATED', 'No valid session');
      return c.json({ welcomeSeenAt: seen.toISOString() }, 200);
    },
  );

  return app;
}

type Refusal = CheckoutRefusal | 'NO_BILLING_ACCOUNT' | 'BILLING_ACCOUNT_NEEDS_HELP' | 'OFFER_ENDED';

/** The house rule (PATTERNS.md, MUT-120): an existing code with a `details.reason`, never a new code per refusal. */
function refusalError(reason: Refusal): ApiError {
  switch (reason) {
    case 'VALIDATION_FAILED':
      return new ApiError('VALIDATION_FAILED', 'The billing country must be an ISO 3166-1 alpha-2 code');
    case 'COUNTRY_NEEDS_BUSINESS':
      return new ApiError('VALIDATION_FAILED', 'Individuals in this country cannot subscribe yet; a business with a tax number can', { reason });
    case 'PRICES_NOT_SET':
      return new ApiError('BILLING_NOT_CONFIGURED', 'Subscriptions are not open yet: the prices are not set', { reason });
    case 'ADDRESS_INVALID':
      return new ApiError('VALIDATION_FAILED', 'The billing address needs a country, a street, a city and a postal code, and its country must be the one sent', { reason });
    default:
      return new ApiError('CONFLICT', CONFLICT_MESSAGES[reason], { reason });
  }
}

const CONFLICT_MESSAGES: Record<Exclude<Refusal, 'VALIDATION_FAILED' | 'COUNTRY_NEEDS_BUSINESS' | 'PRICES_NOT_SET' | 'ADDRESS_INVALID'>, string> = {
  TRIAL_NOT_OFFERED: 'The Solo trial is not offered to this account',
  PLAN_CHECKOUT_OFF: 'These plans are not on sale yet',
  ALREADY_SUBSCRIBED: 'You already have a subscription; change it from Manage billing',
  RESUME_IN_PORTAL: 'Your last payment did not go through; pay the open invoice from Manage billing',
  CONTACT_US: 'This subscription needs a hand from us; please contact us',
  NOTHING_TO_COVER: 'You do not own a profile a subscription would cover',
  COVERED_BY_MALAFAT: 'Your profiles are covered by your firm’s Malafat plan',
  COVERED_BY_GRANT: 'Your account is covered by MTB3A; there is nothing to pay',
  NO_BILLING_ACCOUNT: 'There is no billing account to manage yet',
  BILLING_ACCOUNT_NEEDS_HELP: 'We could not open billing for your account; please contact us',
  OFFER_ENDED: 'The offer you saw no longer applies; nothing was charged',
};

export function requireCheckout(checkout: CheckoutGateway | null): CheckoutGateway {
  if (!checkout) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server');
  return checkout;
}

export async function limit(c: Context<AppEnv>, limiter: RateLimiter, userId: string, now: Date): Promise<void> {
  const decision = await limiter.check(`billing-session:${userId}`, now);
  if (decision.allowed) return;
  c.header('Retry-After', String(decision.retryAfterSeconds));
  throw new ApiError('RATE_LIMITED', 'Too many billing requests; try again shortly', { retryAfterSeconds: decision.retryAfterSeconds });
}

/** The portal origin plus a path that can't leave it (plan §2.3: never an absolute URL, so never an open redirect). */
function returnUrlOf(c: Context<AppEnv>, returnPath: string, portalOrigin: string | undefined): string {
  if (!isReturnPath(returnPath)) throw new ApiError('VALIDATION_FAILED', 'returnPath must be / or a portal profile path', { field: 'returnPath' });
  return `${setupLinkOrigin(portalOrigin, c.req.url)}${returnPath === '/' ? '' : returnPath}`;
}

/** The person's owned profiles and each one's entitlement: one billing read (coverage.ts), at most six profiles (MUT-182). */
/** MUT-735 (ADR-281): the person's usage this month against their plan's limits (the payer's plan, as the meters read it). */
async function billingUsage(store: LedgerStore, userId: string, owned: Awaited<ReturnType<typeof ownedWithEntitlements>>, now: Date): Promise<UsageView & { gift?: { available: boolean } }> {
  const month = usageMonthOf(now);
  const counters = await store.usage.countersFor(userSubjectKey(userId), [month]);
  const count = (meter: 'DOCUMENTS' | 'SCANS') => counters.find((c) => c.meter === meter)?.count ?? 0;
  const plan = currentPlanOf(owned.entitlements) ?? (owned.entitlements.some((e) => e.source === 'MALAFAT') ? 'malafat' : 'none');
  const view = usageView({
    month,
    resetsOn: resetsOn(month),
    plan,
    counts: { DOCUMENTS: count('DOCUMENTS'), SCANS: count('SCANS') },
    businessesOwned: owned.profiles.filter((p) => profileTypeOf(p) === 'BUSINESS').length,
  });
  // MUT-733 (ADR-293): the gifted meter's `graceUntil`, and whether the gift can still be taken (PAID_HARD_CAPS only).
  if (!store.billing.paidHardCaps) return view;
  const gift = (await store.billing.overCapGiftOf(userId)) ?? NO_GIFT;
  const until = giftUntil(month).toISOString();
  return {
    ...view,
    meters: view.meters.map((m) => (giftCovers(gift, m.meter.toUpperCase() as 'DOCUMENTS' | 'SCANS', month) ? { ...m, graceUntil: until } : m)),
    gift: { available: giftAvailable(gift, plan, true) },
  };
}

async function ownedWithEntitlements(store: LedgerStore, userId: string, now: Date) {
  const profiles = await ownedProfilesOf(store, userId);
  const withMalafat = await Promise.all(
    profiles.map(async (organization) => ({ organization, malafatConnected: (await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT'))?.status === 'CONNECTED' })),
  );
  const { entitlements, facts, businessCaps } = await entitlementsWithFactsFor(store, withMalafat, now, userId);
  return { profiles, entitlements: profiles.map((p) => entitlements.get(p.id)!), facts, businessCaps };
}

/**
 * MUT-752 (ADR-296, eng review D1): GET /v1/billing's `pilot`: the person's live pilot grant, while an operator grant
 * covers their profiles and they don't pay. The Welcome flag is read only for a pilot (one primary-key read).
 */
async function pilotView(store: LedgerStore, userId: string, owned: Awaited<ReturnType<typeof ownedWithEntitlements>>, now: Date) {
  const pilot = pilotOf(
    { userId, grants: owned.facts.grants, subscriptions: owned.facts.subscriptions.filter((s) => s.userId === userId), sources: owned.entitlements.map((e) => e.source) },
    now,
  );
  if (!pilot) return null;
  const welcomeSeenAt = await store.billing.pilotWelcomeSeenOf(userId);
  return { cohort: pilot.cohort, endsAt: pilot.endsAt.toISOString(), welcomeSeenAt: welcomeSeenAt?.toISOString() ?? null, pricesExpected: PILOT_PRICES_EXPECTED, plans: pilotPlansOf(PILOT_PRICES) };
}

/**
 * MUT-731 (ADR-284): GET /v1/billing's `starter` and `activeBusinesses`. `canContinueFree`: a profile the person
 * created is read-only from a lapsed paid plan (the cancel row), so "Continue free on Starter" would open it.
 */
function starterView(store: LedgerStore, userId: string, owned: Awaited<ReturnType<typeof ownedWithEntitlements>>) {
  if (!store.billing.starterPlan) return { starter: null, activeBusinesses: null };
  const canContinueFree = owned.entitlements.some((e) => e.state === 'READ_ONLY' && e.source === 'STRIPE' && !e.paused && !e.planLimit);
  const caps = owned.businessCaps.get(userId);
  return {
    starter: { chosenAt: owned.facts.starterChosen?.get(userId)?.toISOString() ?? null, canContinueFree },
    activeBusinesses: caps && caps.businesses.length > caps.cap ? viewOf(caps) : null,
  };
}


/** MUT-534: the come-back offer's ids, as a subscription's `offerId` names them. */
const COMEBACK_IDS: ReadonlySet<string> = new Set(OFFERS.filter((e) => e.kind === 'comeback').map((e) => e.id));

/** MUT-534: a Checkout that never took money doesn't use the come-back offer up (R7). */
const NEVER_PAID: ReadonlySet<string> = new Set(['incomplete', 'incomplete_expired']);

/**
 * MUT-534 (D12, D13): the come-back offer this person may have now, or null. Nothing to read for someone who never had a
 * plan end (GET /v1/billing is polled); otherwise their facts, the rule (the job's record opens it) and the coupon.
 */
async function comebackFor(store: LedgerStore, userId: string, subscriptions: readonly BillingSubscriptionRecord[], now: Date, offers: readonly OfferEntry[], checkout: CheckoutGateway, logger: Pick<Logger, 'warn'>, fresh: boolean): Promise<ComebackOffer | null> {
  // Review: the subscriptions in hand settle most refusals; only someone they let through costs the other reads.
  if (comebackSubscriptionRefusalOf(subscriptions, COMEBACK_IDS, now)) return null;
  if (comebackRefusalOf(await comebackFactsOf(store, userId, now, offers, { subscriptions }), now, { requireOffered: true })) return null;
  return comebackOfferOrNothing(checkout, offers, logger, { fresh });
}

/** MUT-534 (D8): the come-back amounts for this Checkout's currency and interval; null where it has none. */
function comebackApplied(offer: ComebackOffer, currency: 'ILS' | 'USD', interval: BillingInterval): AppliedOffer | null {
  const first = interval === 'year' ? offer.firstYear[currency] : offer.firstMonth[currency];
  const list = interval === 'year' ? offer.listYear[currency] : offer.listMonth[currency];
  const couponId = offer.couponIds[currency];
  return first === null || list === null || couponId === null ? null : { id: offer.id, couponId, firstAmount: first, listAmount: list, kind: 'comeback', interval };
}

/** D4: what the offer adds to this Checkout, in the price's own currency. */
function appliedOffer(offer: Offer, catalog: Catalog, currency: 'ILS' | 'USD', interval: BillingInterval): AppliedOffer | null {
  const price = catalog[currency]?.[interval];
  if (!price) return null;
  return { id: offer.id, couponId: offer.couponId, firstAmount: firstYearOf(price.unitAmount, offer.percentOff), listAmount: price.unitAmount };
}

/**
 * Stripe failures, reduced to what the person can act on (eng review D7, MUT-362 review): a linked customer Stripe no
 * longer has is the operator's to fix (`billing link`), named in a warn line by ids only; a refusal Stripe will repeat
 * (a key without D2's scopes, a bad price or parameter) is the operator's too, logged as an error so it is seen; only
 * the rest (a timeout, a rate limit, Stripe's own error) may pass if retried.
 */
export async function viaStripe<T>(call: () => Promise<T>, user: UserRecord, linkedCustomer: string | null, logger: Pick<Logger, 'warn' | 'error'>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    const ids = { code: err.code, type: err.type, param: err.param, stripeRequestId: err.requestId, userId: user.id };
    if (err.code === 'resource_missing' && err.param === 'customer' && linkedCustomer) {
      logger.warn({ ...ids, stripeCustomerId: linkedCustomer }, 'linked Stripe customer is gone; relink it with billing:link');
      throw refusalError('BILLING_ACCOUNT_NEEDS_HELP');
    }
    if (PERMANENT_STRIPE_ERRORS.has(err.type)) {
      logger.error(ids, 'Stripe refused a billing call it will keep refusing; check the key, prices and Customer Portal settings');
      throw refusalError('BILLING_ACCOUNT_NEEDS_HELP');
    }
    logger.warn(ids, 'Stripe billing call failed');
    throw new ApiError('STRIPE_UNAVAILABLE', 'The payment provider did not answer; try again shortly');
  }
}

function personOf(user: UserRecord) {
  return { userId: user.id, email: user.email, name: user.displayName };
}

/**
 * After Stripe made the session, so best effort (review): a failed audit must not answer 500 while a payable Checkout
 * exists, or the person's retry opens a second. Logged as an error instead.
 */
export async function auditOn(
  store: LedgerStore,
  profiles: readonly Organization[],
  user: UserRecord,
  action: string,
  metadata: JsonObject,
  requestId: string,
  logger: Pick<Logger, 'error'>,
): Promise<void> {
  try {
    for (const profile of profiles) {
      await store.audit.append({ organizationId: profile.id, actorType: 'USER', actorId: user.id, action, entityType: 'user', entityId: user.id, metadata, requestId });
    }
  } catch (err) {
    logger.error({ err, action, userId: user.id, requestId }, 'billing audit not written');
  }
}


function subscriptionView(sub: BillingSubscriptionRecord & { tier: Exclude<BillingSubscriptionRecord['tier'], 'ACCOUNTANT'> }, currency: string) {
  const interval = sub.priceLookupKey?.includes('_yearly_') ? 'year' : sub.priceLookupKey?.includes('_monthly_') ? 'month' : null;
  return {
    tier: sub.tier,
    status: sub.status,
    interval,
    currency,
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    // MUT-525 DD3: a list price renews at the catalog's amount, which the drawer names; a founder price never shows one.
    renewsAtListPrice: sub.priceLookupKey !== null && ALL_GA_LOOKUP_KEYS.includes(sub.priceLookupKey),
    // MUT-534 (review): which offer it carried, so the drawer never calls a come-back subscription a launch offer.
    offer: sub.offerId ? { id: sub.offerId, kind: COMEBACK_IDS.has(sub.offerId) ? ('comeback' as const) : ('launch' as const) } : null,
    pause: sub.pausedFrom ? { from: sub.pausedFrom.toISOString(), until: sub.pauseResumesAt?.toISOString() ?? null } : null,
  } as const;
}

/** MUT-418 (D11): `"*"` is sent as `consumerEverywhere`, so `consumer` stays a plain list for every client. */
/** MUT-750 (ADR-290): the configured Israeli VAT, or null with none (Israel is then not sold). */
function vatRateView(countries: BillingCountries): { country: 'IL'; percent: number } | null {
  const percent = israelVatPercent(countries);
  return percent === null ? null : { country: 'IL', percent };
}

function countriesView(countries: BillingCountries) {
  const everywhere = countries.consumer === EVERY_COUNTRY;
  return { consumer: everywhere ? [] : [...countries.consumer], consumerEverywhere: everywhere, customTaxId: [...countries.customTaxId] };
}

function trialView(startedAt: Date) {
  const { endsAt, lockAt } = trialTimelineOf(startedAt);
  return { startedAt: startedAt.toISOString(), endsAt: endsAt.toISOString(), lockAt: lockAt.toISOString() };
}

function amountsOf(pair: Catalog['ILS']) {
  return pair ? { month: pair.month.unitAmount, year: pair.year.unitAmount } : null;
}

/**
 * MUT-565 (ADR-251): GET /v1/billing `accountantPlan`: the plan (one more billing read, for the person's grants), its
 * subscription's interval and the account's currency, and the monthly price per currency (cached like the catalog;
 * a Stripe failure hides the prices, never the read).
 */
async function accountantPlanView(
  store: LedgerStore,
  userId: string,
  summary: { account: { currency: string } | null; subscriptions: readonly BillingSubscriptionRecord[] },
  now: Date,
  checkout: CheckoutGateway | null,
  logger: Pick<Logger, 'warn' | 'error'>,
  requestId: string,
) {
  const [facts, catalog] = await Promise.all([
    store.billing.factsFor({ ownerUserIds: [userId], organizationIds: [] }),
    checkout ? accountantCatalogOrNothing(checkout, logger, requestId) : NO_ACCOUNTANT_CATALOG,
  ]);
  const plan = resolveAccountantPlan(userId, facts, now);
  const sub = currentSubscription(accountantPlanSubscriptions(summary.subscriptions), now);
  return {
    state: plan.state,
    source: plan.source,
    until: plan.until?.toISOString() ?? null,
    cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
    interval: sub ? intervalOf(sub.priceLookupKey) : null,
    currency: summary.account?.currency ?? null,
    catalog: { ILS: catalog.ILS ? { month: catalog.ILS.month.unitAmount } : null, USD: catalog.USD ? { month: catalog.USD.month.unitAmount } : null },
  };
}

async function accountantCatalogOf(checkout: CheckoutGateway): Promise<AccountantCatalog> {
  return accountantCatalogFrom(await checkout.pricesByLookupKey(ALL_ACCOUNTANT_LOOKUP_KEYS));
}

async function accountantCatalogOrNothing(checkout: CheckoutGateway, logger: Pick<Logger, 'warn'>, requestId: string): Promise<AccountantCatalog> {
  try {
    return await accountantCatalogOf(checkout);
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'accountant plan catalog unavailable; prices hidden');
    return NO_ACCOUNTANT_CATALOG;
  }
}

function intervalOf(lookupKey: string | null): 'month' | 'year' | null {
  return lookupKey?.includes('_yearly_') ? 'year' : lookupKey?.includes('_monthly_') ? 'month' : null;
}

/**
 * MUT-565 (ADR-251, P7): a Checkout for the Accountant plan. The same customer as the Freelancer plan (one per person,
 * two subscriptions), the same "ask Stripe first" re-check (filtered to this plan) and the same expiry of open
 * Checkouts; monthly only, no trial carried over, no offers. Audited `billing.checkout_started` with `plan: accountant`.
 */
async function accountantCheckout(
  c: Context<AppEnv>,
  store: LedgerStore,
  checkout: CheckoutGateway,
  user: UserRecord,
  body: { interval: BillingInterval; country: string; buyer: 'person' | 'business' },
  returnUrl: string,
  now: Date,
  options: BillingRouteOptions,
): Promise<string> {
  const [summary, facts] = await Promise.all([store.billing.summaryOf(user.id), store.billing.factsFor({ ownerUserIds: [user.id], organizationIds: [] })]);
  const person: AccountantPersonBilling = { subscriptions: accountantPlanSubscriptions(summary.subscriptions), grants: facts.grants.filter((g) => g.userId === user.id) };
  const refusal = accountantCheckoutRefusalOf({ ...body, now }, person, options.countries);
  if (refusal === 'VALIDATION_FAILED' && body.interval !== 'month') throw new ApiError('VALIDATION_FAILED', 'The Accountant plan is monthly', { field: 'interval' });
  if (refusal) throw refusalError(refusal);
  const catalog = await viaStripe(() => accountantCatalogOf(checkout), user, null, options.logger);
  const input = { userId: user.id, ...body, returnUrl, now, trialEndsAt: null };
  const plan = planAccountantCheckout(input, person, options.countries, catalog);
  if (!plan.ok) throw refusalError(plan.code);
  const linked = summary.account?.stripeCustomerId ?? null;
  const { url } = await viaStripe(
    async () => {
      const customer = linked ?? (await checkout.findOrCreateCustomer(personOf(user)));
      const inStripe = accountantPlanSubscriptions(await checkout.subscriptionsOf(customer));
      const stillRefused = accountantCheckoutRefusalOf({ ...body, now }, { ...person, subscriptions: [...person.subscriptions, ...inStripe] }, options.countries);
      if (stillRefused) throw refusalError(stillRefused);
      // Review: only this plan's open Checkouts; a Freelancer one in another tab stays payable.
      await checkout.expireOpenCheckouts(customer, 'accountant');
      return checkout.createCheckoutSession({ ...plan.params, customer });
    },
    user,
    linked,
    options.logger,
  );
  const profiles = await ownedProfilesOf(store, user.id);
  await auditOn(store, profiles, user, 'billing.checkout_started', { plan: 'accountant', interval: body.interval, currency: plan.currency, buyer: body.buyer, country: body.country, offer: null }, c.get('requestId'), options.logger);
  return url;
}

/**
 * MUT-702 Part B (ADR-288): a Checkout for Solo, Business or Firm through the provider port. The billing address comes
 * with the request (asked only here, never at sign-up): its country sets the currency and Stripe Tax computes the tax
 * from it (18% VAT on top in Israel). The Freelancer rules apply (ALREADY_SUBSCRIBED across every profile plan: moving
 * between plans is MUT-734), with Stripe asked first. No launch or come-back offer until MUT-703 makes them per plan.
 * `trial: true` carries the one-time Solo trial (14 days, card up front) where `soloTrialOpen` allows it.
 */
async function planSale(
  c: Context<AppEnv>,
  store: LedgerStore,
  checkout: CheckoutGateway,
  user: UserRecord,
  body: PlanSaleBody,
  returnUrl: string,
  now: Date,
  options: BillingRouteOptions,
  provider: BillingProvider | null,
): Promise<string> {
  return startPlanCheckout(c, store, checkout, { payer: user, actor: user, unclaimed: false }, body, returnUrl, now, options, provider);
}

export type PlanSaleBody = { interval: BillingInterval; country: string; buyer: 'person' | 'business'; plan: PlanName; address?: { country: string; line1: string; city: string; postalCode: string } | undefined; trial?: boolean | undefined };

/**
 * MUT-766 (eng SC-1, R4): the one plan-Checkout core. `payer` is whose subscription it is (their mirror, their
 * profiles, their Stripe customer, `client_reference_id`); `actor` is who asked (the audit row's actor). The signed-in
 * person's own Checkout passes themselves as both; an accountant activating an unclaimed customer passes the customer
 * as payer and himself as actor, with `unclaimed` so the customer is made with no email (R5). Everything else, the
 * Stripe parameters and the expiry of open Checkouts included, is the same code (the golden test pins it).
 */
export async function startPlanCheckout(
  c: Context<AppEnv>,
  store: LedgerStore,
  checkout: CheckoutGateway,
  who: { payer: UserRecord; actor: UserRecord; unclaimed: boolean },
  body: PlanSaleBody,
  returnUrl: string,
  now: Date,
  options: BillingRouteOptions,
  provider: BillingProvider | null,
): Promise<string> {
  const { payer, actor } = who;
  if (!provider) throw refusalError('PLAN_CHECKOUT_OFF');
  const address = body.address ?? null;
  if (!address || address.country !== body.country || addressRefusalOf(address)) throw refusalError('ADDRESS_INVALID');
  const [summary, owned] = await Promise.all([store.billing.summaryOf(payer.id), ownedWithEntitlements(store, payer.id, now)]);
  if (body.trial) {
    const trial = body.plan === 'solo' ? await store.billing.paidTrialOf(payer.id) : null;
    const open = soloTrialOpen({ since: c.get('soloTrialOfferSince'), starterPlan: store.billing.starterPlan, currentPlan: currentPlanOf(owned.entitlements), createdAt: payer.createdAt, trial });
    if (!open) throw refusalError('TRIAL_NOT_OFFERED');
  }
  const profileSubscriptions = profilePlanSubscriptions(summary.subscriptions);
  const person: PersonBilling = { subscriptions: profileSubscriptions, owned: owned.entitlements };
  const refusal = checkoutRefusalOf({ ...body, now }, person, options.countries);
  if (refusal) throw refusalError(refusal);
  const vat = body.country === ISRAEL_VAT.country ? israelVatPercent(options.countries) : null;
  const [catalogs, israelVatRateId] = await viaStripe(() => Promise.all([provider.catalogs(), vat === null ? null : provider.israelVatRate(vat)]), payer, null, options.logger);
  const trialEndsAt = summary.trialStartedAt ? trialTimelineOf(summary.trialStartedAt).endsAt : null;
  const input = { userId: payer.id, ...body, address, soloTrial: body.trial === true, israelVatRateId, returnUrl, now, trialEndsAt };
  const plan = planCheckout(input, person, options.countries, catalogs[body.plan]);
  if (!plan.ok) throw refusalError(plan.code);
  const linked = summary.account?.stripeCustomerId ?? null;
  const { url } = await viaStripe(
    async () => {
      // R5: an unclaimed account's customer carries no email until the claim sets the verified one.
      const customer = linked ?? (await checkout.findOrCreateCustomer(who.unclaimed ? { ...personOf(payer), email: null } : personOf(payer)));
      // Review: the mirror can be late, so Stripe's own word decides before money moves.
      const inStripe = profilePlanSubscriptions(await checkout.subscriptionsOf(customer));
      const stillRefused = checkoutRefusalOf({ ...body, now }, { ...person, subscriptions: [...person.subscriptions, ...inStripe] }, options.countries);
      if (stillRefused) throw refusalError(stillRefused);
      return provider.startCheckout({ customer, address, params: plan.params });
    },
    payer,
    linked,
    options.logger,
  );
  const metadata = { plan: body.plan, interval: body.interval, currency: plan.currency, buyer: body.buyer, country: body.country, offer: null, trial: body.trial === true, seller: provider.seller, ...(actor.id !== payer.id ? { payerUserId: payer.id } : {}) };
  await auditOn(store, owned.profiles, actor, 'billing.checkout_started', metadata, c.get('requestId'), options.logger);
  return url;
}

/** MUT-702 Part B: GET /v1/billing `plans`. A provider failure hides them (empty) rather than failing the read. */
async function plansView(provider: BillingProvider, logger: Pick<Logger, 'warn'>, requestId: string) {
  let catalogs: PlanCatalogs;
  try {
    catalogs = await provider.catalogs();
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'plan catalogs unavailable; plans hidden');
    return [];
  }
  return PLAN_NAMES.map((plan) => ({ plan, catalog: { ILS: amountsOf(catalogs[plan].ILS), USD: amountsOf(catalogs[plan].USD) }, limits: { ...PLAN_LIMITS[plan] } }));
}

/** MUT-702 Part B: the saved billing address for the prefill; null when there is none or Stripe can't be asked. */
async function addressOrNothing(provider: BillingProvider, customer: string, logger: Pick<Logger, 'warn'>, requestId: string) {
  try {
    return await provider.billingAddress(customer);
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'billing address unavailable; form not prefilled');
    return null;
  }
}
