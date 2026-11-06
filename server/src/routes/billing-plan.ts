import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { currentSubscription, type Catalog } from '../billing/checkout.js';
import { profilePlanSubscriptions } from '../billing/entitlement.js';
import { OFFERS, stayEntryOf, type OfferEntry } from '../billing/offer.js';
import {
  cycleBoundaryAfter,
  pauseCountsSince,
  pauseOptionsOf,
  stayOfferOf,
  yearlySwitchOf,
  type PauseRefusal,
  type RetentionEventFact,
  type RetentionSubject,
  type StayRefusal,
  type SwitchRefusal,
} from '../billing/retention.js';
import type { CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import { StripeGatewayError } from '../billing/stripe/gateway.js';
import type { LivePlan, PlanGateway } from '../billing/stripe/plan-gateway.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { ownedProfilesOf } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import { StateConflict } from '../repositories/memory.js';
import type { BillingRetentionEventRecord, BillingRetentionKindRecord, LedgerStore, UserRecord } from '../repositories/ports.js';
import {
  BillingRetentionSchema,
  CancellationRequestSchema,
  CancellationResultSchema,
  PauseEndResultSchema,
  PauseRequestSchema,
  PauseResultSchema,
  StayOfferRequestSchema,
  StayOfferResultSchema,
  YearlySwitchPreviewSchema,
  YearlySwitchRequestSchema,
  YearlySwitchResultSchema,
} from '../schemas.js';
import { auditOn, catalogOf, limit, refusedResponses, requireCheckout, SESSION_ONLY, viaStripe } from './billing.js';

/**
 * MUT-531 (plan §2.5, D1–D4, R2, ADR-238): changing one's own plan from Billing. Person-level and signed in only, like
 * the rest of Billing, and never billing-gated (gate.ts: 'open'). Stripe's live state decides, never the mirror alone.
 *
 *   GET  /v1/billing/yearly-switch   what the switch to yearly charges today (Stripe's proration preview)
 *   POST /v1/billing/yearly-switch   the switch, at the previewed proration date, or nothing at all
 *
 * MUT-532 (plan §2.5, D6–D12, R3, R6, ADR-240): MTB3A's own cancel flow, Why? → Pause → Stay → Cancel at period end.
 *
 *   GET    /v1/billing/retention     what the flow may offer instead of cancelling (pause options, the stay offer)
 *   POST   /v1/billing/pause         pause 1–3 months from the paid period's end
 *   DELETE /v1/billing/pause         undo a pause still to come, or Resume now (a month charged today)
 *   POST   /v1/billing/cancellation  cancel at the period end, with Stripe's reason
 *   DELETE /v1/billing/cancellation  Keep my plan
 *   POST   /v1/billing/stay-offer    the stay coupon on the plan, once per person ever
 */
export const BILLING_PLAN_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/billing/yearly-switch',
  'POST /v1/billing/yearly-switch',
  'GET /v1/billing/retention',
  'POST /v1/billing/pause',
  'DELETE /v1/billing/pause',
  'POST /v1/billing/cancellation',
  'DELETE /v1/billing/cancellation',
  'POST /v1/billing/stay-offer',
]);

export interface BillingPlanRouteOptions {
  checkout: CheckoutGateway | null;
  /** Null: Stripe isn't configured; every route answers 503 BILLING_NOT_CONFIGURED. */
  plan: PlanGateway | null;
  limiter: RateLimiter;
  logger: Pick<Logger, 'warn' | 'error'>;
  /** MUT-532 (D11): where the stay offer's coupon is named. Defaults to offers.json. */
  offers?: readonly OfferEntry[];
}

/** A preview is good for half an hour; an older one (a tab left open) is previewed again rather than trusted. */
export const PRORATION_DATE_MAX_AGE_MS = 30 * 60 * 1000;
/** A browser clock a little ahead of ours is fine; a proration date in the future is not. */
const CLOCK_SKEW_MS = 60 * 1000;

