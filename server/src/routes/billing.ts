import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { setupLinkOrigin } from '../auth/account-setup.js';
import {
  ALL_GA_LOOKUP_KEYS,
  catalogFrom,
  checkoutRefusalOf,
  currentSubscription,
  EVERY_COUNTRY,
  isReturnPath,
  planCheckout,
  type BillingCountries,
  type Catalog,
  type CheckoutRefusal,
  type PersonBilling,
} from '../billing/checkout.js';
import { entitlementsFor } from '../billing/coverage.js';
import { trialTimelineOf } from '../billing/entitlement.js';
import { CATALOG_TTL_MS, type CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import { StripeGatewayError } from '../billing/stripe/gateway.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { ownedProfilesOf } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import type { BillingSubscriptionRecord, JsonObject, LedgerStore, Organization, UserRecord } from '../repositories/ports.js';
import { BillingOverviewSchema, BillingRedirectSchema, CheckoutSessionRequestSchema, ErrorEnvelopeSchema, PortalSessionRequestSchema } from '../schemas.js';

/**
 * MUT-362 (plan §2.4, ADR-170): Settings › Billing. Signed in only, outside PORTAL_ROUTES (the signed-out portal has
 * no billing), and person-level: the person pays, so none of these names a profile. Never billing-gated: a lapsed or
 * locked person must still be able to subscribe (spike §4.3).
 *
 *   GET  /v1/billing                   the drawer's one read: subscription, trial, prices, country rules
 *   POST /v1/billing/checkout-session  a Stripe Checkout URL (eng review D3: the person's own customer, found or made)
 *   POST /v1/billing/portal-session    a Stripe Customer Portal URL for the linked customer
 */
export const BILLING_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/billing',
  'POST /v1/billing/checkout-session',
  'POST /v1/billing/portal-session',
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
}

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const MINUTE_MS = 60 * 1000;
/** Refusals Stripe will repeat however often it's asked: the operator's to fix, so never "try again". */
const PERMANENT_STRIPE_ERRORS: ReadonlySet<string> = new Set(['StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError', 'StripeIdempotencyError']);
const NO_CATALOG: Catalog = { ILS: null, USD: null };
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const refusedResponses = {
  401: errorResponse('No valid session'),
  403: errorResponse('PRINCIPAL_NOT_ACCEPTED, or CROSS_SITE_REQUEST'),
  409: errorResponse(
    'CONFLICT; `details.reason` is ALREADY_SUBSCRIBED, RESUME_IN_PORTAL, CONTACT_US, NOTHING_TO_COVER, COVERED_BY_MALAFAT, COVERED_BY_GRANT, ' +
      'NO_BILLING_ACCOUNT, or BILLING_ACCOUNT_NEEDS_HELP (a Stripe customer gone, or a refusal Stripe will repeat: the operator fixes it)',
  ),
  422: errorResponse('VALIDATION_FAILED: a malformed body, a return path outside the portal, or `details.reason` COUNTRY_NEEDS_BUSINESS'),
  429: errorResponse(`RATE_LIMITED: more than ${BILLING_SESSION_POLICY.perMinute} billing sessions a minute; \`Retry-After\` says when`),
  502: errorResponse('STRIPE_UNAVAILABLE: Stripe did not answer in time (a timeout, a rate limit, its own error); a retry may work'),
  503: errorResponse('BILLING_NOT_CONFIGURED: no Stripe on this server, or `details.reason` PRICES_NOT_SET'),
} as const;

