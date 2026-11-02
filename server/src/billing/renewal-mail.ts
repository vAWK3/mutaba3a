import { performance } from 'node:perf_hooks';
import { normalizeEmail } from '../auth/users.js';
import type { Mailer, SendResult } from '../email/ports.js';
import type { Logger } from '../logger.js';
import type { LedgerStore, UserLocale } from '../repositories/ports.js';
import { ALL_GA_LOOKUP_KEYS } from './checkout.js';
import { jerusalemDayOf } from './offer-read.js';

/**
 * MUT-525 (TODO-1/D11, DD8, ADR-237): the pre-renewal notice. Once a day (Cloud Scheduler, `POST
 * /jobs/v1/billing/renewal-mail`, or the operator's `npm --prefix server run billing:renewal-mail`) the payer of each
 * launch-offer subscription whose first renewal falls within RENEWAL_NOTICE_DAYS is told, once, in their language: the
 * day, the yearly price it renews at (the subscription's own, which Stripe will charge), and how to cancel.
 *
 * Candidates come from the mirror (`offerId`, active, not cancelling, a linked payer). Stripe's own subscription then
 * decides, since the mirror can be late: still active and not cancelling, still in its first paid year (the period
 * that started at the trial's end, or at the start), and still on a list price (a founder or a changed price is not
 * this notice's to announce). The window is a window: a missed day catches up on the next run, and the mailer's send
 * log keeps each `renewal:<subscription>:<renewal day>` once.
 */
export const RENEWAL_NOTICE_DAYS = 30;
/** Stop starting sends after this long; the Scheduler's attempt deadline is 280 s (main.tf), like the trial mail's. */
export const RENEWAL_MAIL_TIME_BUDGET_MS = 200_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What Stripe says about one subscription, as the notice needs it; null when Stripe no longer has it. */
export interface RenewalFacts {
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date;
  /** The current period is the first paid one: it began at the trial's end, or at the start with no trial. */
  firstPaidPeriod: boolean;
  /** The subscription's own price, minor units. */
  unitAmount: number;
  currency: string;
  lookupKey: string | null;
}

export type RenewalMailSkip = 'gone' | 'not-active' | 'cancelling' | 'not-first-year' | 'not-list-price' | 'suppressed';

export interface RenewalMailRow {
  userId: string;
  email: string;
  locale: UserLocale;
  stripeSubscriptionId: string;
  renewsAt: Date;
  action: 'send' | 'skip';
  skip: RenewalMailSkip | null;
  /** The mailer's answer, or `failed` when Stripe or the mailer threw; null on a skip or a dry run. */
  outcome: SendResult['status'] | null;
}

export interface RenewalMailSummary {
  dryRun: boolean;
  checked: number;
  due: number;
  sent: number;
  duplicate: number;
  notSent: number;
  skipped: { gone: number; notActive: number; cancelling: number; notFirstYear: number; notListPrice: number; suppressed: number };
  incomplete: boolean;
}

export interface RenewalMailRunOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: Pick<LedgerStore, 'billing' | 'email'>;
  mailer: Mailer;
  logger: Logger;
  now: Date;
  stripe: { renewalOf(stripeSubscriptionId: string): Promise<RenewalFacts | null> };
  /** Billing in the portal (`/?billing=true`), where the person cancels or changes the plan. */
  manageLink: string;
  dryRun: boolean;
  elapsedMs?: () => number;
  budgetMs?: number;
}

export async function runRenewalMail(options: RenewalMailRunOptions): Promise<{ summary: RenewalMailSummary; rows: RenewalMailRow[] }> {
  const { store, now, dryRun } = options;
  const started = performance.now();
  const elapsed = options.elapsedMs ?? (() => performance.now() - started);
  const budget = options.budgetMs ?? RENEWAL_MAIL_TIME_BUDGET_MS;
  const candidates = await store.billing.offerRenewalCandidates({ endsAfter: now, endsUpTo: new Date(now.getTime() + RENEWAL_NOTICE_DAYS * DAY_MS) });

  const rows: RenewalMailRow[] = [];
  let incomplete = false;
  for (const candidate of candidates) {
    if (elapsed() > budget) {
      incomplete = true;
      break;
    }
    const { userId, email, locale, stripeSubscriptionId } = candidate;
    const row: RenewalMailRow = { userId, email, locale, stripeSubscriptionId, renewsAt: candidate.currentPeriodEnd, action: 'send', skip: null, outcome: null };
    try {
      const facts = await options.stripe.renewalOf(stripeSubscriptionId);
      if (facts) row.renewsAt = facts.currentPeriodEnd;
      row.skip = facts ? skipReason(facts) : 'gone';
      if (!row.skip && (await store.email.isSuppressed(normalizeEmail(email)))) row.skip = 'suppressed';
      if (row.skip) row.action = 'skip';
      else if (!dryRun) row.outcome = (await send(options, row, facts!)).status;
    } catch (err) {
      // One subscription's failure costs only its mail; the window lasts a month, so tomorrow's run retries it.
      options.logger.error({ err, stripeSubscriptionId }, 'renewal notice failed for one subscription; the next run tries again');
      row.action = 'send';
      row.skip = null;
      row.outcome = 'failed';
    }
    rows.push(row);
  }

  const summary = summarize(rows, dryRun, incomplete);
  options.logger.info({ renewalMail: summary }, dryRun ? 'renewal notice dry run' : 'renewal notice run');
  return { summary, rows };
}

function skipReason(facts: RenewalFacts): RenewalMailSkip | null {
  if (facts.status !== 'active') return 'not-active';
  if (facts.cancelAtPeriodEnd) return 'cancelling';
  if (!facts.firstPaidPeriod) return 'not-first-year';
  if (facts.lookupKey === null || !ALL_GA_LOOKUP_KEYS.includes(facts.lookupKey)) return 'not-list-price';
  return null;
}

function send(options: RenewalMailRunOptions, row: RenewalMailRow, facts: RenewalFacts): Promise<SendResult> {
  const renewsOn = jerusalemDayOf(facts.currentPeriodEnd);
  const day = `${renewsOn.year}-${String(renewsOn.month).padStart(2, '0')}-${String(renewsOn.day).padStart(2, '0')}`;
  return options.mailer.send({
    to: row.email,
    locale: row.locale,
    template: 'offer-renewing-soon',
    idempotencyKey: `renewal:${row.stripeSubscriptionId}:${day}`,
    vars: { renewsOn, listAmount: facts.unitAmount, currency: facts.currency, manageLink: options.manageLink },
  });
}

function summarize(rows: readonly RenewalMailRow[], dryRun: boolean, incomplete: boolean): RenewalMailSummary {
  const count = (pick: (r: RenewalMailRow) => boolean) => rows.filter(pick).length;
  const skipped = (reason: RenewalMailSkip) => count((r) => r.skip === reason);
  return {
    dryRun,
    checked: rows.length,
    due: count((r) => r.action === 'send' && r.outcome !== 'failed'),
    sent: count((r) => r.outcome === 'sent'),
    duplicate: count((r) => r.outcome === 'duplicate'),
    notSent: count((r) => r.outcome !== null && r.outcome !== 'sent' && r.outcome !== 'duplicate'),
    skipped: {
      gone: skipped('gone'),
      notActive: skipped('not-active'),
      cancelling: skipped('cancelling'),
      notFirstYear: skipped('not-first-year'),
      notListPrice: skipped('not-list-price'),
      suppressed: skipped('suppressed'),
    },
    incomplete,
  };
}
