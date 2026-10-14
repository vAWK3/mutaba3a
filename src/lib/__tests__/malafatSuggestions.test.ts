import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MALAFAT_CLIENT_THRESHOLD,
  dismissMoment,
  malafatSuggestionsEnabled,
  pickClientsMoment,
  resolveMalafatSuggestions,
  shouldMarkBusinessAdded,
  showBusinessAddedNote,
} from '../malafatSuggestions';

/** The rules for when Mutaba3a suggests Malafat in the local web app (MUT-190, epic MUT-189). */
describe('resolveMalafatSuggestions', () => {
  it('reads a row without the field as on, nothing dismissed (old rows, imported backups)', () => {
    expect(resolveMalafatSuggestions(undefined)).toEqual({ on: true, dismissed: [] });
  });

  it('keeps known dismissals once each and drops anything else', () => {
    const stored = { off: true, dismissed: ['client-threshold', 'nonsense', 'client-threshold', 7] } as never;
    expect(resolveMalafatSuggestions(stored)).toEqual({ on: false, dismissed: ['client-threshold'] });
  });
});

describe('dismissMoment', () => {
  it('adds the moment once, keeping the switch as it is', () => {
    const next = dismissMoment({ on: false, dismissed: ['client-threshold'] }, 'client-threshold');
    expect(next).toEqual({ on: false, dismissed: ['client-threshold'] });
  });

  it('retires the business-added note and the second-business card together, from either one: one event, one suggestion', () => {
    for (const moment of ['business-profile', 'second-business'] as const) {
      expect(dismissMoment({ on: true, dismissed: [] }, moment).dismissed.sort()).toEqual(['business-profile', 'second-business']);
    }
    expect(dismissMoment({ on: true, dismissed: [] }, 'client-threshold').dismissed).toEqual(['client-threshold']);
  });
});

describe('pickClientsMoment', () => {
  const on = { on: true, dismissed: [] };

  it('suggests at the client threshold, not one below it', () => {
    expect(MALAFAT_CLIENT_THRESHOLD).toBe(10);
    expect(pickClientsMoment({ suggestions: on, clientCount: 9, businessCount: 1 })).toBeNull();
    expect(pickClientsMoment({ suggestions: on, clientCount: 10, businessCount: 1 })).toBe('client-threshold');
  });

  it('suggests a second business once there are two, and prefers the client threshold when both hold', () => {
    expect(pickClientsMoment({ suggestions: on, clientCount: 2, businessCount: 2 })).toBe('second-business');
    expect(pickClientsMoment({ suggestions: on, clientCount: 12, businessCount: 3 })).toBe('client-threshold');
  });

  it('skips a dismissed moment, and says nothing when suggestions are off', () => {
    const dismissed = { on: true, dismissed: ['client-threshold' as const] };
    expect(pickClientsMoment({ suggestions: dismissed, clientCount: 12, businessCount: 2 })).toBe('second-business');
    expect(pickClientsMoment({ suggestions: { on: false, dismissed: [] }, clientCount: 12, businessCount: 2 })).toBeNull();
  });
});

describe('showBusinessAddedNote', () => {
  const on = { on: true, dismissed: [] };

  it('shows right after a business was added while two or more are live', () => {
    expect(showBusinessAddedNote({ suggestions: on, businessAdded: true, businessCount: 2 })).toBe(true);
  });

  it('never for the first business, an archived one, when off, dismissed, or not just added', () => {
    expect(showBusinessAddedNote({ suggestions: on, businessAdded: true, businessCount: 1 })).toBe(false);
    expect(showBusinessAddedNote({ suggestions: on, businessAdded: false, businessCount: 3 })).toBe(false);
    expect(showBusinessAddedNote({ suggestions: { on: false, dismissed: [] }, businessAdded: true, businessCount: 2 })).toBe(false);
    expect(
      showBusinessAddedNote({ suggestions: { on: true, dismissed: ['business-profile'] }, businessAdded: true, businessCount: 2 }),
    ).toBe(false);
  });
});

describe('malafatSuggestionsEnabled', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is the web build only (desktop is retired until v2)', () => {
    vi.stubGlobal('__BUILD_MODE__', 'web');
    expect(malafatSuggestionsEnabled()).toBe(true);
    vi.stubGlobal('__BUILD_MODE__', 'desktop');
    expect(malafatSuggestionsEnabled()).toBe(false);
  });

  it('is off where no build mode is defined (the test runner)', () => {
    expect(malafatSuggestionsEnabled()).toBe(false);
  });
});

describe('shouldMarkBusinessAdded', () => {
  it('marks a business added while another already exists, in the person\'s own data', () => {
    expect(shouldMarkBusinessAdded({ liveBusinesses: 2, sample: false, demo: false })).toBe(true);
  });

  it('never for the first business (onboarding), nor inside the visitor sample or demo data', () => {
    expect(shouldMarkBusinessAdded({ liveBusinesses: 1, sample: false, demo: false })).toBe(false);
    expect(shouldMarkBusinessAdded({ liveBusinesses: 3, sample: true, demo: false })).toBe(false);
    expect(shouldMarkBusinessAdded({ liveBusinesses: 3, sample: false, demo: true })).toBe(false);
  });
});
