import { performance } from 'node:perf_hooks';
import { normalizeEmail } from '../auth/users.js';
import { todayIn } from '../dates.js';
import { mailOffToken } from '../email/mail-off-token.js';
import { unsubscribeHeaders } from '../email/unsubscribe.js';
import type { MailSummaryProfile, Mailer, SendResult } from '../email/ports.js';
import type { Logger } from '../logger.js';
import { verdictProfilesOf } from '../personal-profile.js';
import type { LedgerStore, MonthlySummaryCandidate, Organization, UserLocale } from '../repositories/ports.js';
import { readProfileFigures, type PostingDoor } from '../summaries/profile-figures.js';
import { currentSubscription, type Catalog } from './checkout.js';
import { entitlementsFor, memberProfilesForBilling } from './coverage.js';
import { profilePlanSubscriptions, TRIAL_DAYS } from './entitlement.js';
import { mailProfilesOf, monthEndedFor, profileBlockOf, summaryMonthOf, SUMMARY_ZONE, type ProfileBlock, type SummaryMonth } from './monthly-summary.js';
import type { PlanGateway } from './stripe/plan-gateway.js';
import { yearlySwitchLine } from './yearly-switch-line.js';

/**
 * MUT-535 (plan D1–D13, ADR-259): the monthly summary mail. On days 1–7 of each month (Cloud Scheduler,
 * `POST /jobs/v1/billing/monthly-summary-mail`, or the operator's `npm --prefix server run billing:monthly-summary-mail`),
 * each person who pays or trials gets one mail, in their language, with a panel per profile they hold that their plan
 * covers: last month's money in, what is still owed and what is overdue, per currency, read through the same function
 * as Reports' Glance (summaries/profile-figures.ts).
 *
 * The mail shares the API's daily cap with every other mail (and Malafat's, on one Resend plan), so a run sends at most
 * `sendBudget` and stops at its first `capped`; the next day's run picks up where it stopped, the mailer's send log
 * keeping each `monthly-summary:<person>:<month>` once (D12).
 */
export const MONTHLY_SUMMARY_TIME_BUDGET_MS = 200_000;
/** D12: the default sends per run, well inside the production cap of 90 a day. */
export const MONTHLY_SUMMARY_DAILY_SENDS = 40;
const PAGE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MonthlySummarySkip = 'opted-out' | 'suppressed' | 'nothing-covered' | 'month-not-over' | 'nothing-to-show';

export interface MonthlySummaryRow {
  userId: string;
  email: string;
  locale: UserLocale;
  profiles: number;
  action: 'send' | 'skip';
  skip: MonthlySummarySkip | null;
  /** The mailer's answer, or `failed` when a read or the mailer threw; null on a skip or a dry run. */
  outcome: SendResult['status'] | null;
}

export interface MonthlySummarySummary {
  dryRun: boolean;
  month: string;
  checked: number;
  due: number;
  sent: number;
  duplicate: number;
  notSent: number;
  failed: number;
  skipped: Record<'optedOut' | 'suppressed' | 'nothingCovered' | 'monthNotOver' | 'nothingToShow', number>;
  /** The time or send budget ran out, or the mail cap was met: the next run continues. */
  incomplete: boolean;
}

export interface MonthlySummaryRunOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  now: Date;
  /** The portal's origin, no trailing slash: overview, Switch and opt-out links. */
  portalOrigin: string;
  /** SESSION_TOKEN_PEPPER: keys the opt-out token. */
  pepper: string;
  /** Null: no Stripe on this server; the mail goes without the yearly line (D9). */
  stripe: { catalog(): Promise<Catalog>; plan: PlanGateway } | null;
  dryRun: boolean;
  sendBudget?: number;
  elapsedMs?: () => number;
  budgetMs?: number;
}

/** A profile the person holds that their plan covers today, and whether Malafat is what covers it (D2, D7). */
export interface CoveredProfile {
  organization: Organization;
  malafatCovered: boolean;
}

/**
 * D2: the profiles of the verdict's set (owned, co-owned, firms the person OWNS) whose entitlement today is ACTIVE or
 * GRACE and not paused. Shared with You › Account's switch, so it shows on exactly when a mail would go.
 */
