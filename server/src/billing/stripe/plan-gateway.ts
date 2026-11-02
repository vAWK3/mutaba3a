import Stripe from 'stripe';
import { CATALOG_FAILURE_TTL_MS, CATALOG_TTL_MS } from './checkout-gateway.js';
import { STRIPE_API_VERSION, StripeGatewayError, toGatewayError } from './gateway.js';
import { periodEndOf, stateOf } from './mirror.js';
import { SWITCH_AFTER_PAID_INVOICES } from '../retention.js';

/**
 * MUT-531 (plan §2.2, D1, R1, R2, ADR-238): what changing a person's own plan asks of Stripe, apart from MUT-362's
 * checkout door and MUT-333's closing door so each port's contract stays as reviewed. Built from the same restricted
 * key, which already has Write on Subscriptions (MUT-333 D14).
 *
 *   switch:  planOf → paidInvoiceCount → previewYearlySwitch → switchToYearly (same proration_date)
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
  /** D1: what the switch charges today, Stripe's own proration at `prorationDate`, tax included. */
  previewYearlySwitch(input: SwitchInput): Promise<{ amountDue: number; currency: string }>;
  /** D1, R2: the switch itself; a payment that didn't go through leaves the plan monthly (`pending_if_incomplete`). */
  switchToYearly(input: SwitchInput): Promise<SwitchResult>;
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
}

export interface SwitchInput {
  subscriptionId: string;
  customer: string;
  itemId: string;
  yearlyPriceId: string;
  prorationDate: Date;
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
      const sub = await wrapped(() => stripe.subscriptions.retrieve(subscriptionId));
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
            items: [{ id: input.itemId, price: input.yearlyPriceId }],
            proration_behavior: 'always_invoice',
            proration_date: seconds(input.prorationDate),
          },
        }),
      );
      return { amountDue: preview.amount_due, currency: preview.currency.toUpperCase() };
    },
    async switchToYearly(input) {
      // D4: no `discounts` here, ever: the switch carries no coupon, the launch offer's included.
      const sub = await wrapped(() =>
        stripe.subscriptions.update(
          input.subscriptionId,
          {
            items: [{ id: input.itemId, price: input.yearlyPriceId }],
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
  };
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
