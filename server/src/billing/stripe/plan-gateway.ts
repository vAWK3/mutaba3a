import Stripe from 'stripe';
import { CATALOG_FAILURE_TTL_MS, CATALOG_TTL_MS } from './checkout-gateway.js';
import { STRIPE_API_VERSION, StripeGatewayError, toGatewayError } from './gateway.js';
import { PAUSE_FROM_METADATA, PAUSE_MONTHS_METADATA, pauseOf, periodEndOf, stateOf } from './mirror.js';
import type { FailedPaymentFacts } from '../card-failed-mail.js';
import { SWITCH_AFTER_PAID_INVOICES, type CancellationReason } from '../retention.js';

/**
 * MUT-531 (plan §2.2, D1, R1, R2, ADR-238): what changing a person's own plan asks of Stripe, apart from MUT-362's
 * checkout door and MUT-333's closing door so each port's contract stays as reviewed. Built from the same restricted
 * key, which already has Write on Subscriptions (MUT-333 D14).
 *
 *   switch:  planOf → paidInvoiceCount → previewYearlySwitch → switchToYearly (same proration_date)
 *   MUT-532: schedulePause · endPause (undo, or Resume now) · cancelAtPeriodEnd · keepPlan · applyCoupon
 *
 * MUT-532's writes are keyed on the subscription and the minute (`mut532-<action>-<sub>-<minute>`): a double press
 * makes one change, and the same press a minute later is a new one.
 */
export interface PlanGateway {
  /** The subscription as Stripe holds it now: its one priced item, discounts, pause and cancel state. */
  planOf(subscriptionId: string): Promise<LivePlan>;
  /**
   * R1: invoices that took money (a ₪0 trial invoice doesn't count). Once the count reaches the switch threshold it
   * stays cached for good (it only grows); a lower count for CATALOG_TTL_MS, a failure for CATALOG_FAILURE_TTL_MS.
   * `fresh` skips the cache (the switch itself).
   */
  paidInvoiceCount(subscriptionId: string, options?: { fresh?: boolean }): Promise<number>;
  /**
   * D1: what the switch charges today, Stripe's own proration at `prorationDate`, tax included, and when the yearly
   * period ends. The spike: Stripe keeps the person's billing day, so the first year runs to that day's anniversary.
   */
  previewYearlySwitch(input: SwitchInput): Promise<{ amountDue: number; currency: string; renewsOn: Date | null }>;
  /** D1, R2: the switch itself; a payment that didn't go through leaves the plan monthly (`pending_if_incomplete`). */
  switchToYearly(input: SwitchInput): Promise<SwitchResult>;
  /** MUT-532 (D6): Stripe voids every invoice until `resumesAt`; the metadata names the pause's own start. */
  schedulePause(input: { subscriptionId: string; from: Date; resumesAt: Date; months: number }): Promise<void>;
  /**
   * MUT-532 (D7): `undo` clears a pause before it starts; `now` ends a running one and charges a full month today,
   * renewing monthly from today. Restarting the cycle makes no invoice of its own (the spike), so the month is its own
   * invoice on the subscription: a declined card leaves it past_due, and Stripe retries it (GRACE).
   */
  endPause(input: { subscriptionId: string; mode: 'undo' | 'now' }): Promise<EndPauseResult>;
  /** MUT-532 (D8): ends with the paid period; Stripe keeps the person's reason and comment. */
  cancelAtPeriodEnd(input: { subscriptionId: string; feedback: CancellationReason; comment: string | null }): Promise<{ endsOn: Date | null }>;
  /** MUT-532 (D8): takes a cancel back, ours or the Customer Portal's `cancel_at` (one call clears both). */
  keepPlan(subscriptionId: string): Promise<void>;
  /** MUT-532 (D11): the stay coupon on the subscription; the next invoices carry it. */
  applyCoupon(subscriptionId: string, couponId: string): Promise<void>;
  /**
   * MUT-533 (D2): a past_due subscription's dunning episode, its oldest open invoice a payment was attempted on, with
   * when that first failed (its finalization: the spike saw the first attempt there) and whether the bank wants the
   * person to confirm. Null when Stripe no longer has the subscription. One read for anything not past_due.
   */
  failedPaymentOf(subscriptionId: string): Promise<FailedPaymentFacts | null>;
  /**
   * MUT-533 (D5): pays an open invoice now, on the customer's default card. Stripe's card form sets the new card as the
   * customer's default but pays nothing until its next retry (QA, 2026-11-03), so the drawer asks for this on the way
   * back. Keyed on the invoice and its attempt count: a double press replays the first answer; after a failed try the
   * count has moved on and a new card can be tried. A decline or a bank that wants the person to confirm is an outcome.
   */
  retryPayment(invoiceId: string, attemptCount: number): Promise<CardRetryResult>;
  /**
   * MUT-750 (ADR-290): re-taxes the item after the billing address moved into or out of Israel, from the next invoice
   * (no proration). Keyed on the subscription, the new country and the minute: a redelivery makes one change.
   */
  retax(input: RetaxInput): Promise<void>;
  /**
   * MUT-734 (ADR-291): an upgrade, as the yearly switch: the item moves to `priceId` at the previewed proration date,
   * charged now (`always_invoice`), and a payment that didn't go through leaves the plan as it was
   * (`pending_if_incomplete`). The item's tax rates go with it (ADR-290); `mutaba3a_plan` names the new plan.
   */
  changePlan(input: SwitchInput & { plan: string }): Promise<SwitchResult>;
  /**
   * MUT-734: a downgrade at the paid period's end: a subscription schedule from the subscription, phase 1 the current
   * price to the period end, phase 2 the lower plan's price for one cycle, then released (the subscription carries on
   * at it). Keyed on the subscription and the target price.
   */
  scheduleDowngrade(input: ScheduleDowngradeInput): Promise<{ scheduleId: string }>;
  /** MUT-734: undoes a scheduled downgrade: releases the schedule, keeping the current price. */
  releaseSchedule(scheduleId: string): Promise<void>;
}

