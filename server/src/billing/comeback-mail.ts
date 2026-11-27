import { performance } from 'node:perf_hooks';
import { normalizeEmail } from '../auth/users.js';
import { mailOffToken } from '../email/mail-off-token.js';
import { unsubscribeHeaders } from '../email/unsubscribe.js';
import type { Mailer, SendResult } from '../email/ports.js';
import type { Logger } from '../logger.js';
import { StateConflict } from '../repositories/memory.js';
import type { ComebackCandidate, LedgerStore, UserLocale } from '../repositories/ports.js';
import { COMEBACK_STAGES, comebackPlanOf, comebackRefusalOf, comebackStageOf, type ComebackOffer, type ComebackRefusal, type ComebackStage } from './comeback.js';
import { comebackFactsOf } from './comeback-read.js';
import type { OfferEntry } from './offer.js';
import type { PlanName } from './plans.js';

/**
 * MUT-534 (plan D10–D13, ADR-243): the come-back mail. Once a day (Cloud Scheduler, `POST /jobs/v1/billing/comeback-mail`,
 * or the operator's `npm --prefix server run billing:comeback-mail`) each person whose latest paid plan Stripe ended
 * 30–44 or 90–104 days ago is told, in their language, that their records are still there and what the first month
 * back costs.
 *
 * The rules (comeback.ts) decide; Stripe says whether the lapsed plan ever took money. Each stage is recorded
 * (`COMEBACK_OFFERED`, `reason` = the stage) before it is mailed, once per person ever (a unique index); that record is
 * what opens the offer in Billing and at Checkout. A mail that didn't go out releases its record, so the next run tries
 * again and the offer stays shut for someone who was never told.
 *
 * MUT-703 (ADR-340, §13 Q5): with the plans on sale (PLAN_CHECKOUT) the mail offers the plan the person lapsed from
 * (Solo for a legacy Freelancer lapse), Firm included, at the plans' percent come-back; off, the legacy offer as before.
 */
export const COMEBACK_MAIL_TIME_BUDGET_MS = 200_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ComebackSkip = 'paying' | 'no-lapse' | 'too-soon' | 'already-had' | 'stay-offer-recent' | 'covered' | 'no-profile' | 'no-stage' | 'already-mailed' | 'never-paid' | 'no-offer' | 'no-price' | 'suppressed' | 'opted-out';

export interface ComebackMailRow {
  userId: string;
  email: string;
  locale: UserLocale;
  stripeSubscriptionId: string;
  stage: ComebackStage | null;
  action: 'send' | 'skip';
  skip: ComebackSkip | null;
  /** The mailer's answer, or `failed` when Stripe or the mailer threw; null on a skip or a dry run. */
  outcome: SendResult['status'] | null;
}

export interface ComebackMailSummary {
  dryRun: boolean;
  checked: number;
  due: number;
  sent: number;
  duplicate: number;
  notSent: number;
  skipped: Record<'paying' | 'noLapse' | 'tooSoon' | 'firm' | 'alreadyHad' | 'stayOfferRecent' | 'covered' | 'noProfile' | 'noStage' | 'alreadyMailed' | 'neverPaid' | 'noOffer' | 'noPrice' | 'suppressed' | 'optedOut', number>;
  incomplete: boolean;
}

export interface ComebackRunOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  now: Date;
  stripe: {
    /**
     * The running come-back offer (the coupon and the catalog), read once per run and plan; null when there is none.
     * MUT-703: `plan` null is the legacy Freelancer offer.
     */
    offer(plan: PlanName | null): Promise<ComebackOffer | null>;
    /** Invoices of the subscription that took money. */
    paidInvoices(stripeSubscriptionId: string): Promise<number>;
  };
  /** Billing's Subscribe step (`/?billing=true&step=subscribe`). */
  subscribeLink: string;
  /**
   * ADR-279: the mail is promotional, so it carries an unsubscribe: the mail-off page (`{portal}/mail-off?mail=offers#token`)
   * and the one-click List-Unsubscribe headers, both with the person's signed mail-off token.
   */
  optOut: { portalOrigin: string; pepper: string };
  offers?: readonly OfferEntry[];
  /** MUT-703 (PLAN_CHECKOUT): offer the lapsed plan at the plans' come-back. Absent = off (the legacy offer). */
  planSales?: boolean;
  dryRun: boolean;
  elapsedMs?: () => number;
  budgetMs?: number;
}

