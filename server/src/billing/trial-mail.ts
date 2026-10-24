import { performance } from 'node:perf_hooks';
import { normalizeEmail } from '../auth/users.js';
import type { Mailer, SendResult } from '../email/ports.js';
import type { Logger } from '../logger.js';
import { profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore, UserLocale } from '../repositories/ports.js';
import { entitlementsFor, memberProfilesForBilling } from './coverage.js';
import { trialTimelineOf, TRIAL_DAYS, TRIAL_LOCK_DAYS, type Entitlement } from './entitlement.js';

/**
 * MUT-419 (ADR-160 D3, ADR-182): the trial reminders. Once a day (Cloud Scheduler, `POST /jobs/v1/billing/trial-mail`,
 * or the operator's `npm --prefix server run billing:trial-mail`) every person in days 11–30 of an unpaid trial gets
 * the mail for the stage they are in now:
 *
 *   ending-soon   endsAt − 3 d ≤ now < endsAt        "Your free trial ends within N days"   Add a card
 *   ended         endsAt ≤ now < lockAt − 3 d        "Your account is read-only"            Subscribe, Download my records
 *   locking-soon  lockAt − 3 d ≤ now < lockAt        "Your account locks within N days"     Subscribe, Download my records
 *
 * A stage is a window (D1): a missed day catches up on the next run, and only the current stage is ever sent. The
 * mailer's send log keeps each `trial:<userId>:<stage>` once, so a second run that day sends nothing (A2).
 *
 * Who (R4): only someone every one of whose profiles is their own and resolves source TRIAL. Then the trial alone
 * decides their standing (gate.ts `personStanding`), so "your account is read-only" and "your account locks" are
 * exactly what the lapse gate does. A card on file is a Stripe subscription (`paying`); Malafat and operator grants
 * are `covered`; any other profile they belong to is `other-profiles`. With the gate off (R5) nothing goes read-only,
 * so nothing is mailed (`gate-off`).
 */
export const TRIAL_MAIL_STAGES = ['ending-soon', 'ended', 'locking-soon'] as const;
export type TrialMailStage = (typeof TRIAL_MAIL_STAGES)[number];
/** The ticket's lead time: three days before the trial ends, and three before the lock. */
export const TRIAL_REMINDER_DAYS = 3;
/** R1: stop starting sends after this long; the Scheduler's attempt deadline is 280 s (main.tf), like the reconcile's. */
export const TRIAL_MAIL_TIME_BUDGET_MS = 200_000;
export type TrialMailSkip = 'paying' | 'covered' | 'other-profiles' | 'suppressed' | 'gate-off';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialMailStageNow {
  stage: TrialMailStage;
  /** Whole days left before the deadline the mail names, rounded up (1–3); null for `ended`, which names none (D2). */
  daysLeft: number | null;
}

/** The stage a trial that started at `trialStartedAt` is in at `now`, or null when no reminder is due. Pure. */
export function trialMailStageOf(trialStartedAt: Date, now: Date): TrialMailStageNow | null {
  const { endsAt, lockAt } = trialTimelineOf(trialStartedAt);
  const lead = TRIAL_REMINDER_DAYS * DAY_MS;
  const t = now.getTime();
  const daysUntil = (deadline: Date) => Math.ceil((deadline.getTime() - t) / DAY_MS);
  if (t < endsAt.getTime() - lead || t >= lockAt.getTime()) return null;
  if (t < endsAt.getTime()) return { stage: 'ending-soon', daysLeft: daysUntil(endsAt) };
  if (t < lockAt.getTime() - lead) return { stage: 'ended', daysLeft: null };
  return { stage: 'locking-soon', daysLeft: daysUntil(lockAt) };
}

/** Where the mail's buttons go: Billing's Subscribe step, and Your data (the records export). `/` keeps both keys (MUT-418 D14). */
export function trialMailLinks(portalOrigin: string): { subscribe: string; export: string } {
  const origin = portalOrigin.replace(/\/+$/, '');
  return { subscribe: `${origin}/?billing=true&step=subscribe`, export: `${origin}/?yourData=true` };
}

export interface TrialMailRow extends TrialMailStageNow {
  userId: string;
  email: string;
  locale: UserLocale;
  action: 'send' | 'skip';
  skip: TrialMailSkip | null;
  /** The mailer's answer; null on a skip or a dry run. */
  outcome: SendResult['status'] | null;
}

export interface TrialMailSummary {
  dryRun: boolean;
  /** People the run looked at in a reminder window. */
  checked: number;
  /** Rows that were (or, in a dry run, would be) mailed. */
  due: number;
  sent: number;
  duplicate: number;
  /** Due but not sent: mail off, capped, provider failure, or an address refused or suppressed since the plan. */
  notSent: number;
  skipped: { paying: number; covered: number; otherProfiles: number; suppressed: number; gateOff: number };
  /** R1: the time budget ran out; the next run picks up the rest (every window lasts at least three days). */
  incomplete: boolean;
}

