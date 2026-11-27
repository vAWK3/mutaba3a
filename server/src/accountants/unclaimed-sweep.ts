import { generateSetupToken, setupUrl } from '../auth/account-setup.js';
import { sessionDigest } from '../auth/sessions.js';
import { COVERING_STATUSES, profilePlanSubscriptions } from '../billing/entitlement.js';
import type { Mailer } from '../email/ports.js';
import type { Logger } from '../logger.js';
import type { AuditEventInput, LedgerStore, UnclaimedSweepRow, UserLocale } from '../repositories/ports.js';
import { PROVISION_LINK_TTL_MS } from '../routes/accountant-customers.js';
import { personalOrganizationIdOf } from './provision.js';

/**
 * MUT-767 (accountant channel, ADR-300; eng R1, T6): the daily sweep of accounts an accountant created that nobody has
 * claimed. Bounded, idempotent (a second run the same day sends and removes nothing more), on the unguarded store.
 *
 *   for each unclaimed account (oldest first, pages of `batch`):
 *     age >= 60 days, nothing covering it   ──► expireUnclaimed (closure with its grace over) ──► the hourly purge deletes
 *                                                it with its Stripe customers (accounts/purge-run.ts), never a bare delete
 *     age >= 60 days, a covering subscription ──► kept; counted `flagged` (Operator › provisioned accounts shows it)
 *     a reminder day reached and not yet sent ──► a fresh 14-day link to the customer, the SAME claim code (B17)
 *   then ONE digest per accountant (at most one a UTC day): how many wait, how many unpaid go within a week
 */
export const UNCLAIMED_POLICY = {
  /** Customer reminders, in whole days after creation (B18). Only the latest day reached is sent; missed earlier ones are skipped. */
  reminderDays: [3, 10, 30, 53],
  removeAfterDays: 60,
  /** The digest's "removed within a week". */
  removingSoonDays: 7,
  batch: 200,
  /** D11-style safety cap: at most this many accounts looked at per run; `incomplete` says the next run continues. */
  maxPerRun: 5000,
} as const;

const DAY_MS = 86_400_000;

export interface UnclaimedSweepSummary {
  looked: number;
  reminded: number;
  removed: number;
  /** Paid and still unclaimed past the 60 days: kept, for the operator to follow up. */
  flagged: number;
  digests: number;
  failed: number;
  incomplete: boolean;
}

export interface UnclaimedSweepOptions {
  store: LedgerStore;
  mailer: Mailer;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  pepper: string;
  /** Where links point (PORTAL_ORIGIN, else the request's origin). */
  origin: string;
  now: Date;
}

interface AccountantTally {
  waiting: number;
  removingSoon: number;
  remindedNow: boolean;
}

export async function runUnclaimedSweep(options: UnclaimedSweepOptions): Promise<UnclaimedSweepSummary> {
  const { store } = options;
  const summary: UnclaimedSweepSummary = { looked: 0, reminded: 0, removed: 0, flagged: 0, digests: 0, failed: 0, incomplete: false };
  const tallies = new Map<string, AccountantTally>();
  let after: { provisionedAt: Date; userId: string } | undefined;
  for (;;) {
    if (summary.looked >= UNCLAIMED_POLICY.maxPerRun) {
      summary.incomplete = true;
      break;
    }
    const rows = await store.provision.sweepRows({ limit: UNCLAIMED_POLICY.batch, after });
    if (rows.length === 0) break;
    const reminded = await store.provision.remindedStages(rows.map((r) => r.userId));
    for (const row of rows) {
      summary.looked += 1;
      try {
        await sweepOne(options, row, reminded.get(row.userId) ?? [], summary, tallies);
      } catch (err) {
        summary.failed += 1;
        options.logger.error({ err, userId: row.userId, event: 'unclaimed_sweep_failed' }, 'unclaimed account not swept');
      }
    }
    const last = rows[rows.length - 1]!;
    after = { provisionedAt: last.provisionedAt, userId: last.userId };
    if (rows.length < UNCLAIMED_POLICY.batch) break;
  }
  for (const [accountantUserId, tally] of tallies) {
    if (!tally.remindedNow && tally.removingSoon === 0) continue;
    if (await mailDigest(options, accountantUserId, tally)) summary.digests += 1;
  }
  if (summary.flagged > 0) options.logger.warn({ flagged: summary.flagged, event: 'unclaimed_paid_accounts' }, 'paid accounts still unclaimed after 60 days; follow up in Operator › provisioned accounts');
  return summary;
}

