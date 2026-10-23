import Stripe from 'stripe';

/**
 * MUT-360 (ADR-165): the server's only door to Stripe. Read-only on billing objects (a restricted key), so the
 * webhook re-fetches state instead of trusting payloads, and reconcile lists it. Two instances run with different
 * budgets (D7): the webhook answers Stripe within seconds and lets Stripe's own retries retry; reconcile is patient.
 *
 * The API version is pinned: Stripe renders objects in it (`current_period_end` lives on subscription items since
 * 2025-03-31.basil), and the runbook sets the webhook endpoint to the same version. A test fails when an SDK upgrade
 * moves `Stripe.API_VERSION`, so the bump is a decision, not an accident.
 */
export const STRIPE_API_VERSION = '2026-09-30.endive';

/** A Stripe object and when we asked for it: the newer-read-wins guard compares request times, not response times. */
export interface Fetched<T> {
  value: T;
  fetchedAt: Date;
}

export interface StripeGateway {
  /** True for a live key: events whose `livemode` differs are ignored. */
  readonly livemode: boolean;
  /** Throws InvalidStripeSignature; Stripe's default 300 s tolerance refuses replays of old deliveries. */
  verifyEvent(raw: string, signature: string): Stripe.Event;
  /** With its prices' products and its customer expanded. */
  subscription(id: string): Promise<Fetched<Stripe.Subscription>>;
  customer(id: string): Promise<Fetched<Stripe.Customer | Stripe.DeletedCustomer>>;
  /** Every subscription (`status: 'all'`), 100 a page, customers expanded; each page carries its own request time. */
  listSubscriptions(): AsyncIterable<Fetched<Stripe.Subscription>>;
  /** Every product by id, archived ones too (an old subscription can still point at one). */
  listProducts(): Promise<Map<string, Stripe.Product>>;
}

export class InvalidStripeSignature extends Error {
  constructor() {
    super('Invalid Stripe-Signature');
    this.name = 'InvalidStripeSignature';
  }
}

/**
 * Every SDK failure, reduced to what is safe to log (AC5): never the SDK's error object, which carries the request.
 * `transient`: a retry may succeed (network, timeout, rate limit, Stripe 5xx), so the webhook answers 500.
 */
export class StripeGatewayError extends Error {
  readonly code: string | null;
  readonly type: string;
  readonly requestId: string | null;
  readonly transient: boolean;
  /** The request parameter Stripe blamed (`customer` on a deleted customer), when it named one. */
  readonly param: string | null;

  constructor(fields: { code: string | null; type: string; requestId: string | null; transient: boolean; param?: string | null }) {
    super(`Stripe ${fields.type}${fields.code ? ` (${fields.code})` : ''}`);
    this.name = 'StripeGatewayError';
    this.code = fields.code;
    this.type = fields.type;
    this.requestId = fields.requestId;
    this.transient = fields.transient;
    this.param = fields.param ?? null;
  }
}

export interface StripeGatewayOptions {
  secretKey: string;
  webhookSecret: string;
  timeoutMs: number;
  maxNetworkRetries: number;
  now: () => Date;
  /** Tests pass `Stripe.createFetchHttpClient(fakeFetch)`; production uses the SDK's default client. */
  httpClient?: Stripe.HttpClient;
}

/** D7: the webhook's budget (≈8 s worst case, Stripe retries the event) and reconcile's. */
export const WEBHOOK_BUDGET = { timeoutMs: 4_000, maxNetworkRetries: 0 } as const;
export const RECONCILE_BUDGET = { timeoutMs: 10_000, maxNetworkRetries: 2 } as const;

const PAGE = 100;

export function createStripeGateway(options: StripeGatewayOptions): StripeGateway {
  const stripe = new Stripe(options.secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    timeout: options.timeoutMs,
    maxNetworkRetries: options.maxNetworkRetries,
    telemetry: false,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
  const fetched = async <T>(call: () => Promise<T>): Promise<Fetched<T>> => {
    const fetchedAt = options.now();
    return { value: await wrapped(call), fetchedAt };
  };

  return {
    livemode: /^(rk|sk)_live_/.test(options.secretKey),
    verifyEvent(raw, signature) {
      try {
        return stripe.webhooks.constructEvent(raw, signature, options.webhookSecret);
      } catch {
        throw new InvalidStripeSignature();
      }
    },
    subscription: (id) => fetched(() => stripe.subscriptions.retrieve(id, { expand: ['items.data.price.product', 'customer'] })),
    customer: (id) => fetched(() => stripe.customers.retrieve(id)),
    async *listSubscriptions() {
      let startingAfter: string | undefined;
      for (;;) {
        const page = await fetched(() =>
          stripe.subscriptions.list({ status: 'all', limit: PAGE, expand: ['data.customer'], ...(startingAfter ? { starting_after: startingAfter } : {}) }),
        );
        for (const sub of page.value.data) yield { value: sub, fetchedAt: page.fetchedAt };
        const last = page.value.data.at(-1);
        if (!page.value.has_more || !last) return;
        startingAfter = last.id;
      }
    },
    async listProducts() {
      const products = new Map<string, Stripe.Product>();
      await wrapped(async () => {
        for await (const product of stripe.products.list({ limit: PAGE })) products.set(product.id, product);
      });
      return products;
    },
  };
}

async function wrapped<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw toGatewayError(err);
  }
}

// Auth and permission failures count as transient: a revoked or under-scoped key is fixable, and answering Stripe
// 200 would drop the event for good (MUT-360 review). A 500 makes Stripe redeliver after the key is fixed.
const TRANSIENT_TYPES = new Set(['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError', 'RateLimitError', 'StripeAuthenticationError', 'StripePermissionError']);

export function toGatewayError(err: unknown): StripeGatewayError {
  if (err instanceof Stripe.errors.StripeError) {
    const status = err.statusCode ?? 0;
    return new StripeGatewayError({
      code: err.code ?? null,
      type: err.type,
      requestId: err.requestId ?? null,
      param: err.param ?? null,
      transient: TRANSIENT_TYPES.has(err.type) || status === 401 || status === 403 || status === 429 || status >= 500,
    });
  }
  // Not an SDK error (an abort, a bug in a fake): treat as transient, keep nothing from it.
  return new StripeGatewayError({ code: null, type: 'UnknownError', requestId: null, transient: true });
}
