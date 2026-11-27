import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { currentSubscription, type Catalog, type PlanCatalogs } from '../billing/checkout.js';
import { profilePlanSubscriptions } from '../billing/entitlement.js';
import { changeView, planChangeOf, type PlanChangeCurrent, type PlanChangeDecision, type PlanChangeTarget } from '../billing/plan-change.js';
import { PLAN_LIMITS, planOfLookupKey, TIER_OF, type PlanName } from '../billing/plans.js';
import type { CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import type { LivePlan, PlanGateway } from '../billing/stripe/plan-gateway.js';
import { stripeProvider } from '../billing/stripe/provider.js';
import type { CalendarDay, Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { ownedProfilesOf } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import { StateConflict } from '../repositories/memory.js';
import type { BillingPlanChangeRecord, BillingSubscriptionRecord, LedgerStore, UserRecord } from '../repositories/ports.js';
import { ErrorEnvelopeSchema } from '../schemas.js';
import { limit, refusedResponses, requireCheckout, SESSION_ONLY, viaStripe } from './billing.js';

/**
 * MUT-734 (ADR-291): changing between Solo, Business and Firm, or down to Starter, from Billing. Person-level and
 * signed in only, never billing-gated (gate.ts 'open'); behind PLAN_CHECKOUT (the plans must be on sale). Stripe's
 * live subscription decides, never the mirror alone.
 *
 *   POST   /v1/billing/plan-change/preview   what a change does: charged now (up), or from the period end (down)
 *   POST   /v1/billing/plan-change           the change: up now at the previewed proration date, down scheduled
 *   DELETE /v1/billing/plan-change           undo a scheduled change before its day
 */
// The routes are listed in BILLING_PLAN_ORGANIZATION_INDEPENDENT_ROUTES (billing-plan.ts) and gate.ts ('open').

export interface BillingPlanChangeRouteOptions {
  checkout: CheckoutGateway | null;
  plan: PlanGateway | null;
  /** PLAN_CHECKOUT: off, every route answers 409 CONFLICT PLAN_CHECKOUT_OFF. */
  planSales: boolean;
  limiter: RateLimiter;
  logger: Pick<Logger, 'warn' | 'error' | 'info'>;
  mailer: Mailer;
  settings: Pick<SessionSettings, 'portalOrigin'>;
}

/** A preview is good for 15 minutes (plan §4 PREVIEW_EXPIRED); a browser clock a minute ahead is fine. */
export const PLAN_CHANGE_PREVIEW_MAX_AGE_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

const PlanChangeTargetSchema = z.enum(['solo', 'business', 'firm', 'starter']).openapi('PlanChangeTarget');
const LimitsSchema = z.object({ businesses: z.number().int(), partners: z.number().int(), documentsPerMonth: z.number().int(), scansPerMonth: z.number().int() });

const PreviewRequestSchema = z.object({ plan: PlanChangeTargetSchema }).openapi('PlanChangePreviewRequest');
const PreviewSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('upgrade'),
      plan: PlanChangeTargetSchema,
      /** Stripe's proration charged now, tax included, in the subscription's currency (minor units). */
      amountDue: z.number().int(),
      currency: z.string(),
      /** Echo it on the confirm so the amount charged is the one shown. */
      prorationAt: z.string().datetime(),
      limits: LimitsSchema,
    }),
    z.object({
      kind: z.enum(['downgrade', 'to_starter']),
      plan: PlanChangeTargetSchema,
      /** The paid period's end: the change takes effect then; no refund. */
      effectiveAt: z.string().datetime(),
      limits: LimitsSchema,
      /** The target's business count and the person's own businesses; past it they must pick which stay active. */
      cap: z.number().int(),
      businesses: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
      mustChoose: z.boolean(),
    }),
  ])
  .openapi('PlanChangePreview');