export interface ScheduleDowngradeInput {
  subscriptionId: string;
  currentPriceId: string;
  targetPriceId: string;
  /** The current price's interval: the schedule's second phase runs one of it. */
  interval: 'month' | 'year';
  /** The paid period's end: where the lower price starts. */
  periodEnd: Date;
  plan: string;
  taxRates: string[];
  /**
   * MUT-703 (§3.7, spike S2): the subscription's running discounts (`di_…`). Stripe's phases replace the subscription's
   * discounts, so without these a running stay offer is dropped the moment the downgrade is scheduled; carried into both
   * phases, it keeps running to its own end.
   */
  discountIds?: string[];
}

export interface RetaxInput {
  subscriptionId: string;
  itemId: string;
  /** The billing address's new country (null: none); names the idempotency key. */
  country: string | null;
  taxRates: string[];
  automaticTax: boolean;
}

export type CardRetryResult = { outcome: 'paid' | 'declined' | 'needs-action'; hostedInvoiceUrl: string | null };

export type EndPauseResult = { outcome: 'undone' } | { outcome: 'charged' } | { outcome: 'payment-failed' } | { outcome: 'payment-needs-action'; hostedInvoiceUrl: string | null };

/** What MUT-532's resume invoice copies of the subscription's own price. */
export interface LivePrice {
  id: string;
  currency: string;
  productId: string;
  unitAmount: number;
  taxBehavior: string | null;
}