export async function coveredProfilesOf(store: LedgerStore, userId: string, now: Date): Promise<CoveredProfile[]> {
  const [held, billing] = await Promise.all([verdictProfilesOf(store, userId), memberProfilesForBilling(store, userId)]);
  const ids = new Set(held.map((p) => p.organization.id));
  const mine = billing.filter((p) => ids.has(p.organization.id));
  const entitlements = await entitlementsFor(store, mine, now);
  return held.flatMap(({ organization }) => {
    const e = entitlements.get(organization.id);
    return e && (e.state === 'ACTIVE' || e.state === 'GRACE') && !e.paused ? [{ organization, malafatCovered: e.source === 'MALAFAT' }] : [];
  });
}

export async function runMonthlySummaryMail(options: MonthlySummaryRunOptions): Promise<{ summary: MonthlySummarySummary; rows: MonthlySummaryRow[] }> {
  const { store, now, dryRun } = options;
  const started = performance.now();
  const elapsed = options.elapsedMs ?? (() => performance.now() - started);
  const budget = options.budgetMs ?? MONTHLY_SUMMARY_TIME_BUDGET_MS;
  const sendBudget = options.sendBudget ?? MONTHLY_SUMMARY_DAILY_SENDS;
  const month = summaryMonthOf(now);
  const catalog = await catalogOf(options);

  const rows: MonthlySummaryRow[] = [];
  let incomplete = false;
  let after: string | null = null;
  pages: for (;;) {
    const page = await store.billing.monthlySummaryCandidates({ trialStartedAfter: new Date(now.getTime() - TRIAL_DAYS * DAY_MS), now, after, limit: PAGE });
    for (const candidate of page) {
      const sent = rows.filter((r) => r.outcome === 'sent').length;
      if (elapsed() > budget || (!dryRun && sent >= sendBudget)) {
        incomplete = true;
        break pages;
      }
      const row = await personRow(options, candidate, month, catalog);
      rows.push(row);
      // D12: at the cap, every later send would be refused too, and would eat into what other mail needs.
      if (row.outcome === 'capped') {
        incomplete = true;
        break pages;
      }
    }
    if (page.length < PAGE) break;
    after = page[page.length - 1]!.userId;
  }

  const summary = summarize(rows, month, dryRun, incomplete);
  options.logger.info({ monthlySummaryMail: summary }, dryRun ? 'monthly summary dry run' : 'monthly summary run');
  return { summary, rows };
}

async function catalogOf(options: MonthlySummaryRunOptions): Promise<Catalog | null> {
  if (!options.stripe) return null;
  try {
    return await options.stripe.catalog();
  } catch (err) {
    // D9: no prices, no yearly line; the mail itself still goes.
    options.logger.warn({ err }, 'monthly summary: the catalog is unavailable; no yearly line this run');
    return null;
  }
}

async function personRow(options: MonthlySummaryRunOptions, candidate: MonthlySummaryCandidate, month: SummaryMonth, catalog: Catalog | null): Promise<MonthlySummaryRow> {
  const { userId, email, locale } = candidate;
  const row: MonthlySummaryRow = { userId, email, locale, profiles: 0, action: 'skip', skip: null, outcome: null };
  try {
    const decided = await blocksFor(options, candidate, month);
    if ('skip' in decided) {
      row.skip = decided.skip;
      return row;
    }
    row.action = 'send';
    row.profiles = decided.blocks.length;
    if (!options.dryRun) row.outcome = (await send(options, candidate, month, decided.blocks, catalog)).status;
  } catch (err) {
    // D5 (review R9): one unreadable profile and the person waits for the next run, rather than a mail with a hole the
    // month's key would make final.
    options.logger.error({ err, userId }, 'monthly summary failed for one person; the next run tries again');
    row.action = 'send';
    row.skip = null;
    row.outcome = 'failed';
  }
  return row;
}