const REFUSAL_SKIP: Record<Exclude<ComebackRefusal, 'NOT_OFFERED'>, ComebackSkip> = {
  PAYING: 'paying',
  NO_LAPSE: 'no-lapse',
  TOO_SOON: 'too-soon',
  ALREADY_HAD: 'already-had',
  STAY_OFFER_RECENT: 'stay-offer-recent',
  COVERED: 'covered',
  NO_PROFILE: 'no-profile',
};

export async function runComebackMail(options: ComebackRunOptions): Promise<{ summary: ComebackMailSummary; rows: ComebackMailRow[] }> {
  const { store, now, dryRun } = options;
  const started = performance.now();
  const elapsed = options.elapsedMs ?? (() => performance.now() - started);
  const budget = options.budgetMs ?? COMEBACK_MAIL_TIME_BUDGET_MS;
  const window = { endedAfter: new Date(now.getTime() - COMEBACK_STAGES[1].toDays * DAY_MS), endedUpTo: new Date(now.getTime() - COMEBACK_STAGES[0].fromDays * DAY_MS) };
  // MUT-565: an Accountant plan that ended is no come-back for the Freelancer plan (and has no offer of its own).
  const people = latestPerPerson((await store.billing.comebackCandidates(window)).filter((c) => c.tier !== 'ACCOUNTANT'));
  // One read per offer a run needs (the legacy one, or each lapsed plan's), warned once when there is none.
  const offers = new Map<string, Promise<ComebackOffer | null>>();
  const offerFor = (candidate: ComebackCandidate) => {
    const plan = options.planSales ? comebackPlanOf(candidate.tier) : null;
    const key = plan ?? 'legacy';
    if (!offers.has(key)) {
      offers.set(
        key,
        options.stripe.offer(plan).then((offer) => {
          if (!offer) options.logger.warn({ plan: key }, 'come-back mail: no running come-back offer (check the coupon in offers.json); nobody is mailed it');
          return offer;
        }),
      );
    }
    return offers.get(key)!;
  };

  const rows: ComebackMailRow[] = [];
  let incomplete = false;
  for (const candidate of people) {
    if (elapsed() > budget) {
      incomplete = true;
      break;
    }
    const { userId, email, locale, stripeSubscriptionId } = candidate;
    const row: ComebackMailRow = { userId, email, locale, stripeSubscriptionId, stage: comebackStageOf(candidate.endedAt, now), action: 'skip', skip: null, outcome: null };
    let claimId: string | null = null;
    try {
      const offer = row.stage ? await offerFor(candidate) : null;
      row.skip = await skipReason(options, candidate, row.stage, offer);
      if (!row.skip) {
        row.action = 'send';
        if (!dryRun) {
          const claim = await claimStage(store, candidate, row.stage!, now);
          if (claim === 'taken') row.outcome = 'duplicate';
          else {
            claimId = claim;
            row.outcome = (await send(options, candidate, row.stage!, (await offerFor(candidate))!)).status;
            // Only a mail that went out keeps its record: it is what opens the offer.
            if (row.outcome !== 'sent' && row.outcome !== 'duplicate') await store.billing.releaseRetentionEvent(claimId);
          }
        }
      }
    } catch (err) {
      // Review: the claim id lets the operator release a record a crash left behind (its mail never went out).
      options.logger.error({ err, stripeSubscriptionId, claimId }, 'come-back mail failed for one person; the next run tries again');
      if (claimId) await store.billing.releaseRetentionEvent(claimId).catch(() => undefined);
      row.action = 'send';
      row.skip = null;
      row.outcome = 'failed';
    }
    rows.push(row);
  }

  const summary = summarize(rows, dryRun, incomplete);
  options.logger.info({ comebackMail: summary }, dryRun ? 'come-back mail dry run' : 'come-back mail run');
  return { summary, rows };
}

/** The window can hold more than one ended plan per person; their latest is the lapse that counts. */
function latestPerPerson(candidates: readonly ComebackCandidate[]): ComebackCandidate[] {
  const latest = new Map<string, ComebackCandidate>();
  for (const c of candidates) {
    const seen = latest.get(c.userId);
    if (!seen || c.endedAt > seen.endedAt) latest.set(c.userId, c);
  }
  return [...latest.values()];
}