const ConfirmRequestSchema = z
  .object({
    plan: PlanChangeTargetSchema,
    /** Up: the preview's `prorationAt` and `amountDue`. */
    prorationAt: z.string().datetime().optional(),
    expectedAmountDue: z.number().int().optional(),
    /** Down past the target's business count: the businesses that stay active (1 to `cap`). */
    activeBusinessIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .openapi('PlanChangeRequest');

const ChangeSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(['UPGRADE', 'DOWNGRADE', 'TO_STARTER']),
    state: z.enum(['APPLIED', 'PENDING', 'SCHEDULED', 'UNDONE', 'FAILED']),
    fromPlan: z.string(),
    toPlan: z.string(),
    effectiveAt: z.string().datetime(),
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('PlanChange');

const ConfirmResultSchema = z
  .object({
    /** applied: in force now; pending: the bank wants the person to approve the charge (`hostedInvoiceUrl`); scheduled: from `change.effectiveAt`. */
    state: z.enum(['applied', 'pending', 'scheduled']),
    change: ChangeSchema,
    hostedInvoiceUrl: z.string().url().nullable(),
  })
  .openapi('PlanChangeResult');

const errorContent = { content: { 'application/json': { schema: ErrorEnvelopeSchema } } };
const changeResponses = {
  ...refusedResponses,
  409: {
    description:
      'CONFLICT; `details.reason` is PLAN_CHECKOUT_OFF, NOT_SUBSCRIBED (use Checkout), SAME_PLAN, PAUSED, PAST_DUE, CANCELLING, SCHEDULE_PENDING (undo it first), ' +
      'LEGACY_PLAN (Freelancer and founder plans move with MUT-707), PRICES_NOT_SET, PREVIEW_EXPIRED (preview again), AMOUNT_CHANGED (nothing charged), ' +
      'PAYMENT_FAILED (the plan stays as it was), or NOTHING_SCHEDULED (undo)',
    ...errorContent,
  },
  422: { description: 'VALIDATION_FAILED; `details.reason` ACTIVE_BUSINESSES_REQUIRED with `cap` and `businesses` (the person must pick which stay active)', ...errorContent },
} as const;

type Refusal = string;
const refuse = (reason: Refusal, extra: Record<string, unknown> = {}) => new ApiError('CONFLICT', `This plan can’t change: ${reason}`, { reason, ...extra });

export function billingPlanChangeRoutes(store: LedgerStore, options: BillingPlanChangeRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  /** The shown profile-plan subscription as Stripe holds it now, the person's businesses, and the plan catalogs. */
  async function contextOf(user: UserRecord, now: Date) {
    if (!options.planSales) throw refuse('PLAN_CHECKOUT_OFF');
    const checkout = requireCheckout(options.checkout);
    const plan = requirePlan(options.plan);
    const summary = await store.billing.summaryOf(user.id);
    const shown = summary.account ? currentSubscription(profilePlanSubscriptions(summary.subscriptions), now) : undefined;
    if (!shown || !summary.account) throw refuse('NOT_SUBSCRIBED');
    const customer = summary.account.stripeCustomerId;
    const [live, catalogs, changes] = await Promise.all([
      viaStripe(() => plan.planOf(shown.stripeSubscriptionId), user, customer, options.logger),
      viaStripe(() => stripeProvider(checkout).catalogs(), user, customer, options.logger),
      store.billing.planChangesOf(user.id),
    ]);
    const owned = (await ownedProfilesOf(store, user.id)).filter((o) => o.personalOwnerUserId === null);
    const scheduled = changes.find((ch) => ch.state === 'SCHEDULED') ?? null;
    return { plan, live, catalogs, customer, owned, scheduled, current: currentOf(shown, live, scheduled !== null) };
  }

  function decide(ctx: Awaited<ReturnType<typeof contextOf>>, target: PlanChangeTarget, chosen: readonly string[] | null): Exclude<PlanChangeDecision, { refused: unknown }> {
    const decision = planChangeOf({ current: ctx.current, target, ownedBusinesses: ctx.owned.map((o) => o.id), chosenActive: chosen });
    if ('refused' in decision) {
      if (decision.refused === 'ACTIVE_BUSINESSES_REQUIRED') {
        throw new ApiError('VALIDATION_FAILED', 'Pick the businesses that stay active', { reason: 'ACTIVE_BUSINESSES_REQUIRED', cap: decision.cap ?? 1, businesses: ctx.owned.map((o) => ({ id: o.id, name: o.name })) });
      }
      throw refuse(decision.refused);
    }
    return decision;
  }

  /** The target plan's price in the subscription's own currency and interval. */
  function targetPrice(live: LivePlan, catalogs: PlanCatalogs, target: PlanName) {
    const currency = (live.price?.currency ?? '').toUpperCase() as keyof Catalog;
    const interval = intervalOf(live.lookupKey);
    const prices = catalogs[target]?.[currency];
    if (!prices || !interval) throw refuse('PRICES_NOT_SET');
    return { price: interval === 'month' ? prices.month : prices.year, interval, currency };
  }

  async function previewUp(user: UserRecord, ctx: Awaited<ReturnType<typeof contextOf>>, target: PlanName, at: Date) {
    const { price } = targetPrice(ctx.live, ctx.catalogs, target);
    return viaStripe(
      () => ctx.plan.previewYearlySwitch({ subscriptionId: ctx.live.id, customer: ctx.live.customer, itemId: ctx.live.itemId, yearlyPriceId: price.id, prorationDate: at, taxRates: ctx.live.taxRateIds }),
      user,
      ctx.customer,
      options.logger,
    );
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/plan-change/preview',
      tags: ['Billing'],
      summary: 'Preview a plan change (MUT-734)',
      description:
        'Up a rank: Stripe’s proration charged now, tax included, at `prorationAt`. Down (or to Starter): from the paid period’s end, no refund; past the target’s business count the ' +
        'person picks which businesses stay active (`mustChoose`). The interval is kept. Additive since 1.157.0-mut734.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: PreviewRequestSchema } } } },
      responses: { 200: { description: 'The preview', content: { 'application/json': { schema: PreviewSchema } } }, ...changeResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const { plan: target } = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const ctx = await contextOf(user, now);
      // Previewing never needs the pick: a reducing change is shown with `mustChoose`, refused only on confirm.
      const decision = planChangeOf({ current: ctx.current, target, ownedBusinesses: ctx.owned.map((o) => o.id), chosenActive: ctx.owned.map((o) => o.id).slice(0, PLAN_LIMITS[target].businesses) });
      if ('refused' in decision) throw refuse(decision.refused);
      if (decision.kind === 'upgrade') {
        const at = ctx.live.clockNow ?? now;
        const preview = await previewUp(user, ctx, target as PlanName, at);
        return c.json({ kind: 'upgrade' as const, plan: target, amountDue: preview.amountDue, currency: preview.currency, prorationAt: at.toISOString(), limits: PLAN_LIMITS[target] }, 200);
      }
      const cap = PLAN_LIMITS[target].businesses;
      return c.json(
        { kind: decision.kind, plan: target, effectiveAt: decision.effectiveAt.toISOString(), limits: PLAN_LIMITS[target], cap, businesses: ctx.owned.map((o) => ({ id: o.id, name: o.name })), mustChoose: ctx.owned.length > cap },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/plan-change',
      tags: ['Billing'],
      summary: 'Change plan (MUT-734)',
      description:
        'Up: moves the subscription to the higher plan at the preview’s `prorationAt` (at most 15 minutes old), charging Stripe’s proration at once; Stripe previews again ' +
        'first and an amount other than `expectedAmountDue` charges nothing. A payment the bank wants approved answers 202 `pending` with Stripe’s page; one that fails ' +
        'leaves the plan as it was. Down: a Stripe subscription schedule switches to the lower plan at the period end. To Starter: cancel at the period end and Starter ' +
        'chosen now (no read-only gap). Past the target’s business count, `activeBusinessIds` is required. Every change is recorded (`billing_plan_changes`) and audited ' +
        '`billing.plan_change_*`; a scheduled one is mailed. Additive since 1.157.0-mut734.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: ConfirmRequestSchema } } } },
      responses: {
        200: { description: 'Applied, or scheduled', content: { 'application/json': { schema: ConfirmResultSchema } } },
        202: { description: 'Pending: the bank wants the person to approve the charge on `hostedInvoiceUrl`', content: { 'application/json': { schema: ConfirmResultSchema } } },
        ...changeResponses,
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      const ctx = await contextOf(user, now);
      const decision = decide(ctx, body.plan, body.activeBusinessIds ?? null);
      const fromTier = ctx.current.tier;
      const profiles = await ownedProfilesOf(store, user.id);
      const requestId = c.get('requestId');
      if (decision.kind === 'upgrade') {
        const target = body.plan as PlanName;
        if (!body.prorationAt || body.expectedAmountDue === undefined) throw new ApiError('VALIDATION_FAILED', 'An upgrade needs the preview’s prorationAt and amountDue', { fields: ['prorationAt', 'expectedAmountDue'] });
        const prorationAt = new Date(body.prorationAt);
        const age = (ctx.live.clockNow ?? now).getTime() - prorationAt.getTime();
        if (age > PLAN_CHANGE_PREVIEW_MAX_AGE_MS || age < -CLOCK_SKEW_MS) throw refuse('PREVIEW_EXPIRED');
        const again = await previewUp(user, ctx, target, prorationAt);
        if (again.amountDue !== body.expectedAmountDue) throw refuse('AMOUNT_CHANGED');
        const { price } = targetPrice(ctx.live, ctx.catalogs, target);
        const result = await viaStripe(
          () => ctx.plan.changePlan({ subscriptionId: ctx.live.id, customer: ctx.live.customer, itemId: ctx.live.itemId, yearlyPriceId: price.id, prorationDate: prorationAt, taxRates: ctx.live.taxRateIds, plan: target }),
          user,
          ctx.customer,
          options.logger,
        );
        const state = result.outcome === 'switched' ? 'APPLIED' : result.outcome === 'payment-needs-action' ? 'PENDING' : 'FAILED';
        const change = await record(user, ctx.live.id, fromTier, TIER_OF[target], 'UPGRADE', state, now, { amountMinor: again.amountDue, currency: again.currency }, profiles, requestId);
        if (result.outcome === 'payment-failed') throw refuse('PAYMENT_FAILED', { changeId: change.id });
        const hostedInvoiceUrl = result.outcome === 'payment-needs-action' ? result.hostedInvoiceUrl : null;
        return state === 'PENDING'
          ? c.json({ state: 'pending' as const, change: changeView(change), hostedInvoiceUrl }, 202)
          : c.json({ state: 'applied' as const, change: changeView(change), hostedInvoiceUrl: null }, 200);
      }
      // Down: the businesses kept are stored first (they apply only once the lower plan does; nothing is read-only before).
      if (decision.readOnly.length > 0) await store.billing.setActiveBusinesses(user.id, decision.active, now, []);
      if (decision.kind === 'to_starter') {
        await viaStripe(() => ctx.plan.cancelAtPeriodEnd({ subscriptionId: ctx.live.id, feedback: 'other', comment: 'Moved to Starter (MUT-734)' }), user, ctx.customer, options.logger);
        await store.billing.chooseStarter(user.id, now, []);
      } else {
        const target = body.plan as PlanName;
        const { price, interval } = targetPrice(ctx.live, ctx.catalogs, target);
        if (!ctx.live.price) throw refuse('PRICES_NOT_SET');
        const currentPriceId = ctx.live.price.id;
        await viaStripe(
          () => ctx.plan.scheduleDowngrade({ subscriptionId: ctx.live.id, currentPriceId, targetPriceId: price.id, interval, periodEnd: decision.effectiveAt, plan: target, taxRates: ctx.live.taxRateIds }),
          user,
          ctx.customer,
          options.logger,
        );
      }
      const kind = decision.kind === 'to_starter' ? 'TO_STARTER' : 'DOWNGRADE';
      const change = await record(user, ctx.live.id, fromTier, TIER_OF[body.plan], kind, 'SCHEDULED', now, { effectiveAt: decision.effectiveAt }, profiles, requestId);
      await mailScheduled(user, body.plan, decision.effectiveAt, c);
      return c.json({ state: 'scheduled' as const, change: changeView(change), hostedInvoiceUrl: null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/billing/plan-change',
      tags: ['Billing'],
      summary: 'Undo a scheduled plan change (MUT-734)',
      description: 'Before its day: a scheduled downgrade’s Stripe schedule is released (the current plan renews); a move to Starter takes the cancel back and clears the Starter choice. 409 NOTHING_SCHEDULED otherwise. Additive since 1.157.0-mut734.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'Undone', content: { 'application/json': { schema: z.object({ change: ChangeSchema }) } } }, ...changeResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      await limit(c, options.limiter, user.id, now);
      if (!options.planSales) throw refuse('PLAN_CHECKOUT_OFF');
      const plan = requirePlan(options.plan);
      const scheduled = (await store.billing.planChangesOf(user.id)).find((ch) => ch.state === 'SCHEDULED');
      if (!scheduled) throw refuse('NOTHING_SCHEDULED');
      const summary = await store.billing.summaryOf(user.id);
      const customer = summary.account?.stripeCustomerId ?? null;
      const live = await viaStripe(() => plan.planOf(scheduled.stripeSubscriptionId), user, customer, options.logger);
      if (scheduled.kind === 'TO_STARTER') await viaStripe(() => plan.keepPlan(live.id), user, customer, options.logger);
      else if (live.scheduleId) await viaStripe(() => plan.releaseSchedule(live.scheduleId!), user, customer, options.logger);
      const profiles = await ownedProfilesOf(store, user.id);
      const audit = profiles.map((p) => ({ organizationId: p.id, actorType: 'USER' as const, actorId: user.id, action: 'billing.plan_change_undone', entityType: 'user', entityId: user.id, metadata: { changeId: scheduled.id }, requestId: c.get('requestId') }));
      const undone = await store.billing.settlePlanChange(scheduled.id, 'UNDONE', now, { clearStarterChoice: scheduled.kind === 'TO_STARTER', audit });
      if (!undone) throw refuse('NOTHING_SCHEDULED');
      return c.json({ change: changeView(undone) }, 200);
    },
  );

  async function record(
    user: UserRecord,
    subscriptionId: string,
    fromTier: string,
    toTier: string,
    kind: BillingPlanChangeRecord['kind'],
    state: BillingPlanChangeRecord['state'],
    now: Date,
    extra: { amountMinor?: number; currency?: string; effectiveAt?: Date },
    profiles: readonly { id: string }[],
    requestId: string,
  ): Promise<BillingPlanChangeRecord> {
    const action = `billing.plan_change_${state === 'SCHEDULED' ? 'scheduled' : state.toLowerCase()}`;
    const metadata = { kind, fromTier, toTier, state };
    const audit = profiles.map((p) => ({ organizationId: p.id, actorType: 'USER' as const, actorId: user.id, action, entityType: 'user', entityId: user.id, metadata, requestId }));
    try {
      return await store.billing.recordPlanChange({
        userId: user.id,
        stripeSubscriptionId: subscriptionId,
        fromTier,
        toTier,
        kind,
        state,
        effectiveAt: extra.effectiveAt ?? now,
        amountMinor: extra.amountMinor ?? null,
        currency: extra.currency ?? null,
        at: now,
        audit,
      });
    } catch (err) {
      if (err instanceof StateConflict) throw refuse('SCHEDULE_PENDING');
      throw err;
    }
  }

  /** After the change is recorded and never able to undo it. */
  async function mailScheduled(user: UserRecord, plan: PlanChangeTarget, at: Date, c: Context<AppEnv>): Promise<void> {
    try {
      const manageLink = `${(options.settings.portalOrigin ?? new URL(c.req.url).origin).replace(/\/+$/, '')}/?billing=true`;
      const sent = await options.mailer.send({ to: user.email, locale: user.locale, template: 'plan-change-scheduled', vars: { plan, changesOn: jerusalemDayOf(at), manageLink }, idempotencyKey: `plan-change:${user.id}:${plan}:${at.getTime()}` });
      if (sent.status !== 'sent') options.logger.info({ template: 'plan-change-scheduled', outcome: sent.status }, 'plan change mail not sent');
    } catch (err) {
      options.logger.error({ err, template: 'plan-change-scheduled' }, 'plan change mail failed');
    }
  }

  return app;
}

/** What the decision needs of the subscription: the tier from Stripe's live price (the mirror's when it names none). */
function currentOf(shown: BillingSubscriptionRecord, live: LivePlan, scheduled: boolean): PlanChangeCurrent {
  const plan = live.lookupKey ? planOfLookupKey(live.lookupKey) : null;
  return {
    tier: plan ? TIER_OF[plan] : shown.tier,
    status: live.status,
    currentPeriodEnd: live.currentPeriodEnd,
    paused: live.paused || live.pause !== null,
    cancelAtPeriodEnd: live.cancelAtPeriodEnd,
    managedBySchedule: live.managedBySchedule,
    scheduled,
  };
}

function intervalOf(lookupKey: string | null): 'month' | 'year' | null {
  if (!lookupKey) return null;
  if (lookupKey.includes('_monthly_')) return 'month';
  if (lookupKey.includes('_yearly_')) return 'year';
  return null;
}

function requirePlan(plan: PlanGateway | null): PlanGateway {
  if (!plan) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server');
  return plan;
}

/** The mail's day: the period end on the Jerusalem calendar (as every billing mail names its days). */
function jerusalemDayOf(at: Date): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