type PlanRefusal = 'AMOUNT_CHANGED' | 'PAYMENT_FAILED' | 'NOT_PAUSED' | 'NOT_CANCELLING';

const PLAN_CONFLICTS = {
  SWITCH_NOT_AVAILABLE: 'This plan can’t switch to yearly right now',
  AMOUNT_CHANGED: 'The amount changed since the preview; nothing was charged. Preview it again',
  PAYMENT_FAILED: 'The payment didn’t go through, so the plan stays monthly',
  PAYMENT_NEEDS_ACTION: 'Your bank needs you to approve this payment on Stripe’s page; until then the plan stays monthly',
  PAUSE_NOT_AVAILABLE: 'This plan can’t pause right now',
  NOT_PAUSED: 'This plan has no pause to end',
  NOTHING_TO_CANCEL: 'There is no plan here to cancel',
  NOT_CANCELLING: 'This plan isn’t cancelling',
  STAY_OFFER_NOT_AVAILABLE: 'The stay offer isn’t open to this plan',
} as const;

const conflictResponses = {
  ...refusedResponses,
  409: {
    ...refusedResponses[409],
    description:
      'CONFLICT; `details.reason` is SWITCH_NOT_AVAILABLE (`details.why`: NO_SUBSCRIPTION, NOT_MONTHLY_LIST, NOT_ACTIVE, CANCELLING, PAUSED, DISCOUNTED, ' +
      'TOO_EARLY, NO_PRICE), AMOUNT_CHANGED (a fresh preview differs, or the proration date is stale; nothing was charged), PAYMENT_FAILED ' +
      '(the plan stays monthly), or PAYMENT_NEEDS_ACTION (`details.hostedInvoiceUrl`: Stripe’s page to approve it)',
  },
} as const;

const retentionResponses = {
  ...refusedResponses,
  409: {
    ...refusedResponses[409],
    description:
      'CONFLICT; `details.reason` is PAUSE_NOT_AVAILABLE (`details.why`: NO_SUBSCRIPTION, NOT_MONTHLY_LIST, NOT_ACTIVE, CANCELLING, PAUSED, TOO_EARLY, ONCE_A_YEAR, NO_PERIOD), ' +
      'NOT_PAUSED, NOTHING_TO_CANCEL (`details.why`: NO_SUBSCRIPTION, NOT_ACTIVE, CANCELLING, MANAGED_BY_SCHEDULE), NOT_CANCELLING, or STAY_OFFER_NOT_AVAILABLE ' +
      '(`details.why`: NO_SUBSCRIPTION, NOT_MONTHLY_LIST, NOT_ACTIVE, CANCELLING, PAUSED, DISCOUNTED, ALREADY_HAD, NO_COUPON, NO_PRICE)',
  },
} as const;

/** Stripe statuses a plan can be cancelled from: still billing, or retrying a card. */
const CANCELLABLE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due']);

