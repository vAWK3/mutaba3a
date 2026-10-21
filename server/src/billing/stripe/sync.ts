import type Stripe from 'stripe';
import type { Logger } from '../../logger.js';
import { ownedProfilesOf, profileOwnerOf } from '../../personal-profile.js';
import type { AuditEventInput, BillingSyncSource, LedgerStore, SaveBillingAccountConflict, SaveBillingSubscriptionOutcome } from '../../repositories/ports.js';
import { StripeGatewayError, type Fetched, type StripeGateway } from './gateway.js';
import { customerIdOf, mirrorOf, subscriptionIdOfInvoice, type MirrorError, type MirrorNote } from './mirror.js';

/**
 * MUT-360 (§2.3, ADR-165): Stripe → billing_accounts / billing_subscriptions. One path, `syncSubscription`, serves
 * the webhook (which re-fetches the subscription its event names) and the nightly reconcile (which lists them all),
 * and it is the only place a billing account is created (D6). The store is the unguarded one (ADR-162 decision 6).
 */

/** The events the webhook endpoint subscribes to; the runbook lists these, so it can't drift from the handler. */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.updated',
] as const;
const HANDLED = new Set<string>(HANDLED_EVENT_TYPES);

/** Why a subscription, customer or event needs the operator: recorded on the event, logged, returned by reconcile. */
export type SyncCode = MirrorError | MirrorNote | SaveBillingAccountConflict | 'CUSTOMER_DELETED' | `STRIPE_${string}`;

export interface SyncContext {
  /** The person a checkout names (`client_reference_id`); otherwise the customer's `mutaba3a_user_id` metadata. */
  linkHint: string | null;
  source: BillingSyncSource;
  eventId: string | null;
  requestId: string | null;
}

/** Re-fetch by id (the webhook), or a subscription reconcile already listed, with the products the list can't expand. */
export type SyncInput = { id: string } | { subscription: Fetched<Stripe.Subscription>; products: ReadonlyMap<string, Stripe.Product> };

export interface SyncResult {
  subscriptionId: string;
  outcome: SaveBillingSubscriptionOutcome | 'error' | 'skipped';
  codes: SyncCode[];
  /** Neither a linked payer nor an organization: the mirror covers nobody until the operator links the customer. */
  reachesNobody: boolean;
}

/** A type, not an interface: Hono's typed JSON responses need the implicit index signature only type aliases have. */
export type ReconcileSummary = {
  checked: number;
  changed: number;
  unlinked: number;
  errors: { subscriptionId: string | null; code: string }[];
  pruned: number;
};

export type HandleResult = { status: 200 | 500; result: 'ignored' | 'duplicate' | 'noop' | 'processed' | 'error'; codes: SyncCode[] };

/** A second reconcile while one runs (the Scheduler retrying, or the operator) is refused, not queued. */
export class ReconcileRunning extends Error {
  constructor() {
    super('A Stripe reconcile is already running');
    this.name = 'ReconcileRunning';
  }
}

export interface StripeSyncDependencies {
  store: LedgerStore;
  /** D7: answers Stripe fast (4 s, no SDK retry); Stripe redelivers. */
  webhookGateway: StripeGateway;
  /** D7: patient (10 s, two retries). */
  reconcileGateway: StripeGateway;
  logger: Logger;
  now: () => Date;
}

