import { profileStoragePrefix } from '../attachments/rules.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import type { AccountStripeGateway } from '../billing/stripe/account-gateway.js';
import type { Logger } from '../logger.js';
import type { LedgerStore, UserRecord } from '../repositories/ports.js';

/**
 * MUT-333 (ADR-188, D11, D12 as revised by R1): the hard delete of closed accounts, run hourly by Cloud Scheduler and
 * on demand by the operator (`npm run accounts:purge [-- --dry-run]`). One person at a time:
 *
 *   claim (user-row lock; no cancel can win after it)
 *     └─► Stripe: delete every customer naming the person (a failure skips them until the next run)
 *           └─► one transaction: transfer, anonymize, scrub, delete, queue the deleted profiles' bucket prefixes
 *                 └─► empty those prefixes (the queue also drains at the start of every run, so a crash loses nothing)
 *
 * A dry run claims nothing and writes nothing: it reports what would happen now. One person's failure never stops the
 * run; the run stops itself at its time budget or its per-run cap (`incomplete`), and the next run continues.
 */
export const PURGE_BUDGET_MS = 200_000;
/** D11: at most this many accounts a run, so a defect can't empty the base in one go. */
export const MAX_PURGES_PER_RUN = 25;
const STORAGE_DRAIN_LIMIT = 100;

export type PurgeRowOutcome = 'purged' | 'would-purge' | 'skipped' | 'failed';
export type PurgeSkipReason = 'stripe-failed' | 'stripe-unavailable' | 'not-due' | 'error';

export interface PurgeRunRow {
  userId: string;
  outcome: PurgeRowOutcome;
  reason: PurgeSkipReason | null;
  deleteProfileIds: string[];
  transfers: Array<{ organizationId: string; toUserId: string }>;
  leaveProfileIds: string[];
  stripeCustomers: number;
}

export interface PurgeRunSummary {
  dryRun: boolean;
  closing: number;
  due: number;
  purged: number;
  skipped: number;
  failed: number;
  storagePrefixesEmptied: number;
  storagePending: number;
  incomplete: boolean;
}

export interface PurgeRunOptions {
  store: LedgerStore;
  stripe: AccountStripeGateway | null;
  storage: AttachmentStorage | null;
  logger: Logger;
  now: Date;
  dryRun: boolean;
  budgetMs?: number;
  maxPeople?: number;
  /** The run's own stopwatch (tests pass a fake). */
  elapsedMs?: () => number;
}

const NEEDS_OPERATOR = 'account purge needs the operator';

export async function runAccountPurge(options: PurgeRunOptions): Promise<{ summary: PurgeRunSummary; rows: PurgeRunRow[] }> {
  const { store, logger, now, dryRun } = options;
  const started = Date.now();
  const elapsed = options.elapsedMs ?? (() => Date.now() - started);
  const budget = options.budgetMs ?? PURGE_BUDGET_MS;
  const max = options.maxPeople ?? MAX_PURGES_PER_RUN;

  const summary: PurgeRunSummary = { dryRun, closing: 0, due: 0, purged: 0, skipped: 0, failed: 0, storagePrefixesEmptied: 0, storagePending: 0, incomplete: false };
  if (!dryRun) summary.storagePrefixesEmptied += await drainStorage(options);

  const counts = await store.accountPurge.countClosing(now);
  summary.closing = counts.closing;
  summary.due = counts.due;
  const due = await store.accountPurge.listDue(now, max);
  summary.incomplete = counts.due > due.length;

  const rows: PurgeRunRow[] = [];
  for (const person of due) {
    if (elapsed() >= budget) {
      summary.incomplete = true;
      break;
    }
    const row = dryRun ? await planRow(options, person) : await purgeOne(options, person);
    rows.push(row);
    if (row.outcome === 'purged' || row.outcome === 'would-purge') summary.purged++;
    else if (row.outcome === 'skipped') summary.skipped++;
    else summary.failed++;
    if (!dryRun && row.outcome === 'purged') summary.storagePrefixesEmptied += await emptyPrefixes(options, row.deleteProfileIds);
  }
  summary.storagePending = (await store.accountPurge.listStoragePurges(STORAGE_DRAIN_LIMIT)).length;
  logger.info({ ...summary }, 'account purge run');
  return { summary, rows };
}