export function billingPlanRoutes(store: LedgerStore, options: BillingPlanRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  /** The shown subscription as Stripe holds it now, and whether it may switch (D2, D4, D13). */
  async function switchOf(user: UserRecord, now: Date) {
    const checkout = requireCheckout(options.checkout);
    const plan = requirePlan(options.plan);
    const summary = await store.billing.summaryOf(user.id);
    const shown = summary.account ? currentSubscription(profilePlanSubscriptions(summary.subscriptions), now) : undefined;
    if (!shown || !summary.account) throw notAvailable('NO_SUBSCRIPTION');
    const customer = summary.account.stripeCustomerId;
    const { live, paidInvoices, catalog } = await viaStripe(
      async () => {
        const live = await plan.planOf(shown.stripeSubscriptionId);
        return { live, paidInvoices: await plan.paidInvoiceCount(live.id, { fresh: true }), catalog: await catalogOf(checkout) };
      },
      user,
      customer,
      options.logger,
    );
    const decision = yearlySwitchOf({ status: live.status, priceLookupKey: live.lookupKey, cancelAtPeriodEnd: live.cancelAtPeriodEnd }, { paidInvoices, discounted: live.discounted, paused: live.paused }, catalog);
    if (!decision.ok) throw notAvailable(decision.refusal);
    return { plan, live, decision };
  }

  async function preview(user: UserRecord, plan: PlanGateway, live: LivePlan, yearlyPriceId: string, prorationDate: Date) {
    return viaStripe(() => plan.previewYearlySwitch({ subscriptionId: live.id, customer: live.customer, itemId: live.itemId, yearlyPriceId, prorationDate }), user, live.customer, options.logger);
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/billing/yearly-switch',
      tags: ['Billing'],
      summary: 'Preview the switch from monthly to yearly',
      description:
        'Stripe’s own proration preview: the yearly list price to the next anniversary of the person’s billing day (Stripe keeps the day), less the unused part of this month, tax included where it applies; `renewsOn` is Stripe’s. Open from the 2nd paid ' +
        'invoice on a monthly list price that is active, not cancelling, paused or discounted (founder prices never switch). No discount is ever applied.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'The preview', content: { 'application/json': { schema: YearlySwitchPreviewSchema } } }, ...conflictResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const { plan, live, decision } = await switchOf(user, now);
      const prorationDate = new Date(Math.floor(subscriptionNow(live, now).getTime() / 1000) * 1000);
      const { amountDue, currency, renewsOn } = await preview(user, plan, live, decision.yearly.id, prorationDate);
      if (currency !== decision.currency || !renewsOn) throw notAvailable('NO_PRICE');
      return c.json({ amountDue, currency: decision.currency, yearlyAmount: decision.yearly.unitAmount, renewsOn: renewsOn.toISOString(), prorationDate: prorationDate.toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/yearly-switch',
      tags: ['Billing'],
      summary: 'Switch from monthly to yearly',
      description:
        'Moves the subscription to the yearly list price at the preview’s `prorationDate` (at most 30 minutes old), charging the prorated invoice at once. ' +
        'Stripe previews again first: an amount other than `expectedAmountDue` charges nothing (AMOUNT_CHANGED). A payment that doesn’t go through ' +
        'leaves the plan monthly. Audited `billing.yearly_switched` on each profile the person owns.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: YearlySwitchRequestSchema } } } },
      responses: { 200: { description: 'Switched', content: { 'application/json': { schema: YearlySwitchResultSchema } } }, ...conflictResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const prorationDate = new Date(body.prorationDate);
      const { plan, live, decision } = await switchOf(user, now);
      const age = subscriptionNow(live, now).getTime() - prorationDate.getTime();
      if (age > PRORATION_DATE_MAX_AGE_MS || age < -CLOCK_SKEW_MS) throw planConflict('AMOUNT_CHANGED');
      const again = await preview(user, plan, live, decision.yearly.id, prorationDate);
      if (again.amountDue !== body.expectedAmountDue || again.currency !== decision.currency) throw planConflict('AMOUNT_CHANGED');
      const result = await viaStripe(
        () => plan.switchToYearly({ subscriptionId: live.id, customer: live.customer, itemId: live.itemId, yearlyPriceId: decision.yearly.id, prorationDate }),
        user,
        live.customer,
        options.logger,
      );
      if (result.outcome === 'payment-failed') throw planConflict('PAYMENT_FAILED');
      if (result.outcome === 'payment-needs-action') {
        throw new ApiError('CONFLICT', PLAN_CONFLICTS.PAYMENT_NEEDS_ACTION, { reason: 'PAYMENT_NEEDS_ACTION', hostedInvoiceUrl: result.hostedInvoiceUrl });
      }
      const profiles = await ownedProfilesOf(store, user.id);
      await auditOn(store, profiles, user, 'billing.yearly_switched', { currency: decision.currency, amountDue: again.amountDue }, c.get('requestId'), options.logger);
      // MUT-532 (§2.4): the switch's history beside the pause, the offer and the cancel. Best effort, after the money moved.
      await recordEvent(user, live.id, 'YEARLY_SWITCH', { at: subscriptionNow(live, now) });
      return c.json({ renewsOn: result.currentPeriodEnd?.toISOString() ?? null, yearlyAmount: decision.yearly.unitAmount, currency: decision.currency }, 200);
    },
  );

  // ---- MUT-532: the cancel flow -------------------------------------------------------------------------------

  const offers = options.offers ?? OFFERS;

  /** The subscription Billing shows, as Stripe holds it now; `refuse` names what to answer when there is none. */
  async function shownPlan(user: UserRecord, now: Date, refuse: () => ApiError) {
    const plan = requirePlan(options.plan);
    const summary = await store.billing.summaryOf(user.id);
    const shown = summary.account ? currentSubscription(profilePlanSubscriptions(summary.subscriptions), now) : undefined;
    if (!shown || !summary.account) throw refuse();
    const customer = summary.account.stripeCustomerId;
    const live = await viaStripe(() => plan.planOf(shown.stripeSubscriptionId), user, customer, options.logger);
    return { plan, live, customer };
  }

  /** The once-rules read every kind; the stay offer's catalog and coupon only when a stay step could show. */
  async function retentionOf(user: UserRecord, plan: PlanGateway, live: LivePlan, customer: string, now: Date, requestId: string) {
    const at = subscriptionNow(live, now);
    const subject = subjectOf(live);
    const [events, paidInvoices] = await Promise.all([
      store.billing.retentionEventsOf(user.id),
      viaStripe(() => plan.paidInvoiceCount(live.id), user, customer, options.logger),
    ]);
    const pause = pauseOptionsOf(subject, paidInvoices, events, at);
    const stay = await stayOf(subject, events, false, requestId);
    return { pause, stay };
  }

  /** D11, ADR-237 D5: a coupon or catalog Stripe can't give us means no stay step, never a blocked cancel. */
  async function stayOf(subject: RetentionSubject, events: readonly RetentionEventFact[], fresh: boolean, requestId: string) {
    const entry = stayEntryOf(offers);
    const checkout = options.checkout;
    if (!entry || !checkout) return stayOfferOf(subject, events, null, NO_CATALOG);
    try {
      const [catalog, coupon] = await Promise.all([catalogOf(checkout), checkout.couponById(entry.couponId, { fresh })]);
      const decision = stayOfferOf(subject, events, coupon, catalog);
      if (!decision.ok && decision.refusal === 'NO_COUPON') options.logger.warn({ couponId: entry.couponId, requestId }, 'stay offer coupon missing or not stay-shaped; no stay step');
      return decision;
    } catch (err) {
      if (!(err instanceof StripeGatewayError)) throw err;
      options.logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'stay offer unavailable; no stay step');
      return stayOfferOf(subject, events, null, NO_CATALOG);
    }
  }

  /** Best effort, like the audit: the event is history, and Stripe already did what it records. */
  async function recordEvent(user: UserRecord, subscriptionId: string, kind: BillingRetentionKindRecord, fields: Partial<Pick<BillingRetentionEventRecord, 'reason' | 'months' | 'startsAt' | 'endsAt'>> & { at: Date }) {
    try {
      await store.billing.claimRetentionEvent({ userId: user.id, stripeSubscriptionId: subscriptionId, kind, reason: fields.reason ?? null, months: fields.months ?? null, startsAt: fields.startsAt ?? null, endsAt: fields.endsAt ?? null, at: fields.at });
    } catch (err) {
      options.logger.error({ err, kind, userId: user.id }, 'billing retention event not written');
    }
  }

  /** D7, D8: the newest event of a kind that hasn't ended early, so undoing it marks that one. */
  async function endLatest(user: UserRecord, kind: BillingRetentionKindRecord, at: Date) {
    const events = await store.billing.retentionEventsOf(user.id);
    const latest = events.filter((e) => e.kind === kind && e.endedEarlyAt === null).at(-1);
    if (latest) await store.billing.endRetentionEventEarly(latest.id, at);
  }

  /**
   * R3: a claim made before a Stripe write is released only when Stripe definitely didn't make it: it refused the call,
   * or a fresh read after a timeout shows nothing applied (true: it did apply, so the press succeeded). If even that read
   * fails the claim stays (logged), so a retry can never make the change twice; the operator's reconcile settles it.
   */
  async function settleClaim(claim: BillingRetentionEventRecord, err: unknown, plan: PlanGateway, applied: (live: LivePlan) => boolean): Promise<boolean> {
    const verdict = stripeVerdictOf(err);
    if (verdict === 'refused') {
      await store.billing.releaseRetentionEvent(claim.id);
      return false;
    }
    if (verdict === 'unknown') {
      try {
        if (applied(await plan.planOf(claim.stripeSubscriptionId))) return true;
        await store.billing.releaseRetentionEvent(claim.id);
        return false;
      } catch (reread) {
        options.logger.error({ err: reread, claimId: claim.id, kind: claim.kind, userId: claim.userId }, 'billing claim kept: Stripe could not be asked whether it applied');
      }
    }
    return false;
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/billing/retention',
      tags: ['Billing'],
      summary: 'What the cancel flow may offer instead of cancelling',
      description:
        'Read when the person presses Cancel plan. `pause`: 1–3 months from the paid period’s end, for an active monthly list plan with one paid invoice and no pause in the last 12 months. ' +
        '`stayOffer`: the stay coupon (offers.json `stay`), once per person ever, for an active monthly list plan with no discount; amounts per Stripe’s rounding. Either is null when it isn’t open.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'The flow’s offers', content: { 'application/json': { schema: BillingRetentionSchema } } }, ...retentionResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const { plan, live, customer } = await shownPlan(user, now, () => nothingToCancel('NO_SUBSCRIPTION'));
      const refusal = cancelRefusal(live);
      if (refusal) throw nothingToCancel(refusal);
      const { pause, stay } = await retentionOf(user, plan, live, customer, now, c.get('requestId'));
      return c.json(
        {
          endsOn: live.currentPeriodEnd?.toISOString() ?? null,
          pause: pause.ok ? { options: pause.options.map((o) => ({ months: o.months, from: o.from.toISOString(), until: o.until.toISOString() })) } : null,
          stayOffer: stay.ok ? { percentOff: stay.offer.percentOff, months: stay.offer.months, currency: stay.offer.currency, monthlyAmount: stay.offer.monthlyAmount, listAmount: stay.offer.listAmount } : null,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/pause',
      tags: ['Billing'],
      summary: 'Pause the plan for 1–3 months instead of cancelling',
      description:
        'From the paid period’s end Stripe voids each invoice (nothing is charged) and the person’s records are read-only, never locked; billing restarts on its own on `until`. ' +
        'Once in 12 months, monthly list plans only. Audited `billing.pause_scheduled` on each profile the person owns.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: PauseRequestSchema } } } },
      responses: { 200: { description: 'Booked', content: { 'application/json': { schema: PauseResultSchema } } }, ...retentionResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const { plan, live, customer } = await shownPlan(user, now, () => pauseNotAvailable('NO_SUBSCRIPTION'));
      const at = subscriptionNow(live, now);
      const paidInvoices = await viaStripe(() => plan.paidInvoiceCount(live.id, { fresh: true }), user, customer, options.logger);
      const decision = pauseOptionsOf(subjectOf(live), paidInvoices, await store.billing.retentionEventsOf(user.id), at);
      if (!decision.ok) throw pauseNotAvailable(decision.refusal);
      const option = decision.options.find((o) => o.months === body.months)!;
      let claim: BillingRetentionEventRecord;
      try {
        // R6: the once-a-year rule again, under a lock, before Stripe is asked.
        claim = await store.billing.claimRetentionEvent({
          userId: user.id,
          stripeSubscriptionId: live.id,
          kind: 'PAUSE',
          reason: body.reason,
          months: body.months,
          startsAt: option.from,
          endsAt: option.until,
          at,
          noPauseSince: pauseCountsSince(at),
        });
      } catch (err) {
        if (err instanceof StateConflict && err.reason === 'TAKEN') throw pauseNotAvailable('ONCE_A_YEAR');
        throw err;
      }
      try {
        await viaStripe(() => plan.schedulePause({ subscriptionId: live.id, from: option.from, resumesAt: option.resumesAt, months: body.months }), user, customer, options.logger);
      } catch (err) {
        if (!(await settleClaim(claim, err, plan, (fresh) => fresh.pause !== null))) throw err;
      }
      const profiles = await ownedProfilesOf(store, user.id);
      const window = { from: option.from.toISOString(), until: option.until.toISOString() };
      await auditOn(store, profiles, user, 'billing.pause_scheduled', { months: body.months, reason: body.reason, ...window }, c.get('requestId'), options.logger);
      return c.json(window, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/billing/pause',
      tags: ['Billing'],
      summary: 'Undo a pause still to come, or resume now',
      description:
        'Before the pause starts it is undone and charges nothing (it doesn’t use up the year’s pause). Once it runs, Resume now restarts the plan today: one full month is charged today ' +
        'and it renews monthly from today. A declined card leaves the plan past due while Stripe retries it. Audited `billing.pause_ended`.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'Ended', content: { 'application/json': { schema: PauseEndResultSchema } } }, ...retentionResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const { plan, live, customer } = await shownPlan(user, now, () => planConflict('NOT_PAUSED'));
      if (!live.pause) throw planConflict('NOT_PAUSED');
      const at = subscriptionNow(live, now);
      const started = live.pause.from === null || live.pause.from <= at;
      const result = await viaStripe(() => plan.endPause({ subscriptionId: live.id, mode: started ? 'now' : 'undo' }), user, customer, options.logger);
      await endLatest(user, 'PAUSE', at).catch((err: unknown) => options.logger.error({ err, userId: user.id }, 'billing pause event not ended'));
      const payment = PAYMENT_OF[result.outcome];
      const profiles = await ownedProfilesOf(store, user.id);
      await auditOn(store, profiles, user, 'billing.pause_ended', { resumed: started ? 'now' : 'cancelled', payment }, c.get('requestId'), options.logger);
      return c.json({ resumed: started ? ('now' as const) : ('cancelled' as const), payment, hostedInvoiceUrl: result.outcome === 'payment-needs-action' ? result.hostedInvoiceUrl : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/cancellation',
      tags: ['Billing'],
      summary: 'Cancel the plan at the end of the paid period',
      description:
        'The plan stays on until the period it was paid for ends; then the person’s records are read-only, never deleted. Stripe keeps the reason (`cancellation_details.feedback`) and the comment. ' +
        'A founder price runs on a subscription schedule, which Stripe won’t cancel this way (NOTHING_TO_CANCEL, MANAGED_BY_SCHEDULE). Audited `billing.cancel_scheduled`.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: CancellationRequestSchema } } } },
      responses: { 200: { description: 'Cancelling', content: { 'application/json': { schema: CancellationResultSchema } } }, ...retentionResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const { plan, live, customer } = await shownPlan(user, now, () => nothingToCancel('NO_SUBSCRIPTION'));
      const refusal = cancelRefusal(live);
      if (refusal) throw nothingToCancel(refusal);
      const comment = body.comment ? body.comment : null;
      const { endsOn } = await viaStripe(() => plan.cancelAtPeriodEnd({ subscriptionId: live.id, feedback: body.reason, comment }), user, customer, options.logger);
      await recordEvent(user, live.id, 'CANCEL', { reason: body.reason, endsAt: endsOn, at: subscriptionNow(live, now) });
      const profiles = await ownedProfilesOf(store, user.id);
      await auditOn(store, profiles, user, 'billing.cancel_scheduled', { reason: body.reason }, c.get('requestId'), options.logger);
      return c.json({ endsOn: endsOn?.toISOString() ?? null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/billing/cancellation',
      tags: ['Billing'],
      summary: 'Keep my plan: take a cancel back',
      description: 'Clears a cancel at the period end, MTB3A’s or the Customer Portal’s, so the plan renews as before. Audited `billing.cancel_undone`.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'Kept', content: { 'application/json': { schema: CancellationResultSchema } } }, ...retentionResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const { plan, live, customer } = await shownPlan(user, now, () => planConflict('NOT_CANCELLING'));
      if (!live.cancelAtPeriodEnd || !CANCELLABLE_STATUSES.has(live.status)) throw planConflict('NOT_CANCELLING');
      await viaStripe(() => plan.keepPlan(live.id), user, customer, options.logger);
      await endLatest(user, 'CANCEL', subscriptionNow(live, now)).catch((err: unknown) => options.logger.error({ err, userId: user.id }, 'billing cancel event not ended'));
      const profiles = await ownedProfilesOf(store, user.id);
      await auditOn(store, profiles, user, 'billing.cancel_undone', {}, c.get('requestId'), options.logger);
      return c.json({ endsOn: null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/stay-offer',
      tags: ['Billing'],
      summary: 'Take the stay offer instead of cancelling',
      description:
        'Puts the stay coupon on the plan: the next invoices are discounted for the coupon’s months, then the list price again. Once per person, ever; claimed before Stripe is asked, ' +
        'so a double press or a retry can’t give it twice. The plan stays on. Audited `billing.stay_offer_applied`.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: StayOfferRequestSchema } } } },
      responses: { 200: { description: 'Applied', content: { 'application/json': { schema: StayOfferResultSchema } } }, ...retentionResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const { plan, live, customer } = await shownPlan(user, now, () => stayNotAvailable('NO_SUBSCRIPTION'));
      const at = subscriptionNow(live, now);
      const decision = await stayOf(subjectOf(live), await store.billing.retentionEventsOf(user.id), true, c.get('requestId'));
      if (!decision.ok) throw stayNotAvailable(decision.refusal);
      const { offer } = decision;
      const endsAt = live.billingCycleAnchor && live.currentPeriodEnd ? cycleBoundaryAfter(live.billingCycleAnchor, live.currentPeriodEnd, offer.months) : null;
      let claim: BillingRetentionEventRecord;
      try {
        claim = await store.billing.claimRetentionEvent({ userId: user.id, stripeSubscriptionId: live.id, kind: 'STAY_OFFER', reason: body.reason, months: offer.months, startsAt: at, endsAt, at });
      } catch (err) {
        if (err instanceof StateConflict && err.reason === 'TAKEN') throw stayNotAvailable('ALREADY_HAD');
        throw err;
      }
      try {
        await viaStripe(() => plan.applyCoupon(live.id, offer.couponId), user, customer, options.logger);
      } catch (err) {
        if (!(await settleClaim(claim, err, plan, (fresh) => fresh.couponIds.includes(offer.couponId)))) throw err;
      }
      const profiles = await ownedProfilesOf(store, user.id);
      await auditOn(store, profiles, user, 'billing.stay_offer_applied', { couponId: offer.couponId, reason: body.reason }, c.get('requestId'), options.logger);
      return c.json({ percentOff: offer.percentOff, months: offer.months, currency: offer.currency, monthlyAmount: offer.monthlyAmount }, 200);
    },
  );

  return app;
}

const NO_CATALOG: Catalog = { ILS: null, USD: null };

/** D7: what DELETE /v1/billing/pause says of today's charge. */
const PAYMENT_OF = { undone: null, charged: 'charged', 'payment-failed': 'failed', 'payment-needs-action': 'needs-action' } as const;

/** What the once-rules and offers read of the live plan. */
function subjectOf(live: LivePlan): RetentionSubject {
  return {
    status: live.status,
    priceLookupKey: live.lookupKey,
    cancelAtPeriodEnd: live.cancelAtPeriodEnd,
    paused: live.pause !== null,
    discounted: live.discounted,
    currentPeriodEnd: live.currentPeriodEnd,
    billingCycleAnchor: live.billingCycleAnchor,
  };
}

/** D8: why the cancel flow can't run on this plan, if it can't. */
function cancelRefusal(live: LivePlan): 'NOT_ACTIVE' | 'CANCELLING' | 'MANAGED_BY_SCHEDULE' | null {
  if (!CANCELLABLE_STATUSES.has(live.status)) return 'NOT_ACTIVE';
  if (live.cancelAtPeriodEnd) return 'CANCELLING';
  // The probe: Stripe refuses cancel changes on a schedule's subscription (founder prices, MUT-530).
  if (live.managedBySchedule) return 'MANAGED_BY_SCHEDULE';
  return null;
}

/**
 * R3, after `viaStripe`: a refusal Stripe will repeat (BILLING_ACCOUNT_NEEDS_HELP) never applied anything; a timeout,
 * a rate limit or Stripe's own error (STRIPE_UNAVAILABLE) may have. Anything else isn't Stripe's answer: keep the claim.
 */
function stripeVerdictOf(err: unknown): 'refused' | 'unknown' | null {
  if (!(err instanceof ApiError)) return null;
  if (err.code === 'STRIPE_UNAVAILABLE') return 'unknown';
  return err.code === 'CONFLICT' && (err.details as { reason?: string } | undefined)?.reason === 'BILLING_ACCOUNT_NEEDS_HELP' ? 'refused' : null;
}

/** Stripe prorates on the subscription's own clock: a sandbox test clock's time in QA, the server's otherwise. */
function subscriptionNow(live: LivePlan, now: Date): Date {
  return live.clockNow ?? now;
}

function requirePlan(plan: PlanGateway | null): PlanGateway {
  if (!plan) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server');
  return plan;
}

function pauseNotAvailable(why: PauseRefusal | 'NO_SUBSCRIPTION'): ApiError {
  return new ApiError('CONFLICT', PLAN_CONFLICTS.PAUSE_NOT_AVAILABLE, { reason: 'PAUSE_NOT_AVAILABLE', why });
}

function stayNotAvailable(why: StayRefusal | 'NO_SUBSCRIPTION'): ApiError {
  return new ApiError('CONFLICT', PLAN_CONFLICTS.STAY_OFFER_NOT_AVAILABLE, { reason: 'STAY_OFFER_NOT_AVAILABLE', why });
}

function nothingToCancel(why: 'NO_SUBSCRIPTION' | 'NOT_ACTIVE' | 'CANCELLING' | 'MANAGED_BY_SCHEDULE'): ApiError {
  return new ApiError('CONFLICT', PLAN_CONFLICTS.NOTHING_TO_CANCEL, { reason: 'NOTHING_TO_CANCEL', why });
}

function notAvailable(why: SwitchRefusal | 'NO_SUBSCRIPTION'): ApiError {
  return new ApiError('CONFLICT', PLAN_CONFLICTS.SWITCH_NOT_AVAILABLE, { reason: 'SWITCH_NOT_AVAILABLE', why });
}

function planConflict(reason: PlanRefusal): ApiError {
  return new ApiError('CONFLICT', PLAN_CONFLICTS[reason], { reason });
}


