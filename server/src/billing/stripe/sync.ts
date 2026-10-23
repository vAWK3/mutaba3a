import type Stripe from 'stripe';
import type { Logger } from '../../logger.js';
import { ownedProfilesOf, profileOwnerOf } from '../../personal-profile.js';
import type { AuditEventInput, BillingSyncSource, LedgerStore, SaveBillingAccountConflict, SaveBillingSubscriptionOutcome } from '../../repositories/ports.js';
import { BUSINESS_TAX_NUMBER_KEY } from '../checkout.js';
import type { CheckoutGateway } from './checkout-gateway.js';
import { StripeGatewayError, type Fetched, type StripeGateway } from './gateway.js';
import { customerIdOf, mirrorOf, stateOf, subscriptionIdOfInvoice, type MirrorError, type MirrorNote } from './mirror.js';

/**
 * MUT-360 (§2.3, ADR-165): Stripe → billing_accounts / billing_subscriptions. One path, `syncSubscription`, serves
 * the webhook (which re-fetches the subscription its event names) and the nightly reconcile (which lists them all),
 * and it is the only Stripe-event path that creates a billing account (D6; the operator's `billing link` can create one
 * too). The store is the unguarded one (ADR-162 decision 6).
 */

/** The events the webhook endpoint subscribes to. Pilot runbook §1.7 step 4 copies this list (a test pins it): change both. */
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
export type SyncCode = MirrorError | MirrorNote | SaveBillingAccountConflict | 'CUSTOMER_DELETED' | 'ORG_NOT_OWNED_BY_PAYER' | `STRIPE_${string}`;

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
  /** `skipped`: nothing to write (a deleted customer we never mirrored). */
  outcome: SaveBillingSubscriptionOutcome | 'error' | 'skipped';
  codes: SyncCode[];
  /** A mapping error: the event stays unprocessed (a resend after the fix is handled again), even if status was kept. */
  blocked: boolean;
  /** No profile reached yet (no linked payer, no organization the rule lets it cover): the operator still has to act. */
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
  /** MUT-362 review D3: the write door, to print a Checkout business tax number on the customer's invoices. */
  invoiceTaxNumbers?: Pick<CheckoutGateway, 'setInvoiceTaxNumber'>;
  logger: Logger;
  now: () => Date;
  /** Defaults to RECONCILE_TIME_BUDGET_MS; tests pass a small one. */
  reconcileTimeBudgetMs?: number;
}

