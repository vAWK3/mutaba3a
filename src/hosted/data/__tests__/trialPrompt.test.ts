import { describe, expect, it } from 'vitest';
import type { Me } from '../../api/client';
import { TRIAL_BANNER_LAST_DAYS, optimisticTrialPrompt, trialBannerOf, trialWelcomeDue } from '../trialPrompt';

/**
 * MUT-418: when the first-run "Your free trial has started" step is due, and what the Home trial banner shows.
 * Pure: both read /v1/me and a clock.
 */

const NOW = new Date('2026-11-01T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const EMPTY = { welcomedAt: null, welcomeAnswer: null, bannerSnoozedUntil: null } as const;

type Billing = Me['profiles'][number]['billing'];
const trial = (endsInDays: number): Billing => ({ state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: inDays(endsInDays) });

function me({ billing = trial(14), prompt = EMPTY, status = 'ACTIVE', personal = true }: { billing?: Billing; prompt?: Me['user']['trialPrompt']; status?: Me['user']['status']; personal?: boolean } = {}): Me {
  return {
    user: { id: 'u', email: 'rana@studio.example', displayName: 'Rana', locale: 'en', malafatSuggestions: { off: false, dismissed: [] }, trialPrompt: prompt, status },
    profiles: [
      { id: 'biz', isPersonalDefault: false, billing: { state: 'ACTIVE', source: 'OPERATOR', tier: 'FREELANCER', until: null } },
      { id: 'mine', isPersonalDefault: personal, billing },
    ],
  } as unknown as Me;
}

describe('trialWelcomeDue', () => {
  it('is due for a new trial nobody has answered', () => {
    expect(trialWelcomeDue(me(), NOW)).toBe(true);
  });

  it('reads the person’s own trial, on their personal profile', () => {
    expect(trialWelcomeDue(me({ personal: false }), NOW)).toBe(false);
  });

  it('is not due once answered, on any device', () => {
    expect(trialWelcomeDue(me({ prompt: { welcomedAt: NOW.toISOString(), welcomeAnswer: 'skipped', bannerSnoozedUntil: null } }), NOW)).toBe(false);
  });

  it('is not due with a card on file (Stripe pays), a grant, or no trial at all', () => {
    expect(trialWelcomeDue(me({ billing: { state: 'ACTIVE', source: 'STRIPE', tier: 'FREELANCER', until: inDays(14) } }), NOW)).toBe(false);
    expect(trialWelcomeDue(me({ billing: { state: 'ACTIVE', source: 'OPERATOR', tier: 'FREELANCER', until: null } }), NOW)).toBe(false);
    expect(trialWelcomeDue(me({ billing: { state: 'READ_ONLY', source: 'NONE', tier: null, until: null } }), NOW)).toBe(false);
    expect(trialWelcomeDue(me({ billing: null }), NOW)).toBe(false);
  });

  it('is not due inside the trial’s last 48 hours: "You won’t be charged until" would be false (D3)', () => {
    expect(trialWelcomeDue(me({ billing: trial(2) }), NOW)).toBe(true);
    expect(trialWelcomeDue(me({ billing: trial(1.9) }), NOW)).toBe(false);
  });

  it('is never due for an account that is not active', () => {
    expect(trialWelcomeDue(me({ status: 'PENDING_REVIEW' }), NOW)).toBe(false);
  });

  it('a server too old to report the prompt counts as nothing answered', () => {
    const old = me();
    delete (old.user as Partial<Me['user']>).trialPrompt;
    expect(trialWelcomeDue(old, NOW)).toBe(true);
  });
});

describe('trialBannerOf', () => {
  it('shows the whole days left and the trial end while the trial runs with no card', () => {
    expect(trialBannerOf(me({ billing: trial(13.5) }), NOW)).toEqual({ kind: 'trial', daysLeft: 14, endsAt: inDays(13.5), dismissible: true });
  });

  it('is gone once a card or subscription exists (the profile is paid by Stripe), or the trial is over', () => {
    expect(trialBannerOf(me({ billing: { state: 'ACTIVE', source: 'STRIPE', tier: 'FREELANCER', until: inDays(14) } }), NOW)).toBeNull();
    expect(trialBannerOf(me({ billing: { state: 'READ_ONLY', source: 'TRIAL', tier: 'FREELANCER', until: inDays(16) } }), NOW)).toBeNull();
  });

  it('hidden for 3 days after the person hides it, then back', () => {
    const snoozed = (until: string) => me({ prompt: { ...EMPTY, bannerSnoozedUntil: until } });
    expect(trialBannerOf(snoozed(inDays(1)), NOW)).toBeNull();
    expect(trialBannerOf(snoozed(inDays(-0.01)), NOW)).toMatchObject({ kind: 'trial', dismissible: true });
  });

  it(`can't be hidden in the trial's last ${TRIAL_BANNER_LAST_DAYS} days, and a snooze doesn't hide it there`, () => {
    expect(trialBannerOf(me({ billing: trial(3) }), NOW)).toMatchObject({ daysLeft: 3, dismissible: false });
    expect(trialBannerOf(me({ billing: trial(3.5) }), NOW)).toMatchObject({ daysLeft: 4, dismissible: true });
    expect(trialBannerOf(me({ billing: trial(2), prompt: { ...EMPTY, bannerSnoozedUntil: inDays(2) } }), NOW)).toMatchObject({ daysLeft: 2, dismissible: false });
  });
});

describe('optimisticTrialPrompt', () => {
  it('answers the welcome once, and snoozes the banner 3 days from now', () => {
    expect(optimisticTrialPrompt(undefined, 'welcome-accepted', NOW)).toEqual({ welcomedAt: NOW.toISOString(), welcomeAnswer: 'accepted', bannerSnoozedUntil: null });
    const answered = optimisticTrialPrompt(EMPTY, 'welcome-skipped', NOW);
    expect(optimisticTrialPrompt(answered, 'welcome-accepted', NOW)).toEqual(answered);
    expect(optimisticTrialPrompt(answered, 'banner-snoozed', NOW)).toEqual({ ...answered, bannerSnoozedUntil: inDays(3) });
  });
});