export function billingRoutes(store: LedgerStore, options: BillingRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/billing',
      tags: ['Billing'],
      summary: "The signed-in person's subscription, trial, prices and country rules",
      description:
        'One read for Settings › Billing. `catalog` holds the GA list prices from Stripe (lookup keys `freelancer_list_{monthly|yearly}_{ils|usd}`), ' +
        `cached for ${CATALOG_TTL_MS / MINUTE_MS} minutes; a currency without both sellable prices is null, and a Stripe failure here makes both null rather than failing the read. ` +
        '`coveredProfileIds`: the profiles a payment would cover (the ones the person created). Person-level: no X-Mutaba3a-Profile.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'Billing', content: { 'application/json': { schema: BillingOverviewSchema } } }, 401: refusedResponses[401], 403: refusedResponses[403] },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const [summary, catalog, covered] = await Promise.all([
        store.billing.summaryOf(user.id),
        options.checkout ? catalogOrNothing(options.checkout, options.logger, c.get('requestId')) : NO_CATALOG,
        ownedProfilesOf(store, user.id),
      ]);
      const shown = currentSubscription(summary.subscriptions, c.get('now')());
      return c.json(
        {
          configured: options.checkout !== null,
          subscription: shown && summary.account ? subscriptionView(shown, summary.account.currency) : null,
          canManage: summary.account !== null,
          trial: summary.trialStartedAt ? trialView(summary.trialStartedAt) : null,
          catalog: { ILS: amountsOf(catalog.ILS), USD: amountsOf(catalog.USD) },
          countries: countriesView(options.countries),
          coveredProfileIds: covered.map((p) => p.id),
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
      summary: 'Open Stripe Checkout for the Freelancer plan',
      description:
        "Creates a subscription Checkout Session on the person's own Stripe customer (the linked one, else one found or made with their id in its " +
        'metadata) and returns its URL. ILS for Israel, USD elsewhere; a person (no tax ID) in any country open to consumers (every country while billing-countries.json says "*"); a business proves it is one. Stripe itself is ' +
        "asked for the customer's subscriptions first (ALREADY_SUBSCRIBED even before the webhook lands), and the customer's other open Checkouts " +
        'are expired. During the free trial the subscription starts with the rest of it. The subscription reaches the account through the Stripe ' +
        'webhook. Audited `billing.checkout_started` on each profile the person owns.',
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
      const [summary, owned] = await Promise.all([store.billing.summaryOf(user.id), ownedWithEntitlements(store, user.id, now)]);
      const person: PersonBilling = { subscriptions: summary.subscriptions, owned: owned.entitlements };
      const refusal = checkoutRefusalOf({ ...body, now }, person, options.countries);
      if (refusal) throw refusalError(refusal);

      const trialEndsAt = summary.trialStartedAt ? trialTimelineOf(summary.trialStartedAt).endsAt : null;
      const catalog = await viaStripe(() => catalogOf(checkout), user, null, options.logger);
      const plan = planCheckout({ userId: user.id, ...body, returnUrl, now, trialEndsAt }, person, options.countries, catalog);
      if (!plan.ok) throw refusalError(plan.code);
      const linked = summary.account?.stripeCustomerId ?? null;
      const { url } = await viaStripe(
        async () => {
          const customer = linked ?? (await checkout.findOrCreateCustomer(personOf(user)));
          // Review: the mirror can be late (a slow webhook, a failed one), so Stripe's own word decides before money moves.
          const inStripe = await checkout.subscriptionsOf(customer);
          const stillRefused = checkoutRefusalOf({ ...body, now }, { ...person, subscriptions: [...summary.subscriptions, ...inStripe] }, options.countries);
          if (stillRefused) throw refusalError(stillRefused);
          // Only the newest Checkout can be paid: another tab's, or an abandoned one, can't charge a second time.
          await checkout.expireOpenCheckouts(customer);
          return checkout.createCheckoutSession({ ...plan.params, customer });
        },
        user,
        linked,
        options.logger,
      );
      const metadata = { interval: body.interval, currency: plan.currency, buyer: body.buyer, country: body.country };
      await auditOn(store, owned.profiles, user, 'billing.checkout_started', metadata, c.get('requestId'), options.logger);
      return c.json({ url }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/portal-session',
      tags: ['Billing'],
      summary: 'Open the Stripe Customer Portal (card, invoices, cancel at period end)',
      description: "Needs a Stripe customer linked to the person (409 NO_BILLING_ACCOUNT otherwise). Audited `billing.portal_opened` on each profile the person owns.",
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: PortalSessionRequestSchema } } } },
      responses: { 200: { description: 'The Customer Portal', content: { 'application/json': { schema: BillingRedirectSchema } } }, ...refusedResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const { returnPath } = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const checkout = requireCheckout(options.checkout);
      const returnUrl = returnUrlOf(c, returnPath, options.portalOrigin);
      const summary = await store.billing.summaryOf(user.id);
      if (!summary.account) throw refusalError('NO_BILLING_ACCOUNT');
      const customer = summary.account.stripeCustomerId;
      const { url } = await viaStripe(() => checkout.createPortalSession({ customer, returnUrl: `${returnUrl}?billing=true&portal=returned` }), user, customer, options.logger);
      const profiles = await ownedProfilesOf(store, user.id);
      await auditOn(store, profiles, user, 'billing.portal_opened', {}, c.get('requestId'), options.logger);
      return c.json({ url }, 200);
    },
  );

  return app;
}

