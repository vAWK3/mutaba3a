import { daysBetween, todayIn, type IsoDate } from '../dates.js';
import type { CalendarDay, Mailer } from '../email/ports.js';
import type { Logger } from '../logger.js';
import type { AuditEventInput, LedgerStore, VatPeriodRecord, VatSweepPerson, VatSweepTarget } from '../repositories/ports.js';
import { vatPackFor } from './pack.js';
import type { VatPeriod, VatPeriodKind } from './types.js';

/**
 * MUT-782 (ADR-341): the daily VAT period sweep, shaped like MUT-767's unclaimed sweep (keyset pages, a per-run cap, a
 * try/catch per profile, mail idempotency keys, one digest per accountant per day, counts only in the logs).
 *
 *   for each profile with an ACTIVE accountant and a claimed, live owner (pages of `batch`):
 *     kind  = the accountant's choice, else the dealer type's default, else none   ──► none: stop
 *     period = the latest period that ended before today (the profile's own zone)
 *     ended within `announceWindowDays`  ──► announce (insert once): mail every owner; count it for each accountant
 *     else, the latest period still OPEN or MORE_NEEDED whose follow-up is due ──► one reminder to every owner
 *   then ONE digest per accountant (at most one a UTC day): how many of their clients' periods were announced today
 *
 * `announce` is the idempotency: the unique (profile, period) row is inserted by exactly one run, so a second run, or
 * two racing ones, mail nothing twice. A failed mail is not retried that day; the follow-up covers it.
 */
export const VAT_PERIOD_POLICY = {
  /** A period is announced from the day after it ends for this many days; a longer-gone one is never announced (no mail about last year when the flag turns on). */
  announceWindowDays: 10,
  /** The client's reminder, in days after the announcement, and after each Ask for more. */
  followUpAfterDays: 5,
  /** A scheduler that fires a little early on the day still sends it that day, not the next. */
  followUpGraceMinutes: 60,
  batch: 200,
  /** Safety cap: at most this many profiles looked at per run; `incomplete` says the run stopped at it and the profiles past it were not reached (TD-374: there is no resume cursor yet). */
  maxPerRun: 5000,
} as const;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export interface VatPeriodSweepSummary {
  looked: number;
  announced: number;
  followUps: number;
  digests: number;
  failed: number;
  incomplete: boolean;
}