async function blocksFor(options: MonthlySummaryRunOptions, candidate: MonthlySummaryCandidate, month: SummaryMonth): Promise<{ blocks: ProfileBlock[] } | { skip: MonthlySummarySkip }> {
  const { store, now } = options;
  if (candidate.choice === 'OFF') return { skip: 'opted-out' };
  if (await store.email.isSuppressed(normalizeEmail(candidate.email))) return { skip: 'suppressed' };
  const profiles = mailProfilesOf(candidate.choice, await coveredProfilesOf(store, candidate.userId, now));
  if (profiles.length === 0) return { skip: 'nothing-covered' };
  // A dry run writes nothing, so it doesn't post due installments (its owed can lag by them).
  const posting: PostingDoor | null = options.dryRun ? null : { store, actor: { actorType: 'SYSTEM', actorId: null, requestId: null } };
  const blocks: ProfileBlock[] = [];
  for (const { organization } of profiles) {
    const figures = await readProfileFigures(store, organization, month, now, posting);
    if (!monthEndedFor(figures.today, month)) return { skip: 'month-not-over' };
    const block = profileBlockOf({ id: organization.id, name: organization.name }, figures);
    if (block) blocks.push(block);
  }
  return blocks.length > 0 ? { blocks } : { skip: 'nothing-to-show' };
}

async function send(options: MonthlySummaryRunOptions, candidate: MonthlySummaryCandidate, month: SummaryMonth, blocks: readonly ProfileBlock[], catalog: Catalog | null): Promise<SendResult> {
  const origin = options.portalOrigin.replace(/\/+$/, '');
  const [year, monthNumber] = month.key.split('-').map(Number) as [number, number];
  const [asOfYear, asOfMonth, asOfDay] = todayIn(SUMMARY_ZONE, options.now).split('-').map(Number) as [number, number, number];
  // MUT-657 (E-5): each profile's link opens its home on In & out, the portal's view of the month the mail sums up
  const profiles: MailSummaryProfile[] = blocks.map((b) => ({ name: b.name, link: `${origin}/p/${b.profileId}?view=in-out`, cameIn: b.cameIn, owed: b.owed, overdue: b.overdue, overdueCount: b.overdueCount, ...(b.invoiceSplit ? { invoiceSplit: b.invoiceSplit } : {}) }));
  const token = mailOffToken(options.pepper, candidate.userId);
  return options.mailer.send({
    to: candidate.email,
    locale: candidate.locale,
    template: 'monthly-summary',
    idempotencyKey: `monthly-summary:${candidate.userId}:${month.key}`,
    vars: {
      month: { year, month: monthNumber },
      asOf: { year: asOfYear, month: asOfMonth, day: asOfDay },
      profiles,
      yearly: await yearlyLine(options, candidate.userId, catalog, origin),
      offLink: `${origin}/mail-off#${token}`,
    },
    // ADR-279: the mail client's own one-click unsubscribe
    headers: unsubscribeHeaders(origin, 'monthly-summary', options.pepper, candidate.userId),
  });
}

/** D9: MUT-531's own line, as Billing shows it; nothing without Stripe, prices or a saving to name. */
async function yearlyLine(options: MonthlySummaryRunOptions, userId: string, catalog: Catalog | null, origin: string): Promise<{ savings: number; currency: string; link: string } | null> {
  if (!options.stripe || !catalog) return null;
  const summary = await options.store.billing.summaryOf(userId);
  const shown = currentSubscription(profilePlanSubscriptions(summary.subscriptions), options.now);
  if (!shown) return null;
  const line = await yearlySwitchLine(options.store, userId, options.stripe.plan, shown, catalog, options.now, options.logger, 'monthly-summary');
  return line && line.savings !== null ? { savings: line.savings, currency: line.currency, link: `${origin}/?billing=true&step=switch` } : null;
}

function summarize(rows: readonly MonthlySummaryRow[], month: SummaryMonth, dryRun: boolean, incomplete: boolean): MonthlySummarySummary {
  const count = (pick: (r: MonthlySummaryRow) => boolean) => rows.filter(pick).length;
  const skipped = (reason: MonthlySummarySkip) => count((r) => r.skip === reason);
  return {
    dryRun,
    month: month.key,
    checked: rows.length,
    due: count((r) => r.action === 'send' && r.outcome !== 'failed'),
    sent: count((r) => r.outcome === 'sent'),
    duplicate: count((r) => r.outcome === 'duplicate'),
    notSent: count((r) => r.outcome !== null && r.outcome !== 'sent' && r.outcome !== 'duplicate' && r.outcome !== 'failed'),
    failed: count((r) => r.outcome === 'failed'),
    skipped: {
      optedOut: skipped('opted-out'),
      suppressed: skipped('suppressed'),
      nothingCovered: skipped('nothing-covered'),
      monthNotOver: skipped('month-not-over'),
      nothingToShow: skipped('nothing-to-show'),
    },
    incomplete,
  };
}