type Refusal = CheckoutRefusal | 'NO_BILLING_ACCOUNT' | 'BILLING_ACCOUNT_NEEDS_HELP';

/** The house rule (PATTERNS.md, MUT-120): an existing code with a `details.reason`, never a new code per refusal. */
function refusalError(reason: Refusal): ApiError {
  switch (reason) {
    case 'VALIDATION_FAILED':
      return new ApiError('VALIDATION_FAILED', 'The billing country must be an ISO 3166-1 alpha-2 code');
    case 'COUNTRY_NEEDS_BUSINESS':
      return new ApiError('VALIDATION_FAILED', 'Individuals in this country cannot subscribe yet; a business with a tax number can', { reason });
    case 'PRICES_NOT_SET':
      return new ApiError('BILLING_NOT_CONFIGURED', 'Subscriptions are not open yet: the prices are not set', { reason });
    default:
      return new ApiError('CONFLICT', CONFLICT_MESSAGES[reason], { reason });
  }
}

const CONFLICT_MESSAGES: Record<Exclude<Refusal, 'VALIDATION_FAILED' | 'COUNTRY_NEEDS_BUSINESS' | 'PRICES_NOT_SET'>, string> = {
  ALREADY_SUBSCRIBED: 'You already have a subscription; change it from Manage billing',
  RESUME_IN_PORTAL: 'Your last payment did not go through; pay the open invoice from Manage billing',
  CONTACT_US: 'This subscription needs a hand from us; please contact us',
  NOTHING_TO_COVER: 'You do not own a profile a subscription would cover',
  COVERED_BY_MALAFAT: 'Your profiles are covered by your firm’s Malafat plan',
  COVERED_BY_GRANT: 'Your account is covered by MTB3A; there is nothing to pay',
  NO_BILLING_ACCOUNT: 'There is no billing account to manage yet',
  BILLING_ACCOUNT_NEEDS_HELP: 'We could not open billing for your account; please contact us',
};

function requireCheckout(checkout: CheckoutGateway | null): CheckoutGateway {
  if (!checkout) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server');
  return checkout;
}

async function limit(c: Context<AppEnv>, limiter: RateLimiter, userId: string, now: Date): Promise<void> {
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
async function ownedWithEntitlements(store: LedgerStore, userId: string, now: Date) {
  const profiles = await ownedProfilesOf(store, userId);
  const withMalafat = await Promise.all(
    profiles.map(async (organization) => ({ organization, malafatConnected: (await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT'))?.status === 'CONNECTED' })),
  );
  const entitlements = await entitlementsFor(store, withMalafat, now);
  return { profiles, entitlements: profiles.map((p) => entitlements.get(p.id)!) };
}

async function catalogOf(checkout: CheckoutGateway): Promise<Catalog> {
  return catalogFrom(await checkout.pricesByLookupKey(ALL_GA_LOOKUP_KEYS));
}

/** GET must open for a person who only wants Manage billing, so a failed price lookup is logged and shown as no prices. */
async function catalogOrNothing(checkout: CheckoutGateway, logger: Pick<Logger, 'warn' | 'error'>, requestId: string): Promise<Catalog> {
  try {
    return await catalogOf(checkout);
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'billing catalog unavailable; prices hidden');
    return NO_CATALOG;
  }
}

/**
 * Stripe failures, reduced to what the person can act on (eng review D7, MUT-362 review): a linked customer Stripe no
 * longer has is the operator's to fix (`billing link`), named in a warn line by ids only; a refusal Stripe will repeat
 * (a key without D2's scopes, a bad price or parameter) is the operator's too, logged as an error so it is seen; only
 * the rest (a timeout, a rate limit, Stripe's own error) may pass if retried.
 */
async function viaStripe<T>(call: () => Promise<T>, user: UserRecord, linkedCustomer: string | null, logger: Pick<Logger, 'warn' | 'error'>): Promise<T> {
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
async function auditOn(
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

function subscriptionView(sub: BillingSubscriptionRecord, currency: string) {
  const interval = sub.priceLookupKey?.includes('_yearly_') ? 'year' : sub.priceLookupKey?.includes('_monthly_') ? 'month' : null;
  return {
    tier: sub.tier,
    status: sub.status,
    interval,
    currency,
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  } as const;
}

/** MUT-418 (D11): `"*"` is sent as `consumerEverywhere`, so `consumer` stays a plain list for every client. */
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