export interface VatPeriodSweepOptions {
  store: LedgerStore;
  mailer: Mailer;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Where links point (PORTAL_ORIGIN, else the request's origin). */
  origin: string;
  now: Date;
}

interface AccountantTally {
  person: VatSweepPerson;
  ended: number;
}

export async function runVatPeriodSweep(options: VatPeriodSweepOptions): Promise<VatPeriodSweepSummary> {
  const { store } = options;
  const summary: VatPeriodSweepSummary = { looked: 0, announced: 0, followUps: 0, digests: 0, failed: 0, incomplete: false };
  const tallies = new Map<string, AccountantTally>();
  let after: string | undefined;
  for (;;) {
    if (summary.looked >= VAT_PERIOD_POLICY.maxPerRun) {
      summary.incomplete = true;
      break;
    }
    const targets = await store.vatPeriods.sweepTargets({ limit: VAT_PERIOD_POLICY.batch, after });
    if (targets.length === 0) break;
    const latest = await store.vatPeriods.latestOf(targets.map((t) => t.organizationId));
    for (const target of targets) {
      summary.looked += 1;
      try {
        await sweepOne(options, target, latest.get(target.organizationId) ?? null, summary, tallies);
      } catch (err) {
        summary.failed += 1;
        options.logger.error({ err, organizationId: target.organizationId, event: 'vat_period_sweep_failed' }, 'VAT period not swept');
      }
    }
    after = targets[targets.length - 1]!.organizationId;
    if (targets.length < VAT_PERIOD_POLICY.batch) break;
  }
  if (summary.incomplete) options.logger.warn({ event: 'vat_period_sweep_incomplete', looked: summary.looked }, 'VAT period sweep stopped at its cap; later profiles were not reached (TD-374)');
  for (const [accountantUserId, tally] of tallies) {
    if (tally.ended > 0 && (await mailDigest(options, accountantUserId, tally))) summary.digests += 1;
  }
  return summary;
}

async function sweepOne(options: VatPeriodSweepOptions, target: VatSweepTarget, latest: VatPeriodRecord | null, summary: VatPeriodSweepSummary, tallies: Map<string, AccountantTally>): Promise<void> {
  const { store, now } = options;
  const periods = vatPackFor(target.country).vat.periods;
  const kind: VatPeriodKind = target.chosenKind ?? (target.dealerType === null ? 'NONE' : periods.defaultKind(target.dealerType));
  if (kind === 'NONE') return;
  const today = todayIn(target.timezone, now);
  const ended = periods.latestEnded(kind, today);
  // A period already announced that reaches this one's last day covers it: a kind changed right after an announcement
  // (2-monthly to monthly) must not mail the same months again.
  const covered = latest ? (periods.fromKey(latest.periodKey)?.endDate ?? '') >= (ended?.endDate ?? '9999-12-31') : false;
  if (ended && !covered && daysBetween(ended.endDate, today) <= VAT_PERIOD_POLICY.announceWindowDays) {
    const followUpDueAt = new Date(now.getTime() + VAT_PERIOD_POLICY.followUpAfterDays * DAY_MS);
    const inserted = await store.vatPeriods.announce({ organizationId: target.organizationId, periodKey: ended.key, at: now, followUpDueAt, audit: [audit(target.organizationId, 'vat_period.announced', ended.key)] });
    if (inserted) {
      summary.announced += 1;
      await mailOwners(options, target, ended, periods.dueDate(ended), false, `vat-period:${target.organizationId}:${ended.key}`);
      for (const accountant of target.accountants) {
        const tally = tallies.get(accountant.userId) ?? { person: accountant, ended: 0 };
        tally.ended += 1;
        tallies.set(accountant.userId, tally);
      }
      return;
    }
  }
  if (!latest || (latest.state !== 'OPEN' && latest.state !== 'MORE_NEEDED') || latest.followUpDueAt === null || latest.followUpDueAt.getTime() > now.getTime() + VAT_PERIOD_POLICY.followUpGraceMinutes * MINUTE_MS || latest.followUpSentAt !== null) return;
  const period = periods.fromKey(latest.periodKey);
  if (!period) return;
  // Each re-arm (Ask for more) has its own due instant, so each gets its own mail keys.
  const sent = await mailOwners(options, target, period, periods.dueDate(period), true, `vat-period-followup:${target.organizationId}:${latest.periodKey}:${latest.followUpDueAt.getTime()}`);
  if (sent) {
    await store.vatPeriods.markFollowUpSent(target.organizationId, latest.periodKey, now);
    summary.followUps += 1;
  }
}

function audit(organizationId: string, action: string, periodKey: string): AuditEventInput {
  return { organizationId, actorType: 'SYSTEM', actorId: null, action, entityType: 'vat_period', entityId: null, metadata: { periodKey }, requestId: null };
}

function calendarDay(date: IsoDate): CalendarDay {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

/** Mails every owner of the profile; true when at least one mail went out. */
async function mailOwners(options: VatPeriodSweepOptions, target: VatSweepTarget, period: VatPeriod, due: IsoDate | null, reminder: boolean, keyBase: string): Promise<boolean> {
  const link = `${options.origin.replace(/\/+$/, '')}/sign-in`;
  let any = false;
  for (const owner of target.owners) {
    try {
      const outcome = await options.mailer.send({
        to: owner.email,
        template: 'vat-period-client',
        locale: owner.locale,
        vars: { businessName: target.name, period: { kind: period.kind, year: period.year, firstMonth: period.firstMonth, lastMonth: period.lastMonth }, dueOn: due === null ? null : calendarDay(due), link, reminder },
        idempotencyKey: `${keyBase}:${owner.userId}`,
      });
      if (outcome.status === 'sent') any = true;
    } catch (err) {
      options.logger.error({ err, template: 'vat-period-client' }, 'VAT period mail not sent');
    }
  }
  return any;
}

async function mailDigest(options: VatPeriodSweepOptions, accountantUserId: string, tally: AccountantTally): Promise<boolean> {
  const day = options.now.toISOString().slice(0, 10);
  try {
    const outcome = await options.mailer.send({
      to: tally.person.email,
      template: 'vat-period-accountant-digest',
      locale: tally.person.locale,
      vars: { ended: tally.ended, deskLink: `${options.origin.replace(/\/+$/, '')}/client-books` },
      idempotencyKey: `vat-digest:${accountantUserId}:${day}`,
    });
    return outcome.status === 'sent';
  } catch (err) {
    options.logger.error({ err, template: 'vat-period-accountant-digest' }, 'VAT period digest not sent');
    return false;
  }
}
