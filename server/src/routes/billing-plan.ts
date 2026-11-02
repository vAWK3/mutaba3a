import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { currentSubscription } from '../billing/checkout.js';
import { yearlySwitchOf, type SwitchRefusal } from '../billing/retention.js';
import type { CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import type { LivePlan, PlanGateway } from '../billing/stripe/plan-gateway.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { ownedProfilesOf } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore, UserRecord } from '../repositories/ports.js';
import { YearlySwitchPreviewSchema, YearlySwitchRequestSchema, YearlySwitchResultSchema } from '../schemas.js';
import { auditOn, catalogOf, limit, refusedResponses, requireCheckout, SESSION_ONLY, viaStripe } from './billing.js';

/**
 * MUT-531 (plan §2.5, D1–D4, R2, ADR-238): changing one's own plan from Billing. Person-level and signed in only, like
 * the rest of Billing, and never billing-gated (gate.ts: 'open'). Stripe's live state decides, never the mirror alone.
 *
 *   GET  /v1/billing/yearly-switch   what the switch to yearly charges today (Stripe's proration preview)
 *   POST /v1/billing/yearly-switch   the switch, at the previewed proration date, or nothing at all
 */
export const BILLING_PLAN_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/billing/yearly-switch', 'POST /v1/billing/yearly-switch']);

export interface BillingPlanRouteOptions {
  checkout: CheckoutGateway | null;
  /** Null: Stripe isn't configured; every route answers 503 BILLING_NOT_CONFIGURED. */
  plan: PlanGateway | null;
  limiter: RateLimiter;
  logger: Pick<Logger, 'warn' | 'error'>;
}

/** A preview is good for half an hour; an older one (a tab left open) is previewed again rather than trusted. */
export const PRORATION_DATE_MAX_AGE_MS = 30 * 60 * 1000;
/** A browser clock a little ahead of ours is fine; a proration date in the future is not. */
const CLOCK_SKEW_MS = 60 * 1000;

type PlanRefusal = 'AMOUNT_CHANGED' | 'PAYMENT_FAILED';

const PLAN_CONFLICTS = {
  SWITCH_NOT_AVAILABLE: 'This plan can’t switch to yearly right now',
  AMOUNT_CHANGED: 'The amount changed since the preview; nothing was charged. Preview it again',
  PAYMENT_FAILED: 'The payment didn’t go through, so the plan stays monthly',
  PAYMENT_NEEDS_ACTION: 'Your bank needs you to approve this payment on Stripe’s page; until then the plan stays monthly',
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

export function billingPlanRoutes(store: LedgerStore, options: BillingPlanRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  /** The shown subscription as Stripe holds it now, and whether it may switch (D2, D4, D13). */
  async function switchOf(user: UserRecord, now: Date) {
    const checkout = requireCheckout(options.checkout);
    const plan = requirePlan(options.plan);
    const summary = await store.billing.summaryOf(user.id);
    const shown = summary.account ? currentSubscription(summary.subscriptions, now) : undefined;
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
        'Stripe’s own proration preview: the yearly list price less the unused part of this month, tax included where it applies. Open from the 2nd paid ' +
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
      const { amountDue, currency } = await preview(user, plan, live, decision.yearly.id, prorationDate);
      if (currency !== decision.currency) throw notAvailable('NO_PRICE');
      return c.json({ amountDue, currency: decision.currency, yearlyAmount: decision.yearly.unitAmount, renewsOn: aYearAfter(prorationDate).toISOString(), prorationDate: prorationDate.toISOString() }, 200);
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
      return c.json({ renewsOn: result.currentPeriodEnd?.toISOString() ?? null, yearlyAmount: decision.yearly.unitAmount, currency: decision.currency }, 200);
    },
  );

  return app;
}

/** Stripe prorates on the subscription's own clock: a sandbox test clock's time in QA, the server's otherwise. */
function subscriptionNow(live: LivePlan, now: Date): Date {
  return live.clockNow ?? now;
}

function requirePlan(plan: PlanGateway | null): PlanGateway {
  if (!plan) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server');
  return plan;
}

function notAvailable(why: SwitchRefusal | 'NO_SUBSCRIPTION'): ApiError {
  return new ApiError('CONFLICT', PLAN_CONFLICTS.SWITCH_NOT_AVAILABLE, { reason: 'SWITCH_NOT_AVAILABLE', why });
}

function planConflict(reason: PlanRefusal): ApiError {
  return new ApiError('CONFLICT', PLAN_CONFLICTS[reason], { reason });
}

/** Stripe restarts the period on an interval change, so the year runs from the switch (UTC calendar). */
function aYearAfter(at: Date): Date {
  const next = new Date(at);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

