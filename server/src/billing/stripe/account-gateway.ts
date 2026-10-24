import Stripe from 'stripe';
import type { LiveSubscription } from '../../accounts/closure.js';
import { STRIPE_API_VERSION, StripeGatewayError, toGatewayError } from './gateway.js';

/**
 * MUT-333 (ADR-188, D1, R5–R7): what closing an account asks of Stripe, apart from MUT-362's checkout door so each
 * port's contract stays as reviewed. Built from the same restricted key, which gains Write on Subscriptions (D14).
 *
 *   close:   customersOf → expireOpenCheckouts → liveSubscriptionsOf → setCancelAtPeriodEnd / cancelNow
 *   keep:    setCancelAtPeriodEnd(id, false) for the ones close ended
 *   purge:   customersOf → deleteCustomer (a customer Stripe no longer has is already deleted)
 */
export interface AccountStripeGateway {
  /** R5: every customer that names this person in its metadata, found by their email (never another person's). */
  customersOf(person: { userId: string; email: string }): Promise<string[]>;
  /** R6: the customer's subscriptions as Stripe holds them now, not as the mirror last saw them. */
  liveSubscriptionsOf(customer: string): Promise<LiveSubscription[]>;
  setCancelAtPeriodEnd(subscriptionId: string, value: boolean): Promise<void>;
  /** R7: ends a past-due or unpaid subscription at once, so Stripe stops retrying its invoice. */
  cancelNow(subscriptionId: string): Promise<void>;
  /** R5: no checkout left open can be paid while the account is closing. */
  expireOpenCheckouts(customer: string): Promise<number>;
  /** Deleting a customer ends its subscriptions at once; one Stripe no longer has counts as deleted. */
  deleteCustomer(customer: string): Promise<void>;
}

export interface AccountStripeGatewayOptions {
  secretKey: string;
  timeoutMs: number;
  maxNetworkRetries: number;
  httpClient?: Stripe.HttpClient;
}

const PAGE = 100;
const OPEN_SESSIONS_PAGE = 10;

export function createAccountStripeGateway(options: AccountStripeGatewayOptions): AccountStripeGateway {
  const stripe = new Stripe(options.secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    timeout: options.timeoutMs,
    maxNetworkRetries: options.maxNetworkRetries,
    telemetry: false,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });

  return {
    async customersOf({ userId, email }) {
      // List, not Search: Search is eventually consistent (MUT-362's finding), List by email is exact.
      const listed = await wrapped(() => stripe.customers.list({ email, limit: PAGE }));
      return listed.data.filter((c) => c.metadata?.['mutaba3a_user_id'] === userId).map((c) => c.id);
    },
    async liveSubscriptionsOf(customer) {
      const page = await wrapped(() => stripe.subscriptions.list({ customer, status: 'all', limit: PAGE }));
      return page.data.map((sub) => ({
        id: sub.id,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        cancelAt: typeof sub.cancel_at === 'number' ? new Date(sub.cancel_at * 1000) : null,
      }));
    },
    async setCancelAtPeriodEnd(subscriptionId, value) {
      await wrapped(() => stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: value }));
    },
    async cancelNow(subscriptionId) {
      try {
        await wrapped(() => stripe.subscriptions.cancel(subscriptionId));
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    },
    async expireOpenCheckouts(customer) {
      const page = await wrapped(() => stripe.checkout.sessions.list({ customer, status: 'open', limit: OPEN_SESSIONS_PAGE }));
      for (const session of page.data) await wrapped(() => stripe.checkout.sessions.expire(session.id));
      return page.data.length;
    },
    async deleteCustomer(customer) {
      try {
        await wrapped(() => stripe.customers.del(customer));
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    },
  };
}

/** Stripe's answer for an object it doesn't have (already deleted, or deleted by the dashboard). */
function isMissing(err: unknown): boolean {
  return err instanceof StripeGatewayError && err.code === 'resource_missing';
}

async function wrapped<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw toGatewayError(err);
  }
}