export interface StripeSync {
  handleEvent(event: Stripe.Event, requestId: string | null): Promise<HandleResult>;
  syncSubscription(input: SyncInput, context: SyncContext): Promise<SyncResult>;
  reconcile(requestId: string | null): Promise<ReconcileSummary>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const NO_PRODUCTS: ReadonlyMap<string, Stripe.Product> = new Map();
/**
 * From the start of the run, products included, with room under the Scheduler's 280 s attempt deadline and Cloud Run's
 * 300 s request timeout for one more page fetch (10 s, two retries) after the last check (MUT-360 review).
 */
export const RECONCILE_TIME_BUDGET_MS = 200_000;
/** An expected state, not something for the operator: a deleted customer's subscriptions end on their own. */
const needsOperator = (code: string) => code !== 'CUSTOMER_DELETED';

export function createStripeSync(deps: StripeSyncDependencies): StripeSync {
  const { store, logger, now } = deps;
  const budgetMs = deps.reconcileTimeBudgetMs ?? RECONCILE_TIME_BUDGET_MS;
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

  /**
   * The profiles a subscription reaches, for its audit: the payer's own, plus its organization where the read-time rule
   * (D8/D9) lets it cover, never a stranger's profile. Codes an organization id that names nothing, or one the payer
   * doesn't own (stored as typed, it covers nothing until they do).
   */
  async function reachedProfiles(payer: string | null, organizationId: string | null, codes: SyncCode[], knownPayerProfiles: string[] | null) {
    const payerProfiles = payer === null ? [] : (knownPayerProfiles ?? (await ownedProfilesOf(store, payer)).map((p) => p.id));
    const profileIds = [...payerProfiles];
    if (organizationId === null) return { profileIds, organizationId };
    const organization = await store.organizations.getById(organizationId);
    if (!organization) {
      codes.push('UNKNOWN_ORG');
      return { profileIds, organizationId: null };
    }
    if (profileOwnerOf(organization) === null || payerProfiles.includes(organizationId)) profileIds.push(organizationId);
    // With no linked payer yet, linking is the fix (it shows as unlinked), not the metadata.
    else if (payer !== null) codes.push('ORG_NOT_OWNED_BY_PAYER');
    return { profileIds, organizationId };
  }

  /**
   * A subscription we can't map any more (its product lost the tier tag, say) still reports what Stripe says about
   * it: status and cancel-at-period-end, on the tier, organization and period already stored. A cancellation is never
   * frozen out, and a still-active one stops covering 7 days after the stored period. Nothing to keep when we never
   * mirrored it.
   */
  async function keepStatus(sub: Stripe.Subscription, stripeCustomerId: string, fetchedAt: Date, context: SyncContext): Promise<Omit<SyncResult, 'codes' | 'blocked'>> {
    const stored = await store.billing.getSubscription(sub.id);
    if (!stored) return { subscriptionId: sub.id, outcome: 'error', reachesNobody: true };
    const state = stateOf(sub);
    const payer = (await store.billing.getAccount(stripeCustomerId))?.userId ?? null;
    const { profileIds } = await reachedProfiles(payer, stored.organizationId, [], null);
    const { outcome } = await store.billing.saveSubscription({
      stripeCustomerId,
      stripeSubscriptionId: sub.id,
      tier: stored.tier,
      organizationId: stored.organizationId,
      status: state.status,
      // The stored period, not Stripe's renewed one: a subscription we can't map then reads as a lapse 7 days after it,
      // unless someone fixes the product (entitlement.ts PERIOD_GRACE_DAYS). Status and cancel still go through.
      currentPeriodEnd: stored.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      priceLookupKey: stored.priceLookupKey,
      founderUntil: stored.founderUntil,
      stripeUpdatedAt: fetchedAt,
      at: now(),
      audit: { profileIds, source: context.source, eventId: context.eventId, requestId: context.requestId },
    });
    return { subscriptionId: sub.id, outcome, reachesNobody: profileIds.length === 0 };
  }

  async function syncSubscription(input: SyncInput, context: SyncContext): Promise<SyncResult> {
    // D7: the webhook path keeps the webhook's budget; reconcile's own fallback reads stay on reconcile's.
    const gateway = 'id' in input ? deps.webhookGateway : deps.reconcileGateway;
    const { value: sub, fetchedAt } = 'id' in input ? await gateway.subscription(input.id) : input.subscription;
    const products = 'id' in input ? NO_PRODUCTS : input.products;
    const codes: SyncCode[] = [];
    const fetched = typeof sub.customer === 'string' ? (await gateway.customer(sub.customer)).value : sub.customer;
    // Deleting a customer cancels its subscriptions: still mirror them, just without the customer's details or link.
    const customer = 'deleted' in fetched && fetched.deleted ? null : (fetched as Stripe.Customer);
    const stripeCustomerId = fetched.id;
    if (!customer) codes.push('CUSTOMER_DELETED');

    // A deleted customer we never mirrored has nothing to end: don't create an account that would only sit unlinked.
    if (!customer && !(await store.billing.getAccount(stripeCustomerId))) return { subscriptionId: sub.id, outcome: 'skipped', codes, reachesNobody: true, blocked: false };

    const mirror = mirrorOf(sub, products);
    if ('error' in mirror) return { ...(await keepStatus(sub, stripeCustomerId, fetchedAt, context)), codes: [...codes, mirror.error], blocked: true };
    codes.push(...mirror.notes);

    const candidate = customer ? (context.linkHint ?? customer.metadata?.['mutaba3a_user_id'] ?? null) : null;
    const linking = await linkAudit(candidate, stripeCustomerId, context.requestId);
    const saved = await store.billing.saveAccount({
      stripeCustomerId,
      userId: candidate,
      country: customer?.address?.country ?? null,
      currency: mirror.ok.currency,
      at: now(),
      linkAudit: linking.rows,
    });
    if (saved.conflict) codes.push(saved.conflict);

    const payer = saved.account.userId;
    const { profileIds, organizationId } = await reachedProfiles(payer, mirror.ok.organizationId, codes, payer === candidate ? linking.profileIds : null);
    const { currency: _currency, ...fields } = mirror.ok;
    void _currency; // the account's, saved above
    const { outcome } = await store.billing.saveSubscription({
      ...fields,
      organizationId,
      stripeCustomerId,
      stripeSubscriptionId: sub.id,
      stripeUpdatedAt: fetchedAt,
      at: now(),
      audit: { profileIds, source: context.source, eventId: context.eventId, requestId: context.requestId },
    });
    return { subscriptionId: sub.id, outcome, codes, reachesNobody: profileIds.length === 0, blocked: false };
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
      currency: null,
      at: now(),
      linkAudit: linking.rows,
    });
    return { result: 'processed', codes: saved.conflict ? [saved.conflict] : [] };
  }

  /**
   * MUT-362 review D3: a business tax number typed on Checkout lives only on the session; copy it to the customer's
   * invoice fields so it prints on every invoice. A failed write is an error, so Stripe redelivers and it's tried again.
   */
  async function copyTaxNumber(session: Stripe.Checkout.Session, synced: { result: 'noop' | 'processed' | 'error'; codes: SyncCode[] }) {
    const value = session.custom_fields?.find((f) => f.key === BUSINESS_TAX_NUMBER_KEY)?.text?.value?.trim();
    const customer = session.customer ? customerIdOf(session.customer) : null;
    if (!value || !customer || !deps.invoiceTaxNumbers) return synced;
    try {
      await deps.invoiceTaxNumbers.setInvoiceTaxNumber(customer, value);
      return synced;
    } catch (err) {
      if (!(err instanceof StripeGatewayError)) throw err;
      deps.logger.warn({ stripeCustomerId: customer, code: err.code, stripeRequestId: err.requestId }, 'Checkout tax number not copied to the customer; Stripe will redeliver');
      return { result: 'error' as const, codes: [...synced.codes, 'STRIPE_TAX_NUMBER_NOT_SAVED' as const] };
    }
  }

  async function dispatch(event: Stripe.Event, requestId: string | null): Promise<{ result: 'noop' | 'processed' | 'error'; codes: SyncCode[] }> {
    const context = (linkHint: string | null): SyncContext => ({ linkHint, source: 'webhook', eventId: event.id, requestId });
    const sync = async (id: string, linkHint: string | null = null) => {
      const r = await syncSubscription({ id }, context(linkHint));
      return { result: r.blocked || r.outcome === 'error' ? ('error' as const) : r.outcome === 'skipped' ? ('noop' as const) : ('processed' as const), codes: r.codes };
    };
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription' || !session.subscription) return { result: 'noop', codes: [] };
        const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
        // A Payment Link takes client_reference_id from its URL: anyone could name anyone. Only a session the server
        // created (MUT-362) may link by it; otherwise the customer's metadata decides.
        const synced = await sync(id, session.payment_link ? null : (session.client_reference_id ?? null));
        return synced.result === 'error' ? synced : copyTaxNumber(session, synced);
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
      if (codes.some(needsOperator)) logger.warn({ eventId: event.id, type: event.type, codes, requestId }, 'stripe sync needs the operator');
      // Stripe won't redeliver a 200. A code that blocked the mirror leaves the event unprocessed, so a dashboard resend
      // after the fix is handled again; the nightly reconcile retries the subscription either way.
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
        const started = now().getTime();
        const products = await deps.reconcileGateway.listProducts();
        for await (const listed of deps.reconcileGateway.listSubscriptions()) {
          // Stop inside the Scheduler's deadline, never outlive the request (Cloud Run's 300 s) and block later runs.
          if (now().getTime() - started >= budgetMs) {
            summary.errors.push({ subscriptionId: null, code: 'TIME_BUDGET' });
            break;
          }
          summary.checked += 1;
          try {
            const r = await syncSubscription({ subscription: listed, products }, { linkHint: null, source: 'reconcile', eventId: null, requestId });
            if (r.outcome === 'created' || r.outcome === 'changed') summary.changed += 1;
            if (!r.blocked && r.outcome !== 'error' && r.outcome !== 'skipped' && r.reachesNobody) summary.unlinked += 1;
            for (const code of r.codes.filter(needsOperator)) summary.errors.push({ subscriptionId: r.subscriptionId, code });
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