async function sweepOne(options: UnclaimedSweepOptions, row: UnclaimedSweepRow, sentDays: number[], summary: UnclaimedSweepSummary, tallies: Map<string, AccountantTally>): Promise<void> {
  const { store, now } = options;
  const ageDays = Math.floor((now.getTime() - row.provisionedAt.getTime()) / DAY_MS);
  const paid = profilePlanSubscriptions((await store.billing.summaryOf(row.userId)).subscriptions).some((s) => COVERING_STATUSES.has(s.status));
  if (ageDays >= UNCLAIMED_POLICY.removeAfterDays) {
    if (paid) {
      summary.flagged += 1;
      return;
    }
    const audit = await expiryAudit(store, row);
    const provisionedBefore = new Date(now.getTime() - UNCLAIMED_POLICY.removeAfterDays * DAY_MS);
    if (await store.provision.expireUnclaimed({ userId: row.userId, provisionedBefore, at: now, audit })) summary.removed += 1;
    return;
  }
  const tally = row.accountantUserId ? (tallies.get(row.accountantUserId) ?? { waiting: 0, removingSoon: 0, remindedNow: false }) : null;
  if (tally && row.accountantUserId) {
    tally.waiting += 1;
    if (!paid && ageDays >= UNCLAIMED_POLICY.removeAfterDays - UNCLAIMED_POLICY.removingSoonDays) tally.removingSoon += 1;
    tallies.set(row.accountantUserId, tally);
  }
  const day = reminderDayDue(ageDays, sentDays);
  if (day === null || !row.accountantUserId) return;
  if (await remind(options, row, row.accountantUserId, day)) {
    summary.reminded += 1;
    if (tally) tally.remindedNow = true;
  }
}

/** The latest reminder day reached, unless it (or a later one) was already sent. */
export function reminderDayDue(ageDays: number, sentDays: readonly number[]): number | null {
  const reached = UNCLAIMED_POLICY.reminderDays.filter((d) => d <= ageDays);
  const latest = reached.length > 0 ? reached[reached.length - 1]! : null;
  if (latest === null || sentDays.some((d) => d >= latest)) return null;
  return latest;
}

/** A fresh link with the same code (B17), mailed as a reminder; recorded as `accountant.customer_reminded` with its day. */
async function remind(options: UnclaimedSweepOptions, row: UnclaimedSweepRow, accountantUserId: string, day: number): Promise<boolean> {
  const { store, now } = options;
  const token = generateSetupToken();
  const tokenDigest = sessionDigest(options.pepper, token);
  const result = await store.provision.reissue({
    accountantUserId,
    customerUserId: row.userId,
    setupLink: { tokenDigest, expiresAt: new Date(now.getTime() + PROVISION_LINK_TTL_MS) },
    claimCodeDigestFor: null,
    at: now,
    auditFor: ({ organizationId }): AuditEventInput[] => [
      { organizationId, actorType: 'SYSTEM', actorId: null, action: 'accountant.customer_reminded', entityType: 'user', entityId: row.userId, metadata: { day }, requestId: null },
    ],
  });
  if (result.kind !== 'issued') return false;
  const accountant = await store.users.getById(accountantUserId);
  let sent = false;
  try {
    const outcome = await options.mailer.send({
      to: result.email,
      template: 'customer-setup',
      locale: result.locale,
      vars: { accountantName: accountant?.displayName ?? '', businessName: result.organization.name, link: setupUrl(options.origin, token), validDays: PROVISION_LINK_TTL_MS / DAY_MS, reminder: true },
      idempotencyKey: `customer-reminder:${row.userId}:${day}`,
    });
    sent = outcome.status === 'sent';
  } catch (err) {
    options.logger.error({ err, template: 'customer-setup' }, 'reminder not sent');
  }
  await store.provision.setMailStatus(tokenDigest, sent ? 'SENT' : 'FAILED');
  return true;
}

/** On the accountant's own profile (it outlives the purge); the customer's own profile when he is gone. */
async function expiryAudit(store: LedgerStore, row: UnclaimedSweepRow): Promise<AuditEventInput[]> {
  const owner = row.accountantUserId ?? row.userId;
  const organizationId = await personalOrganizationIdOf(store, owner).catch(() => null);
  if (!organizationId) return [];
  return [{ organizationId, actorType: 'SYSTEM', actorId: null, action: 'accountant.customer_expired', entityType: 'user', entityId: row.userId, metadata: { days: UNCLAIMED_POLICY.removeAfterDays }, requestId: null }];
}

async function mailDigest(options: UnclaimedSweepOptions, accountantUserId: string, tally: AccountantTally): Promise<boolean> {
  const accountant = await options.store.users.getById(accountantUserId);
  if (!accountant || accountant.status !== 'ACTIVE') return false;
  const day = options.now.toISOString().slice(0, 10);
  try {
    const outcome = await options.mailer.send({
      to: accountant.email,
      template: 'accountant-unclaimed-digest',
      locale: accountant.locale as UserLocale,
      vars: { waiting: tally.waiting, removingSoon: tally.removingSoon, deskLink: `${options.origin.replace(/\/+$/, '')}/client-books` },
      idempotencyKey: `unclaimed-digest:${accountantUserId}:${day}`,
    });
    return outcome.status === 'sent';
  } catch (err) {
    options.logger.error({ err, template: 'accountant-unclaimed-digest' }, 'digest not sent');
    return false;
  }
}