export interface TrialMailRunOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: Pick<LedgerStore, 'billing' | 'memberships' | 'organizations' | 'integrations' | 'email'>;
  mailer: Mailer;
  logger: Logger;
  /** One instant for the whole run: every stage and entitlement is judged at it. */
  now: Date;
  /** BILLING_GATE: off, nobody goes read-only or locks, so nothing is mailed (R5). */
  gateOn: boolean;
  links: { subscribe: string; export: string };
  dryRun: boolean;
  /** R1 (R9): elapsed milliseconds on the run's own clock, separate from `now`. Defaults to a monotonic timer. */
  elapsedMs?: () => number;
  budgetMs?: number;
}

/** One pass over everyone in a reminder window, oldest trial first, one person at a time (D12). */
export async function runTrialMail(options: TrialMailRunOptions): Promise<{ summary: TrialMailSummary; rows: TrialMailRow[] }> {
  const { store, now, dryRun } = options;
  const started = performance.now();
  const elapsed = options.elapsedMs ?? (() => performance.now() - started);
  const budget = options.budgetMs ?? TRIAL_MAIL_TIME_BUDGET_MS;
  // Started after `now − 30 d` (not yet locked) and at most `now − 11 d` (the first window has opened).
  const candidates = await store.billing.trialMailCandidates({
    startedAfter: new Date(now.getTime() - TRIAL_LOCK_DAYS * DAY_MS),
    startedUpTo: new Date(now.getTime() - (TRIAL_DAYS - TRIAL_REMINDER_DAYS) * DAY_MS),
  });

  const rows: TrialMailRow[] = [];
  let incomplete = false;
  for (const candidate of candidates) {
    if (elapsed() > budget) {
      incomplete = true;
      break;
    }
    const stage = trialMailStageOf(candidate.trialStartedAt, now);
    if (!stage) continue;
    const skip = await skipReason(options, candidate.userId, candidate.email);
    const row: TrialMailRow = { userId: candidate.userId, email: candidate.email, locale: candidate.locale, ...stage, action: skip ? 'skip' : 'send', skip, outcome: null };
    if (!skip && !dryRun) row.outcome = (await send(options, row)).status;
    rows.push(row);
  }

  const summary = summarize(rows, dryRun, incomplete);
  options.logger.info({ trialMail: summary }, dryRun ? 'trial mail dry run' : 'trial mail run');
  return { summary, rows };
}

async function skipReason(options: TrialMailRunOptions, userId: string, email: string): Promise<TrialMailSkip | null> {
  const { store, now } = options;
  const profiles = await memberProfilesForBilling(store, userId);
  const entitlements = profiles.length > 0 ? await entitlementsFor(store, profiles, now) : new Map<string, Entitlement>();
  const own = profiles.filter((p) => profileOwnerOf(p.organization) === userId).map((p) => entitlements.get(p.organization.id)!);
  if (own.some((e) => e.source === 'STRIPE')) return 'paying';
  if (own.some((e) => e.source === 'MALAFAT' || e.source === 'OPERATOR')) return 'covered';
  if (profiles.length === 0 || own.length !== profiles.length || own.some((e) => e.source !== 'TRIAL')) return 'other-profiles';
  if (!options.gateOn) return 'gate-off';
  if (await store.email.isSuppressed(normalizeEmail(email))) return 'suppressed';
  return null;
}

function send(options: TrialMailRunOptions, row: TrialMailRow): Promise<SendResult> {
  const { links } = options;
  const to = row.email;
  const base = { to, locale: row.locale, idempotencyKey: `trial:${row.userId}:${row.stage}` };
  const daysLeft = row.daysLeft ?? TRIAL_REMINDER_DAYS;
  switch (row.stage) {
    case 'ending-soon':
      return options.mailer.send({ ...base, template: 'trial-ending-soon', vars: { daysLeft, subscribeLink: links.subscribe } });
    case 'ended':
      return options.mailer.send({ ...base, template: 'trial-ended', vars: { subscribeLink: links.subscribe, exportLink: links.export } });
    case 'locking-soon':
      return options.mailer.send({ ...base, template: 'trial-locking-soon', vars: { daysLeft, subscribeLink: links.subscribe, exportLink: links.export } });
  }
}

function summarize(rows: readonly TrialMailRow[], dryRun: boolean, incomplete: boolean): TrialMailSummary {
  const count = (pick: (r: TrialMailRow) => boolean) => rows.filter(pick).length;
  const skipped = (reason: TrialMailSkip) => count((r) => r.skip === reason);
  return {
    dryRun,
    checked: rows.length,
    due: count((r) => r.action === 'send'),
    sent: count((r) => r.outcome === 'sent'),
    duplicate: count((r) => r.outcome === 'duplicate'),
    notSent: count((r) => r.outcome !== null && r.outcome !== 'sent' && r.outcome !== 'duplicate'),
    skipped: { paying: skipped('paying'), covered: skipped('covered'), otherProfiles: skipped('other-profiles'), suppressed: skipped('suppressed'), gateOff: skipped('gate-off') },
    incomplete,
  };
}