export interface LivePlan {
  id: string;
  customer: string;
  status: string;
  itemId: string;
  lookupKey: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  discounted: boolean;
  paused: boolean;
  /**
   * A sandbox test clock's frozen time, else null. Stripe prorates on the subscription's own clock, so the switch's
   * proration date is this one when it is set (QA's test clocks) and the server's time otherwise.
   */
  clockNow: Date | null;
  /** MUT-532: the day the cycle counts from (the pause's restart dates follow it). */
  billingCycleAnchor: Date | null;
  price: LivePrice | null;
  /** MUT-532 (R3): the coupons on it, so a stay offer that timed out can be checked. */
  couponIds: string[];
  /** MUT-703: its discounts' own ids (`di_…`), so a scheduled downgrade carries them (spike S2). */
  discountIds: string[];
  /** MUT-532: the pause Stripe holds, as the mirror reads it. Null with none set. */
  pause: { from: Date | null; resumesAt: Date | null } | null;
  automaticTax: boolean;
  /** MUT-750: the fixed tax rates on the item (the Israeli VAT rate for an Israeli address); empty under Stripe Tax. */
  taxRateIds: string[];
  /** A founder price runs on a subscription schedule, which refuses direct cancel changes (the probe). */
  managedBySchedule: boolean;
  /** MUT-734: that schedule's id (to release a scheduled downgrade); null with none. */
  scheduleId: string | null;
}

export interface SwitchInput {
  subscriptionId: string;
  customer: string;
  itemId: string;
  yearlyPriceId: string;
  prorationDate: Date;
  /** MUT-750 (ADR-290): the item's tax rates, sent explicitly with the new price so an Israeli plan keeps its VAT. */
  taxRates?: string[];
  /**
   * MUT-703 (§3.7, §13 Q7): an upgrade removes the running discounts in the same call (and its preview prices without
   * them): a coupon on all three plans' products would otherwise follow the person onto the higher plan (spike S1b).
   */
  dropDiscounts?: boolean;
}

export type SwitchResult =
  | { outcome: 'switched'; currentPeriodEnd: Date | null }
  /** R2: the invoice is open; Stripe's page lets the person approve it (3-D Secure) or pay another way. */
  | { outcome: 'payment-needs-action'; hostedInvoiceUrl: string | null }
  | { outcome: 'payment-failed' };

export interface PlanGatewayOptions {
  secretKey: string;
  timeoutMs: number;
  maxNetworkRetries: number;
  now: () => Date;
  httpClient?: Stripe.HttpClient;
}

const INVOICE_PAGE = 5;
/** MUT-533: a past_due monthly plan has at most a few open invoices (one a month while Stripe retries). */
const OPEN_INVOICE_PAGE = 10;
const PAYMENT_ACTION_STATUSES: ReadonlySet<string> = new Set(['requires_action', 'requires_confirmation']);

type CountEntry = { at: number; count: number } | { at: number; failure: StripeGatewayError };

