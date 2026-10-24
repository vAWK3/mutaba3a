import { describe, expect, it } from 'vitest';
import { BANNER_SNOOZE_DAYS, applyTrialPromptAction, resolveTrialPrompt } from '../trial-prompt.js';

/**
 * MUT-418 (D1, D2): the person's answers to the trial's card prompt, stored on their user row. Pure: the store locks
 * the row and writes what this returns.
 */

const AT = new Date('2026-11-01T09:00:00.000Z');
const LATER = new Date('2026-11-02T10:00:00.000Z');
const EMPTY = { welcomedAt: null, welcomeAnswer: null, bannerSnoozedUntil: null };

describe('resolveTrialPrompt', () => {
  it('nothing stored, or anything malformed, is nothing answered', () => {
    for (const stored of [null, undefined, 'x', 3, [], { welcomedAt: 7, welcomeAnswer: 'maybe', bannerSnoozedUntil: 'not a date' }]) {
      expect(resolveTrialPrompt(stored), JSON.stringify(stored)).toEqual(EMPTY);
    }
  });

  it('keeps well-formed fields and drops the rest', () => {
    expect(resolveTrialPrompt({ welcomedAt: AT.toISOString(), welcomeAnswer: 'skipped', bannerSnoozedUntil: 'junk' })).toEqual({
      welcomedAt: AT.toISOString(),
      welcomeAnswer: 'skipped',
      bannerSnoozedUntil: null,
    });
  });

  it('an answer without its time (or a time without an answer) is not a welcome', () => {
    expect(resolveTrialPrompt({ welcomeAnswer: 'accepted' })).toEqual(EMPTY);
    expect(resolveTrialPrompt({ welcomedAt: AT.toISOString() })).toEqual(EMPTY);
  });
});

describe('applyTrialPromptAction', () => {
  it('a welcome answer records when and what', () => {
    expect(applyTrialPromptAction(null, 'welcome-accepted', AT)).toEqual({ ...EMPTY, welcomedAt: AT.toISOString(), welcomeAnswer: 'accepted' });
    expect(applyTrialPromptAction(null, 'welcome-skipped', AT)).toEqual({ ...EMPTY, welcomedAt: AT.toISOString(), welcomeAnswer: 'skipped' });
  });

  it('the first welcome answer wins: a second device never rewrites it', () => {
    const first = applyTrialPromptAction(null, 'welcome-skipped', AT);
    expect(applyTrialPromptAction(first, 'welcome-accepted', LATER)).toEqual(first);
  });

  it(`hiding the banner snoozes it for ${BANNER_SNOOZE_DAYS} days from now, and again later moves it on`, () => {
    const snoozed = applyTrialPromptAction(null, 'banner-snoozed', AT);
    expect(snoozed).toEqual({ ...EMPTY, bannerSnoozedUntil: '2026-11-04T09:00:00.000Z' });
    expect(applyTrialPromptAction(snoozed, 'banner-snoozed', LATER).bannerSnoozedUntil).toBe('2026-11-05T10:00:00.000Z');
  });

  it('a snooze keeps the welcome answer, and an answer keeps the snooze', () => {
    const answered = applyTrialPromptAction(null, 'welcome-accepted', AT);
    const both = applyTrialPromptAction(answered, 'banner-snoozed', LATER);
    expect(both).toEqual({ welcomedAt: AT.toISOString(), welcomeAnswer: 'accepted', bannerSnoozedUntil: '2026-11-05T10:00:00.000Z' });
    expect(applyTrialPromptAction(applyTrialPromptAction(null, 'banner-snoozed', AT), 'welcome-skipped', LATER).bannerSnoozedUntil).toBe('2026-11-04T09:00:00.000Z');
  });
});