export interface StripeSync {
  handleEvent(event: Stripe.Event, requestId: string | null): Promise<HandleResult>;
  syncSubscription(input: SyncInput, context: SyncContext): Promise<SyncResult>;
  reconcile(requestId: string | null): Promise<ReconcileSummary>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const NO_PRODUCTS: ReadonlyMap<string, Stripe.Product> = new Map();

export function createStripeSync(deps: StripeSyncDependencies): StripeSync {
  const { store, logger, now } = deps;
  let reconciling = false;

  /** `billing.account_linked` on each profile the person owns, as the admin link writes it, with a SYSTEM actor. */
  async function linkAudit(userId: string | null, stripeCustomerId: string, requestId: string | null): Promise<{ rows: AuditEventInput[]; profileIds: string[] }> {
    if (userId === null || !UUID_RE.test(userId)) return { rows: [], profileIds: [] };
    const profiles = await ownedProfilesOf(store, userId);
    const rows = profiles.map((p) => ({
      organizationId: p.id,
      actorType: 'SYSTEM' as const,
      actorId: null,
      action: 'billing.account_linked',
      entityType: 'user',
      entityId: userId,
      metadata: { stripeCustomerId, userId, source: 'stripe' },
      requestId,
    }));
    return { rows, profileIds: profiles.map((p) => p.id) };
  }

  async function syncSubscription(input: SyncInput, context: SyncContext): Promise<SyncResult> {
    const { value: sub, fetchedAt } = 'id' in input ? await deps.webhookGateway.subscription(input.id) : input.subscription;
    const products = 'id' in input ? NO_PRODUCTS : input.products;
    const codes: SyncCode[] = [];
    const customer = typeof sub.customer === 'string' ? (await deps.webhookGateway.customer(sub.customer)).value : sub.customer;
    if ('deleted' in customer && customer.deleted) return { subscriptionId: sub.id, outcome: 'skipped', codes: ['CUSTOMER_DELETED'], reachesNobody: true };

    const mirror = mirrorOf(sub, products);
    if ('error' in mirror) return { subscriptionId: sub.id, outcome: 'error', codes: [mirror.error], reachesNobody: true };
    codes.push(...mirror.notes);

    const candidate = context.linkHint ?? customer.metadata?.['mutaba3a_user_id'] ?? null;
    const linking = await linkAudit(candidate, customer.id, context.requestId);
    const saved = await store.billing.saveAccount({
      stripeCustomerId: customer.id,
      userId: candidate,
      country: customer.address?.country ?? null,
      currency: mirror.ok.currency,
      at: now(),
      linkAudit: linking.rows,
    });
    if (saved.conflict) codes.push(saved.conflict);

    const payer = saved.account.userId;
    const payerProfiles = payer === null ? [] : payer === candidate ? linking.profileIds : (await ownedProfilesOf(store, payer)).map((p) => p.id);
    let organizationId = mirror.ok.organizationId;
    const profileIds = [...payerProfiles];
    if (organizationId !== null) {
      const organization = await store.organizations.getById(organizationId);
      if (!organization) {
        codes.push('UNKNOWN_ORG');
        organizationId = null;
      } else if (profileOwnerOf(organization) === null || payerProfiles.includes(organizationId)) {
        // Audit only where the read-time rule (D8/D9) lets the subscription cover: never on a stranger's profile.
        profileIds.push(organizationId);
      }
    }

    const { currency: _currency, ...fields } = mirror.ok;
    void _currency; // the account's, saved above
    const { outcome } = await store.billing.saveSubscription({
      ...fields,
      organizationId,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: sub.id,
      stripeUpdatedAt: fetchedAt,
      at: now(),
      audit: { profileIds, source: context.source, eventId: context.eventId, requestId: context.requestId },
    });
    return { subscriptionId: sub.id, outcome, codes, reachesNobody: payer === null && organizationId === null };
  }

  /** customer.updated: country and metadata link on an account the sync already made; never creates one (D6). */
  async function refreshCustomer(customerId: string, requestId: string | null): Promise<{ result: 'noop' | 'processed'; codes: SyncCode[] }> {
    const existing = await store.billing.getAccount(customerId);
    if (!existing) return { result: 'noop', codes: [] };
    const { value: customer } = await deps.webhookGateway.customer(customerId);
    if ('deleted' in customer && customer.deleted) return { result: 'noop', codes: ['CUSTOMER_DELETED'] };
    const candidate = customer.metadata?.['mutaba3a_user_id'] ?? null;
    const linking = await linkAudit(candidate, customerId, requestId);
    const saved = await store.billing.saveAccount({
      stripeCustomerId: customerId,
      userId: candidate,
      country: customer.address?.country ?? null,
      currency: existing.currency,
      at: now(),
      linkAudit: linking.rows,
    });
    return { result: 'processed', codes: saved.conflict ? [saved.conflict] : [] };
  }

  async function dispatch(event: Stripe.Event, requestId: string | null): Promise<{ result: 'noop' | 'processed' | 'error'; codes: SyncCode[] }> {
    const context = (linkHint: string | null): SyncContext => ({ linkHint, source: 'webhook', eventId: event.id, requestId });
    const sync = async (id: string, linkHint: string | null = null) => {
      const r = await syncSubscription({ id }, context(linkHint));
      return { result: r.outcome === 'error' ? ('error' as const) : r.outcome === 'skipped' ? ('noop' as const) : ('processed' as const), codes: r.codes };
    };
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription' || !session.subscription) return { result: 'noop', codes: [] };
        const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
        return sync(id, session.client_reference_id ?? null);
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const id = subscriptionIdOfInvoice(event.data.object);
        return id ? sync(id) : { result: 'noop', codes: [] };
      }
      case 'customer.updated':
        return refreshCustomer(customerIdOf(event.data.object), requestId);
      default:
        // customer.subscription.created|updated|deleted|paused|resumed
        return sync((event.data.object as Stripe.Subscription).id);
    }
  }

  async function handleEvent(event: Stripe.Event, requestId: string | null): Promise<HandleResult> {
    if (!HANDLED.has(event.type)) return { status: 200, result: 'ignored', codes: [] };
    if (event.livemode !== deps.webhookGateway.livemode) {
      logger.warn({ eventId: event.id, livemode: event.livemode, requestId }, 'stripe event from the other mode ignored');
      return { status: 200, result: 'ignored', codes: [] };
    }
    if ((await store.billing.beginStripeEvent({ id: event.id, type: event.type, at: now() })).alreadyProcessed) {
      return { status: 200, result: 'duplicate', codes: [] };
    }
    try {
      const { result, codes } = await dispatch(event, requestId);
      if (codes.length > 0) logger.warn({ eventId: event.id, type: event.type, codes, requestId }, 'stripe sync needs the operator');
      // A code that blocked the mirror leaves the event unprocessed, so a redelivery after the fix is handled again.
      await store.billing.finishStripeEvent(event.id, result === 'error' ? { error: codes.join(',') } : { processedAt: now() });
      return { status: 200, result, codes };
    } catch (err) {
      const failure = err instanceof StripeGatewayError ? err : null;
      if (failure && !failure.transient) {
        const code = `STRIPE_${failure.code ?? failure.type}` as const;
        logger.warn({ eventId: event.id, type: event.type, stripe: { code: failure.code, type: failure.type, requestId: failure.requestId }, requestId }, 'stripe refused a re-fetch');
        await store.billing.finishStripeEvent(event.id, { error: code });
        return { status: 200, result: 'error', codes: [code] };
      }
      logger.error(
        { eventId: event.id, type: event.type, ...(failure ? { stripe: { code: failure.code, type: failure.type, requestId: failure.requestId } } : { err }), requestId },
        'stripe event failed; Stripe will redeliver',
      );
      await store.billing.finishStripeEvent(event.id, { error: 'TRANSIENT' }).catch(() => undefined);
      return { status: 500, result: 'error', codes: [] };
    }
  }

  async function reconcile(requestId: string | null): Promise<ReconcileSummary> {
    if (reconciling) throw new ReconcileRunning();
    reconciling = true;
    const summary: ReconcileSummary = { checked: 0, changed: 0, unlinked: 0, errors: [], pruned: 0 };
    try {
      try {
        const products = await deps.reconcileGateway.listProducts();
        for await (const listed of deps.reconcileGateway.listSubscriptions()) {
          summary.checked += 1;
          try {
            const r = await syncSubscription({ subscription: listed, products }, { linkHint: null, source: 'reconcile', eventId: null, requestId });
            if (r.outcome === 'created' || r.outcome === 'changed') summary.changed += 1;
            if (r.outcome !== 'error' && r.outcome !== 'skipped' && r.reachesNobody) summary.unlinked += 1;
            for (const code of r.codes) summary.errors.push({ subscriptionId: r.subscriptionId, code });
          } catch (err) {
            summary.errors.push({ subscriptionId: listed.value.id, code: err instanceof StripeGatewayError ? `STRIPE_${err.code ?? err.type}` : 'FAILED' });
            if (!(err instanceof StripeGatewayError)) logger.error({ err, stripeSubscriptionId: listed.value.id, requestId }, 'stripe reconcile failed one subscription');
          }
        }
      } catch (err) {
        summary.errors.push({ subscriptionId: null, code: 'LIST_FAILED' });
        logger.error(err instanceof StripeGatewayError ? { stripe: { code: err.code, type: err.type, requestId: err.requestId }, requestId } : { err, requestId }, 'stripe reconcile could not list');
      }
      summary.pruned = await store.billing.pruneStripeEvents(new Date(now().getTime() - EVENT_RETENTION_MS));
      logger.info({ ...summary, errors: summary.errors.length, requestId }, 'stripe reconcile finished');
      for (const e of summary.errors) logger.warn({ ...e, requestId }, 'stripe reconcile needs the operator');
      return summary;
    } finally {
      reconciling = false;
    }
  }

  return { handleEvent, syncSubscription, reconcile };
}