async function planRow({ store }: PurgeRunOptions, person: UserRecord): Promise<PurgeRunRow> {
  const plan = await store.accountPurge.planOf(person.id);
  if (!plan) return emptyRow(person.id, 'skipped', 'not-due');
  return { userId: person.id, outcome: 'would-purge', reason: null, deleteProfileIds: plan.deleteProfileIds, transfers: plan.transfers, leaveProfileIds: plan.leaveProfileIds, stripeCustomers: plan.stripeCustomerIds.length };
}

async function purgeOne(options: PurgeRunOptions, person: UserRecord): Promise<PurgeRunRow> {
  const { store, stripe, logger, now } = options;
  try {
    const claimed = await store.accountPurge.claim(person.id, now);
    if (!claimed) return emptyRow(person.id, 'skipped', 'not-due');

    const plan = await store.accountPurge.planOf(person.id);
    let customers = plan?.stripeCustomerIds ?? [];
    if (stripe) {
      try {
        customers = [...new Set([...customers, ...(await stripe.customersOf({ userId: claimed.id, email: claimed.email }))])];
        for (const customer of customers) await stripe.deleteCustomer(customer);
      } catch (err) {
        logger.error({ err, userId: person.id, reason: 'stripe-failed' }, NEEDS_OPERATOR);
        return emptyRow(person.id, 'skipped', 'stripe-failed');
      }
    } else if (customers.length > 0) {
      logger.error({ userId: person.id, reason: 'stripe-unavailable' }, NEEDS_OPERATOR);
      return emptyRow(person.id, 'skipped', 'stripe-unavailable');
    }

    const outcome = await store.accountPurge.purge(person.id, now);
    // Another run got there first: nothing left of the person to delete.
    if (!outcome) return emptyRow(person.id, 'skipped', 'not-due');
    logger.info({ userId: person.id, deleted: outcome.deleteProfileIds.length, transferred: outcome.transfers.length, left: outcome.leaveProfileIds.length }, 'account purged');
    return { userId: person.id, outcome: 'purged', reason: null, deleteProfileIds: outcome.deleteProfileIds, transfers: outcome.transfers, leaveProfileIds: outcome.leaveProfileIds, stripeCustomers: customers.length };
  } catch (err) {
    logger.error({ err, userId: person.id, reason: 'error' }, NEEDS_OPERATOR);
    return emptyRow(person.id, 'failed', 'error');
  }
}

/** R1: the queue left by an earlier run (or a crash between the commit and the bucket). */
async function drainStorage(options: PurgeRunOptions): Promise<number> {
  return emptyPrefixes(options, await options.store.accountPurge.listStoragePurges(STORAGE_DRAIN_LIMIT));
}

async function emptyPrefixes({ store, storage, logger }: PurgeRunOptions, organizationIds: readonly string[]): Promise<number> {
  if (organizationIds.length === 0) return 0;
  if (!storage) {
    logger.warn({ pending: organizationIds.length }, 'account purge: no attachments storage configured; bucket prefixes stay queued');
    return 0;
  }
  let emptied = 0;
  for (const organizationId of organizationIds) {
    try {
      await storage.removePrefix(profileStoragePrefix(organizationId));
      await store.accountPurge.finishStoragePurge(organizationId);
      emptied++;
    } catch (err) {
      logger.error({ err, organizationId, reason: 'storage' }, NEEDS_OPERATOR);
    }
  }
  return emptied;
}

function emptyRow(userId: string, outcome: PurgeRowOutcome, reason: PurgeSkipReason): PurgeRunRow {
  return { userId, outcome, reason, deleteProfileIds: [], transfers: [], leaveProfileIds: [], stripeCustomers: 0 };
}
