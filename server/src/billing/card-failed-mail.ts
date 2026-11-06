import { performance } from 'node:perf_hooks';
import { normalizeEmail } from '../auth/users.js';
import type { Mailer, SendResult } from '../email/ports.js';
import type { Logger } from '../logger.js';
import type { LedgerStore, UserLocale } from '../repositories/ports.js';
import { ACCOUNTANT_FREE_CLIENTS_DEFAULT } from './accountant-plan.js';

/**
 * MUT-533 (plan D1–D7, ADR-242): our own "your card didn't go through" mail, ar + en, in place of Stripe's English one.
 * Every hour (Cloud Scheduler, `POST /jobs/v1/billing/card-failed-mail`, or the operator's `npm --prefix server run
 * billing:card-failed-mail`) the payer of each `past_due` subscription in the mirror is looked at, and Stripe's open
 * invoices decide.
 *
 * One dunning episode per subscription: its oldest open invoice that a payment attempt failed on, the one whose last
 * retry ends the plan. A renewal invoice that arrives while it is still open joins the episode. Two stages, each sent
 * once per invoice through the send log (`card-failed:<invoice>:first|reminder`), and only the current one:
 *
 *   first     within FIRST_MAIL_WITHIN_HOURS of the first failure, while a retry is booked   what failed, access stays open, Update card
 *   reminder  from the retry window's midpoint, while a retry is booked   the plan ends within N days at most
 *
 * The first mail stops being current after 72 hours and the window is at most 28 days, so no key can be pruned from
 * the send log (30 days) while its stage could still come round: never more than 2 mails per failed invoice. A payment
 * the bank wants the person to confirm (3-D Secure) is Stripe's own "confirm your payment" mail (Basel, 2026-11-02).
 * No amount, no card details (ADR-159 §5 unchanged).
 */
export const FIRST_MAIL_WITHIN_HOURS = 72;
/** The reminder never comes sooner than this after the first failure, however short the window. */
export const REMINDER_NOT_BEFORE_DAYS = 3;
/** The Smart Retries windows this mail supports (`BILLING_RETRY_WINDOW_DAYS`); 28 keeps every key inside the send log. */
export const RETRY_WINDOW_DAYS = [7, 14, 21, 28] as const;
export type RetryWindowDays = (typeof RETRY_WINDOW_DAYS)[number];
/** Stop starting sends after this long; the Scheduler's attempt deadline is 280 s (main.tf), like the other mail runs. */
export const CARD_FAILED_MAIL_TIME_BUDGET_MS = 200_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** What Stripe says about one subscription's failed payment; null when Stripe no longer has the subscription. */
export interface FailedPaymentFacts {
  /** The subscription's status in Stripe. */
  status: string;
  /** The oldest open invoice with a failed attempt; null when none is open (paid, voided, written off). */
  episode: {
    invoiceId: string;
    attemptCount: number;
    /** Stripe's next retry; null when it has none booked. */
    nextPaymentAttempt: Date | null;
    firstFailedAt: Date;
    /** The bank asked the person to confirm (3-D Secure): Stripe mails them, and doesn't retry on its own. */
    needsAuthentication: boolean;
  } | null;
}

export type CardFailedStage = 'first' | 'reminder';
export type CardFailedSkip = 'gone' | 'not-past-due' | 'settled' | 'needs-authentication' | 'no-stage' | 'suppressed';
export type CardFailedStageNow = { stage: 'first'; invoiceId: string } | { stage: 'reminder'; invoiceId: string; daysLeft: number } | { skip: Exclude<CardFailedSkip, 'suppressed'> };

/** D2: the stage due now for one subscription, or why none is. Pure. */
export function cardFailedStageOf(facts: FailedPaymentFacts | null, now: Date, windowDays: number): CardFailedStageNow {
  if (!facts) return { skip: 'gone' };
  if (facts.status !== 'past_due') return { skip: 'not-past-due' };
  const episode = facts.episode;
  if (!episode) return { skip: 'settled' };
  if (episode.needsAuthentication) return { skip: 'needs-authentication' };
  const failedAt = episode.firstFailedAt.getTime();
  const reminderAt = failedAt + Math.max(REMINDER_NOT_BEFORE_DAYS * DAY_MS, (windowDays * DAY_MS) / 2);
  const t = now.getTime();
  // Both mails say Stripe will try again: with no retry booked (a no-retry policy, the last try already failed) neither is true.
  if (episode.nextPaymentAttempt === null) return { skip: 'no-stage' };
  if (t >= reminderAt) {
    const daysLeft = Math.max(1, Math.ceil((failedAt + windowDays * DAY_MS - t) / DAY_MS));
    return { stage: 'reminder', invoiceId: episode.invoiceId, daysLeft };
  }
  if (t - failedAt < FIRST_MAIL_WITHIN_HOURS * HOUR_MS) return { stage: 'first', invoiceId: episode.invoiceId };
  return { skip: 'no-stage' };
}

export interface CardFailedMailRow {
  userId: string;
  email: string;
  locale: UserLocale;
  stripeSubscriptionId: string;
  stage: CardFailedStage | null;
  action: 'send' | 'skip';
  skip: CardFailedSkip | null;
  /** The mailer's answer, or `failed` when Stripe or the mailer threw; null on a skip or a dry run. */
  outcome: SendResult['status'] | null;
}