async function skipReason(options: ComebackRunOptions, candidate: ComebackCandidate, stage: ComebackStage | null, offer: ComebackOffer | null): Promise<ComebackSkip | null> {
  const { store, now } = options;
  if (!stage) return 'no-stage';
  const facts = await comebackFactsOf(store, candidate.userId, now, options.offers);
  const refusal = comebackRefusalOf(facts, now, { requireOffered: false });
  if (refusal && refusal !== 'NOT_OFFERED') return REFUSAL_SKIP[refusal];
  if (facts.events.some((e) => e.kind === 'COMEBACK_OFFERED' && e.reason === stage)) return 'already-mailed';
  if (!offer) return 'no-offer';
  if (offer.firstMonth[candidate.currency] === null) return 'no-price';
  if (await store.email.isSuppressed(normalizeEmail(candidate.email))) return 'suppressed';
  if ((await store.users.getById(candidate.userId))?.offerMail === 'OFF') return 'opted-out';
  if ((await options.stripe.paidInvoices(candidate.stripeSubscriptionId)) < 1) return 'never-paid';
  return null;
}

async function claimStage(store: LedgerStore, candidate: ComebackCandidate, stage: ComebackStage, now: Date): Promise<string | 'taken'> {
  try {
    const event = await store.billing.claimRetentionEvent({ userId: candidate.userId, stripeSubscriptionId: candidate.stripeSubscriptionId, kind: 'COMEBACK_OFFERED', reason: stage, months: null, startsAt: null, endsAt: null, at: now });
    return event.id;
  } catch (err) {
    if (err instanceof StateConflict && err.reason === 'TAKEN') return 'taken';
    throw err;
  }
}

function send(options: ComebackRunOptions, candidate: ComebackCandidate, stage: ComebackStage, offer: ComebackOffer): Promise<SendResult> {
  const c = candidate.currency;
  const origin = options.optOut.portalOrigin.replace(/\/+$/, '');
  const token = mailOffToken(options.optOut.pepper, candidate.userId);
  return options.mailer.send({
    to: candidate.email,
    locale: candidate.locale,
    template: 'comeback-offer',
    idempotencyKey: `comeback:${candidate.userId}:${stage}`,
    vars: {
      stage,
      firstMonth: offer.firstMonth[c]!,
      listMonth: offer.listMonth[c]!,
      firstYear: offer.firstYear[c],
      listYear: offer.listYear[c],
      currency: c,
      subscribeLink: options.subscribeLink,
      offLink: `${origin}/mail-off?mail=offers#${token}`,
      // MUT-703: the plan offered and the plans' percent (the legacy offer: Freelancer, an amount off).
      plan: offer.plan,
      percentOff: offer.percentOff,
    },
    headers: unsubscribeHeaders(origin, 'offers', options.optOut.pepper, candidate.userId),
  });
}

function summarize(rows: readonly ComebackMailRow[], dryRun: boolean, incomplete: boolean): ComebackMailSummary {
  const count = (pick: (r: ComebackMailRow) => boolean) => rows.filter(pick).length;
  const skipped = (reason: ComebackSkip) => count((r) => r.skip === reason);
  return {
    dryRun,
    checked: rows.length,
    due: count((r) => r.action === 'send' && r.outcome !== 'failed'),
    sent: count((r) => r.outcome === 'sent'),
    duplicate: count((r) => r.outcome === 'duplicate'),
    notSent: count((r) => r.outcome !== null && r.outcome !== 'sent' && r.outcome !== 'duplicate'),
    skipped: {
      paying: skipped('paying'),
      noLapse: skipped('no-lapse'),
      tooSoon: skipped('too-soon'),
      // MUT-703 (§13 Q5): a Firm lapse is mailed now; the count stays for older operator tools.
      firm: 0,
      alreadyHad: skipped('already-had'),
      stayOfferRecent: skipped('stay-offer-recent'),
      covered: skipped('covered'),
      noProfile: skipped('no-profile'),
      noStage: skipped('no-stage'),
      alreadyMailed: skipped('already-mailed'),
      neverPaid: skipped('never-paid'),
      noOffer: skipped('no-offer'),
      noPrice: skipped('no-price'),
      suppressed: skipped('suppressed'),
      optedOut: skipped('opted-out'),
    },
    incomplete,
  };
}