export function createPlanGateway(options: PlanGatewayOptions): PlanGateway {
  const stripe = new Stripe(options.secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    timeout: options.timeoutMs,
    maxNetworkRetries: options.maxNetworkRetries,
    telemetry: false,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
  const counts = new Map<string, CountEntry>();

  async function countPaid(subscriptionId: string): Promise<number> {
    const at = options.now().getTime();
    try {
      const page = await wrapped(() => stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: INVOICE_PAGE }));
      const count = page.data.filter((invoice) => invoice.amount_paid > 0).length;
      counts.set(subscriptionId, { at, count });
      return count;
    } catch (err) {
      const failure = err instanceof StripeGatewayError ? err : toGatewayError(err);
      counts.set(subscriptionId, { at, failure });
      throw failure;
    }
  }

  /** Why the switch's invoice wasn't paid: a payment waiting for the person, or one that failed. */
  async function unpaidOutcome(invoiceId: string | null): Promise<SwitchResult> {
    if (!invoiceId) return { outcome: 'payment-failed' };
    const invoice = await wrapped(() => stripe.invoices.retrieve(invoiceId, { expand: ['payments.data.payment.payment_intent'] }));
    const intents = (invoice.payments?.data ?? []).map((p) => p.payment?.payment_intent).filter((pi): pi is Stripe.PaymentIntent => typeof pi === 'object' && pi !== null);
    const needsAction = intents.some((pi) => PAYMENT_ACTION_STATUSES.has(pi.status));
    return needsAction ? { outcome: 'payment-needs-action', hostedInvoiceUrl: invoice.hosted_invoice_url ?? null } : { outcome: 'payment-failed' };
  }

  return {
    async planOf(subscriptionId) {
      const sub = await wrapped(() => stripe.subscriptions.retrieve(subscriptionId, { expand: ['test_clock', 'discounts'] }));
      const item = sub.items.data[0];
      if (!item) throw new StripeGatewayError({ code: 'no_items', type: 'UnexpectedResponse', requestId: null, transient: false });
      const state = stateOf(sub);
      return {
        id: sub.id,
        customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        status: sub.status,
        itemId: item.id,
        lookupKey: item.price.lookup_key ?? null,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        currentPeriodEnd: state.currentPeriodEnd,
        discounted: (sub.discounts ?? []).length > 0,
        paused: sub.pause_collection !== null && sub.pause_collection !== undefined,
        clockNow: typeof sub.test_clock === 'object' && sub.test_clock !== null ? new Date(sub.test_clock.frozen_time * 1000) : null,
        billingCycleAnchor: typeof sub.billing_cycle_anchor === 'number' ? new Date(sub.billing_cycle_anchor * 1000) : null,
        price: priceOf(item.price),
        couponIds: (sub.discounts ?? []).flatMap((discount) => couponIdOf(discount)),
        discountIds: (sub.discounts ?? []).map((discount) => (typeof discount === 'string' ? discount : discount.id)),
        pause: pauseFactOf(sub),
        automaticTax: sub.automatic_tax?.enabled === true,
        taxRateIds: (item.tax_rates ?? []).map((rate) => (typeof rate === 'string' ? rate : rate.id)),
        managedBySchedule: sub.schedule !== null && sub.schedule !== undefined,
        scheduleId: typeof sub.schedule === 'string' ? sub.schedule : (sub.schedule?.id ?? null),
      };
    },
    async paidInvoiceCount(subscriptionId, { fresh = false } = {}) {
      const hit = fresh ? undefined : counts.get(subscriptionId);
      const age = hit ? options.now().getTime() - hit.at : Number.POSITIVE_INFINITY;
      if (hit && 'count' in hit && (hit.count >= SWITCH_AFTER_PAID_INVOICES || age < CATALOG_TTL_MS)) return hit.count;
      if (hit && 'failure' in hit && age < CATALOG_FAILURE_TTL_MS) throw hit.failure;
      return countPaid(subscriptionId);
    },
    async previewYearlySwitch(input) {
      const preview = await wrapped(() =>
        stripe.invoices.createPreview({
          customer: input.customer,
          subscription: input.subscriptionId,
          subscription_details: {
            items: [{ id: input.itemId, price: input.yearlyPriceId, ...taxRatesOf(input) }],
            proration_behavior: 'always_invoice',
            proration_date: seconds(input.prorationDate),
          },
          ...(input.dropDiscounts ? { discounts: '' as const } : {}),
        }),
      );
      const ends = preview.lines.data.map((line) => line.period?.end).filter((end): end is number => typeof end === 'number');
      return { amountDue: preview.amount_due, currency: preview.currency.toUpperCase(), renewsOn: ends.length > 0 ? new Date(Math.max(...ends) * 1000) : null };
    },
    async switchToYearly(input) {
      // D4: no `discounts` here, ever: the switch carries no coupon, the launch offer's included.
      const sub = await wrapped(() =>
        stripe.subscriptions.update(
          input.subscriptionId,
          {
            items: [{ id: input.itemId, price: input.yearlyPriceId, ...taxRatesOf(input) }],
            proration_behavior: 'always_invoice',
            proration_date: seconds(input.prorationDate),
            payment_behavior: 'pending_if_incomplete',
          },
          // A double press within Stripe's 24 h window makes one switch, never two invoices.
          { idempotencyKey: `mut531-switch-${input.subscriptionId}-${input.yearlyPriceId}-${seconds(input.prorationDate)}` },
        ),
      );
      if (!sub.pending_update) return { outcome: 'switched', currentPeriodEnd: periodEndOf(sub) };
      const invoice = sub.latest_invoice;
      return unpaidOutcome(typeof invoice === 'string' ? invoice : (invoice?.id ?? null));
    },
    async changePlan(input) {
      const sub = await wrapped(() =>
        stripe.subscriptions.update(
          input.subscriptionId,
          {
            items: [{ id: input.itemId, price: input.yearlyPriceId, ...taxRatesOf(input) }],
            proration_behavior: 'always_invoice',
            proration_date: seconds(input.prorationDate),
            payment_behavior: 'pending_if_incomplete',
            metadata: { mutaba3a_plan: input.plan },
            ...(input.dropDiscounts ? { discounts: '' as const } : {}),
          },
          { idempotencyKey: `mut734-up-${input.subscriptionId}-${input.yearlyPriceId}-${seconds(input.prorationDate)}` },
        ),
      );
      if (!sub.pending_update) return { outcome: 'switched', currentPeriodEnd: periodEndOf(sub) };
      const invoice = sub.latest_invoice;
      return unpaidOutcome(typeof invoice === 'string' ? invoice : (invoice?.id ?? null));
    },
    async scheduleDowngrade(input) {
      const key = `mut734-down-${input.subscriptionId}-${input.targetPriceId}`;
      const created = await wrapped(() => stripe.subscriptionSchedules.create({ from_subscription: input.subscriptionId }, { idempotencyKey: `${key}-create` }));
      const first = created.phases[0];
      const taxes = input.taxRates.length > 0 ? { tax_rates: input.taxRates } : {};
      const discounts = input.discountIds && input.discountIds.length > 0 ? { discounts: input.discountIds.map((discount) => ({ discount })) } : {};
      await wrapped(() =>
        stripe.subscriptionSchedules.update(
          created.id,
          {
            end_behavior: 'release',
            phases: [
              { items: [{ price: input.currentPriceId, quantity: 1, ...taxes }], ...(first ? { start_date: first.start_date } : {}), end_date: seconds(input.periodEnd), proration_behavior: 'none', ...discounts },
              { items: [{ price: input.targetPriceId, quantity: 1, ...taxes }], duration: { interval: input.interval, interval_count: 1 }, proration_behavior: 'none', metadata: { mutaba3a_plan: input.plan }, ...discounts },
            ],
          },
          { idempotencyKey: `${key}-phases` },
        ),
      );
      return { scheduleId: created.id };
    },
    async releaseSchedule(scheduleId) {
      await wrapped(() => stripe.subscriptionSchedules.release(scheduleId, {}, { idempotencyKey: `mut734-release-${scheduleId}-${minuteOf(options.now())}` }));
    },
    async retax({ subscriptionId, itemId, country, taxRates, automaticTax }) {
      await wrapped(() =>
        stripe.subscriptions.update(
          subscriptionId,
          { items: [{ id: itemId, tax_rates: taxRates.length > 0 ? taxRates : '' }], automatic_tax: { enabled: automaticTax }, proration_behavior: 'none' },
          { idempotencyKey: `mut750-retax-${subscriptionId}-${country ?? 'none'}-${minuteOf(options.now())}` },
        ),
      );
    },
    async schedulePause({ subscriptionId, from, resumesAt, months }) {
      await wrapped(() =>
        stripe.subscriptions.update(
          subscriptionId,
          {
            pause_collection: { behavior: 'void', resumes_at: seconds(resumesAt) },
            metadata: { [PAUSE_FROM_METADATA]: from.toISOString(), [PAUSE_MONTHS_METADATA]: String(months) },
          },
          { idempotencyKey: `mut532-pause-${subscriptionId}-${seconds(resumesAt)}` },
        ),
      );
    },
    async endPause({ subscriptionId, mode }) {
      const key = `mut532-${mode === 'now' ? 'resume' : 'undo-pause'}-${subscriptionId}-${minuteOf(options.now())}`;
      const cleared = { pause_collection: '' as const, metadata: { [PAUSE_FROM_METADATA]: '', [PAUSE_MONTHS_METADATA]: '' } };
      if (mode === 'undo') {
        await wrapped(() => stripe.subscriptions.update(subscriptionId, cleared, { idempotencyKey: key }));
        return { outcome: 'undone' };
      }
      const sub = await wrapped(() =>
        stripe.subscriptions.update(subscriptionId, { ...cleared, billing_cycle_anchor: { type: 'now' }, proration_behavior: 'none' }, { idempotencyKey: key }),
      );
      return chargeMonth(sub, key);
    },
    async cancelAtPeriodEnd({ subscriptionId, feedback, comment }) {
      const sub = await wrapped(() =>
        stripe.subscriptions.update(
          subscriptionId,
          { cancel_at_period_end: true, cancellation_details: { feedback, ...(comment ? { comment } : {}) } },
          { idempotencyKey: `mut532-cancel-${subscriptionId}-${minuteOf(options.now())}` },
        ),
      );
      return { endsOn: periodEndOf(sub) };
    },
    async keepPlan(subscriptionId) {
      await wrapped(() => stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false }, { idempotencyKey: `mut532-keep-${subscriptionId}-${minuteOf(options.now())}` }));
    },
    async applyCoupon(subscriptionId, couponId) {
      // Once per subscription and coupon, ever (rule 2): a retry within Stripe's 24 h replays the first answer.
      await wrapped(() => stripe.subscriptions.update(subscriptionId, { discounts: [{ coupon: couponId }] }, { idempotencyKey: `mut532-stay-${subscriptionId}-${couponId}` }));
    },
    async retryPayment(invoiceId, attemptCount) {
      try {
        const invoice = await wrapped(() => stripe.invoices.pay(invoiceId, {}, { idempotencyKey: `mut533-card-retry-${invoiceId}-${attemptCount}` }));
        return { outcome: invoice.status === 'paid' ? 'paid' : 'declined', hostedInvoiceUrl: null };
      } catch (err) {
        if (!(err instanceof StripeGatewayError)) throw err;
        if (err.code === 'invoice_payment_intent_requires_action') {
          const invoice = await wrapped(() => stripe.invoices.retrieve(invoiceId));
          return { outcome: 'needs-action', hostedInvoiceUrl: invoice.hosted_invoice_url ?? null };
        }
        if (err.code === 'card_declined' || err.type === 'StripeCardError') return { outcome: 'declined', hostedInvoiceUrl: null };
        throw err;
      }
    },
    async failedPaymentOf(subscriptionId) {
      let sub: Stripe.Subscription;
      try {
        sub = await wrapped(() => stripe.subscriptions.retrieve(subscriptionId));
      } catch (err) {
        if (err instanceof StripeGatewayError && err.code === 'resource_missing') return null;
        throw err;
      }
      if (sub.status !== 'past_due') return { status: sub.status, episode: null };
      const open = await wrapped(() => stripe.invoices.list({ subscription: subscriptionId, status: 'open', limit: OPEN_INVOICE_PAGE }));
      const oldest = open.data.filter((inv) => inv.attempted).sort((a, b) => a.created - b.created)[0];
      if (!oldest?.id) return { status: sub.status, episode: null };
      // R1: four levels from the invoice; from the subscription it would be five, which Stripe refuses.
      const invoice = await wrapped(() => stripe.invoices.retrieve(oldest.id!, { expand: ['payments.data.payment.payment_intent'] }));
      const intents = (invoice.payments?.data ?? []).map((p) => p.payment?.payment_intent).filter((pi): pi is Stripe.PaymentIntent => typeof pi === 'object' && pi !== null);
      const finalizedAt = oldest.status_transitions?.finalized_at ?? oldest.created;
      return {
        status: sub.status,
        episode: {
          invoiceId: oldest.id,
          attemptCount: oldest.attempt_count,
          nextPaymentAttempt: typeof oldest.next_payment_attempt === 'number' ? new Date(oldest.next_payment_attempt * 1000) : null,
          firstFailedAt: new Date(finalizedAt * 1000),
          needsAuthentication: intents.some((pi) => PAYMENT_ACTION_STATUSES.has(pi.status)),
        },
      };
    },
  };

  /** D7: the month Resume now charges, the subscription's own price for its new period, collected at once. */
  async function chargeMonth(sub: Stripe.Subscription, key: string): Promise<EndPauseResult> {
    const item = sub.items.data[0];
    const price = item ? priceOf(item.price) : null;
    if (!item || !price) throw new StripeGatewayError({ code: 'no_items', type: 'UnexpectedResponse', requestId: null, transient: false });
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    await wrapped(() =>
      stripe.invoiceItems.create(
        {
          customer,
          subscription: sub.id,
          price_data: { currency: price.currency, product: price.productId, unit_amount: price.unitAmount, ...(price.taxBehavior ? { tax_behavior: price.taxBehavior as Stripe.InvoiceItemCreateParams.PriceData.TaxBehavior } : {}) },
          period: { start: item.current_period_start, end: item.current_period_end },
        },
        { idempotencyKey: key.replace('resume', 'resume-item') },
      ),
    );
    const draft = await wrapped(() =>
      stripe.invoices.create(
        { customer, subscription: sub.id, auto_advance: true, automatic_tax: { enabled: sub.automatic_tax?.enabled === true } },
        { idempotencyKey: key.replace('resume', 'resume-invoice') },
      ),
    );
    const invoiceId = draft.id!;
    await wrapped(() => stripe.invoices.finalizeInvoice(invoiceId));
    try {
      await wrapped(() => stripe.invoices.pay(invoiceId));
      return { outcome: 'charged' };
    } catch (err) {
      if (!(err instanceof StripeGatewayError) || err.transient) throw err;
      const unpaid = await unpaidOutcome(invoiceId);
      return unpaid.outcome === 'payment-needs-action' ? unpaid : { outcome: 'payment-failed' };
    }
  }
}