export interface CardFailedMailSummary {
  dryRun: boolean;
  checked: number;
  due: number;
  sent: number;
  duplicate: number;
  notSent: number;
  skipped: { gone: number; notPastDue: number; settled: number; needsAuthentication: number; noStage: number; suppressed: number };
  incomplete: boolean;
}

export interface CardFailedRunOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: Pick<LedgerStore, 'billing' | 'email'>;
  mailer: Mailer;
  logger: Logger;
  now: Date;
  stripe: { failedPaymentOf(stripeSubscriptionId: string): Promise<FailedPaymentFacts | null> };
  /** Billing in the portal (`/?billing=true`), whose past-due panel opens Stripe's card form. */
  updateLink: string;
  windowDays: number;
  /** The lapse gate is on: a plan that ends turns the account read-only, and the reminder may say so. */
  readOnlyAfter: boolean;
  /** MUT-565: the client books an accountant keeps without the plan (ACCOUNTANT_FREE_CLIENTS); the Accountant plan's copy names it. */
  accountantFreeClients?: number;
  dryRun: boolean;
  elapsedMs?: () => number;
  budgetMs?: number;
}

export async function runCardFailedMail(options: CardFailedRunOptions): Promise<{ summary: CardFailedMailSummary; rows: CardFailedMailRow[] }> {
  const { store, now, dryRun } = options;
  const started = performance.now();
  const elapsed = options.elapsedMs ?? (() => performance.now() - started);
  const budget = options.budgetMs ?? CARD_FAILED_MAIL_TIME_BUDGET_MS;
  const candidates = await store.billing.pastDueCandidates();

  const rows: CardFailedMailRow[] = [];
  let incomplete = false;
  for (const candidate of candidates) {
    if (elapsed() > budget) {
      incomplete = true;
      break;
    }
    const { userId, email, locale, stripeSubscriptionId } = candidate;
    const accountant = candidate.tier === 'ACCOUNTANT';
    const row: CardFailedMailRow = { userId, email, locale, stripeSubscriptionId, stage: null, action: 'skip', skip: null, outcome: null };
    try {
      const due = cardFailedStageOf(await options.stripe.failedPaymentOf(stripeSubscriptionId), now, options.windowDays);
      if ('skip' in due) row.skip = due.skip;
      else {
        row.stage = due.stage;
        if (await store.email.isSuppressed(normalizeEmail(email))) row.skip = 'suppressed';
        else {
          row.action = 'send';
          if (!dryRun) row.outcome = (await send(options, row, due, accountant)).status;
        }
      }
    } catch (err) {
      // One subscription's failure costs only its mail; the next hour's run tries again.
      options.logger.error({ err, stripeSubscriptionId }, 'failed-card mail failed for one subscription; the next run tries again');
      row.action = 'send';
      row.skip = null;
      row.outcome = 'failed';
    }
    rows.push(row);
  }

  const summary = summarize(rows, dryRun, incomplete);
  options.logger.info({ cardFailedMail: summary }, dryRun ? 'failed-card mail dry run' : 'failed-card mail run');
  return { summary, rows };
}

function send(options: CardFailedRunOptions, row: CardFailedMailRow, due: Exclude<CardFailedStageNow, { skip: string }>, accountant: boolean): Promise<SendResult> {
  const base = { to: row.email, locale: row.locale, idempotencyKey: `card-failed:${due.invoiceId}:${due.stage}` };
  // MUT-565 review: the Accountant plan's copy says what its end means (client books past the free ones lock), never read-only.
  const plan = accountant ? { accountantFreeClients: options.accountantFreeClients ?? ACCOUNTANT_FREE_CLIENTS_DEFAULT } : {};
  if (due.stage === 'first') return options.mailer.send({ ...base, template: 'card-failed', vars: { updateLink: options.updateLink, ...plan } });
  return options.mailer.send({ ...base, template: 'card-failed-reminder', vars: { daysLeft: due.daysLeft, readOnlyAfter: options.readOnlyAfter, updateLink: options.updateLink, ...plan } });
}

function summarize(rows: readonly CardFailedMailRow[], dryRun: boolean, incomplete: boolean): CardFailedMailSummary {
  const count = (pick: (r: CardFailedMailRow) => boolean) => rows.filter(pick).length;
  const skipped = (reason: CardFailedSkip) => count((r) => r.skip === reason);
  return {
    dryRun,
    checked: rows.length,
    due: count((r) => r.action === 'send' && r.outcome !== 'failed'),
    sent: count((r) => r.outcome === 'sent'),
    duplicate: count((r) => r.outcome === 'duplicate'),
    notSent: count((r) => r.outcome !== null && r.outcome !== 'sent' && r.outcome !== 'duplicate'),
    skipped: {
      gone: skipped('gone'),
      notPastDue: skipped('not-past-due'),
      settled: skipped('settled'),
      needsAuthentication: skipped('needs-authentication'),
      noStage: skipped('no-stage'),
      suppressed: skipped('suppressed'),
    },
    incomplete,
  };
}
