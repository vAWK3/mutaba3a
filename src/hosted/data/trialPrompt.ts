import type { BillingEntitlement, Me, TrialPrompt, TrialPromptAction } from '../api/client';

/**
 * MUT-418: the free trial's card prompt, read from /v1/me. Pure, so every branch is a unit test; the step and the
 * banner only render. The trial is the person's own: their personal profile's entitlement is their trial (its owner
 * is always them), whichever profile they have open.
 *
 * MUT-361 seam: `TrialNotice` is a union so the lapse gate can add its read-only and locked notices beside `trial`.
 */

export type TrialNotice = {
  kind: 'trial';
  daysLeft: number;
  endsAt: string;
  dismissible: boolean;
  /** A card added now is first charged on the trial's end (≥ 48 h left); otherwise Checkout charges at once. */
  chargeDeferred: boolean;
};

/** The banner can't be hidden in the trial's last 3 days (ticket). */
export const TRIAL_BANNER_LAST_DAYS = 3;
/** Stripe's minimum for a carried-over trial (server checkout.ts TRIAL_CARRY_MIN_MS): sooner, Checkout charges at once. */
const TRIAL_CARRY_MIN_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The person's running trial with no card: TRIAL ACTIVE (a covering subscription would make it STRIPE). */
function runningTrial(me: Me): (BillingEntitlement & { until: string }) | null {
  const billing = me.profiles.find((p) => p.isPersonalDefault)?.billing;
  if (!billing || billing.source !== 'TRIAL' || billing.state !== 'ACTIVE' || !billing.until) return null;
  return billing as BillingEntitlement & { until: string };
}

/**
 * The first-run step's copy is true: a running trial with no card and ≥ 48 h of it left (D3), so "You won't be
 * charged until <end>" holds. A deep link to `?step=welcome` for anyone else shows Billing's own status instead.
 */
export function trialWelcomeApplies(me: Me, now: Date): boolean {
  const trial = runningTrial(me);
  return trial !== null && new Date(trial.until).getTime() - now.getTime() >= TRIAL_CARRY_MIN_MS;
}

/**
 * The first-run step is due: an active account whose step applies (above), and the person hasn't answered it on any
 * device (D1). A server without the field counts as nothing answered.
 */
export function trialWelcomeDue(me: Me, now: Date): boolean {
  if (me.user.status !== undefined && me.user.status !== 'ACTIVE') return false;
  if (me.user.trialPrompt?.welcomedAt) return false;
  return trialWelcomeApplies(me, now);
}

/** The Home banner: whole days left (rounded up), hidden while snoozed except in the trial's last 3 days. */
export function trialBannerOf(me: Me, now: Date): TrialNotice | null {
  const trial = runningTrial(me);
  if (!trial) return null;
  const daysLeft = Math.max(0, Math.ceil((new Date(trial.until).getTime() - now.getTime()) / DAY_MS));
  const dismissible = daysLeft > TRIAL_BANNER_LAST_DAYS;
  const snoozedUntil = me.user.trialPrompt?.bannerSnoozedUntil;
  if (dismissible && snoozedUntil && new Date(snoozedUntil).getTime() > now.getTime()) return null;
  const chargeDeferred = new Date(trial.until).getTime() - now.getTime() >= TRIAL_CARRY_MIN_MS;
  return { kind: 'trial', daysLeft, endsAt: trial.until, dismissible, chargeDeferred };
}

const SNOOZE_DAYS = 3;

/**
 * What the cached /v1/me should say the moment the person answers, before the server does (the server's answer then
 * replaces it): the step and the banner react at once, and a failed write only means the step may ask once more on
 * the next visit, never that anything is charged.
 */
export function optimisticTrialPrompt(current: TrialPrompt | undefined, action: TrialPromptAction, now: Date): TrialPrompt {
  const base: TrialPrompt = current ?? { welcomedAt: null, welcomeAnswer: null, bannerSnoozedUntil: null };
  if (action === 'banner-snoozed') return { ...base, bannerSnoozedUntil: new Date(now.getTime() + SNOOZE_DAYS * DAY_MS).toISOString() };
  if (base.welcomedAt) return base;
  return { ...base, welcomedAt: now.toISOString(), welcomeAnswer: action === 'welcome-accepted' ? 'accepted' : 'skipped' };
}