function priceOf(price: Stripe.Price): LivePrice | null {
  if (typeof price.unit_amount !== 'number') return null;
  const product = typeof price.product === 'string' ? price.product : price.product.id;
  return { id: price.id, currency: price.currency, productId: product, unitAmount: price.unit_amount, taxBehavior: price.tax_behavior ?? null };
}

/** A discount names its coupon on `source` since 2025-03-31.basil, on `coupon` before. */
function couponIdOf(discount: string | Stripe.Discount): string[] {
  if (typeof discount === 'string') return [];
  const source = (discount as unknown as { source?: { coupon?: string | { id: string } | null } }).source?.coupon;
  const legacy = (discount as unknown as { coupon?: { id: string } | null }).coupon;
  const coupon = source ?? legacy ?? null;
  if (coupon === null) return [];
  return [typeof coupon === 'string' ? coupon : coupon.id];
}

function pauseFactOf(sub: Stripe.Subscription): LivePlan['pause'] {
  const { pausedFrom, pauseResumesAt } = pauseOf(sub);
  return sub.pause_collection ? { from: pausedFrom, resumesAt: pauseResumesAt } : null;
}

function minuteOf(at: Date): number {
  return Math.floor(at.getTime() / 60_000);
}

function seconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

async function wrapped<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw toGatewayError(err);
  }
}

/** MUT-750: an item update names its tax rates only when it has some; Stripe keeps none on an item that had none. */
function taxRatesOf(input: Pick<SwitchInput, 'taxRates'>): { tax_rates?: string[] } {
  return input.taxRates && input.taxRates.length > 0 ? { tax_rates: input.taxRates } : {};
}
