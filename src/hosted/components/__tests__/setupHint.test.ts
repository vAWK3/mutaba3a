import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { HostedProfile, IssuingSetup, Me } from '../../api/client';
import { firstMissingStep, invoicingAvailable, parseSetupStepSearch, rememberSetupHintShown, setupHintKey, setupHintShownOn, useSetupHint } from '../setupHint';

const state = vi.hoisted(() => ({ me: null as unknown, local: false, setup: undefined as unknown, enabled: [] as boolean[] }));
vi.mock('../../session/me', () => ({ useMeOrNull: () => state.me }));
vi.mock('../../session/mode', () => ({ useIsLocalMode: () => state.local }));
vi.mock('../../data/issuingQueries', () => ({
  useIssuingSetup: (_id: string, enabled: boolean) => {
    state.enabled.push(enabled);
    return { data: enabled ? state.setup : undefined };
  },
}));

const me = (features: string[]) => ({ user: { id: 'u1', features } }) as unknown as Pick<Me, 'user'>;
const business = { id: 'p1', type: 'BUSINESS', owned: true, writerOfRecord: null, managedInMalafat: false } as unknown as HostedProfile;
const incomplete = { canIssue: false, missing: ['NUMBERING'] } as unknown as IssuingSetup;

describe('invoicingAvailable (MUT-722 AC4)', () => {
  it('is on for an owned business profile whose person holds invoicing', () => {
    expect(invoicingAvailable(business, me(['invoicing']), false)).toBe(true);
  });
  it('is off on a personal profile, a Malafat firm, one not owned, without the feature, signed out or in local mode', () => {
    expect(invoicingAvailable({ ...business, type: 'PERSONAL' }, me(['invoicing']), false)).toBe(false);
    expect(invoicingAvailable({ ...business, writerOfRecord: 'MALAFAT' }, me(['invoicing']), false)).toBe(false);
    expect(invoicingAvailable({ ...business, managedInMalafat: true } as HostedProfile, me(['invoicing']), false)).toBe(false);
    expect(invoicingAvailable({ ...business, owned: false }, me(['invoicing']), false)).toBe(false);
    expect(invoicingAvailable(business, me([]), false)).toBe(false);
    expect(invoicingAvailable(business, null, false)).toBe(false);
    expect(invoicingAvailable(business, me(['invoicing']), true)).toBe(false);
  });
});

describe('firstMissingStep', () => {
  it('opens on the details while they are missing, else the numbering', () => {
    expect(firstMissingStep({ missing: ['NUMBERING', 'DETAILS'] })).toBe('details');
    expect(firstMissingStep({ missing: ['NUMBERING'] })).toBe('numbering');
    expect(firstMissingStep({ missing: [] })).toBe('details');
  });
});

describe('parseSetupStepSearch', () => {
  it('keeps a known step and drops anything else', () => {
    expect(parseSetupStepSearch({ step: 'numbering' })).toEqual({ step: 'numbering' });
    expect(parseSetupStepSearch({ step: 'nope' })).toEqual({});
    expect(parseSetupStepSearch({})).toEqual({});
  });
});

describe('the once-a-day memory', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('remembers the day per person and profile', () => {
    const key = setupHintKey('u1', 'p1');
    expect(setupHintShownOn(key, '2026-11-25')).toBe(false);
    rememberSetupHintShown(key, '2026-11-25');
    expect(setupHintShownOn(key, '2026-11-25')).toBe(true);
    expect(setupHintShownOn(key, '2026-11-26')).toBe(false);
    expect(setupHintShownOn(setupHintKey('u1', 'p2'), '2026-11-25')).toBe(false);
  });

  it('counts storage that throws as not shown, and never throws itself', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(setupHintShownOn('k', '2026-11-25')).toBe(false);
    expect(() => rememberSetupHintShown('k', '2026-11-25')).not.toThrow();
  });
});

describe('useSetupHint (MUT-722 AC1–AC2)', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(state, { me: me(['invoicing']), local: false, setup: incomplete, enabled: [] });
  });

  it('is due while the setup cannot issue, opens on the first missing step, and is taken once a day', () => {
    const { result } = renderHook(() => useSetupHint(business));
    expect(result.current.due).toBe(true);
    expect(result.current.step).toBe('numbering');
    expect(result.current.takeToday()).toBe(true);
    expect(result.current.takeToday()).toBe(false);
  });

  it('is not due once the setup can issue (MUT-648 offers instead)', () => {
    state.setup = { canIssue: true, missing: [] };
    const { result } = renderHook(() => useSetupHint(business));
    expect(result.current.due).toBe(false);
    expect(result.current.takeToday()).toBe(false);
  });

  it('never asks the server where invoicing is not available', () => {
    const { result } = renderHook(() => useSetupHint({ ...business, type: 'PERSONAL' }));
    expect(result.current.due).toBe(false);
    expect(state.enabled.every((e) => !e)).toBe(true);
  });
});
