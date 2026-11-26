import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, type BillingOverview } from '../../api/client';
import { documentRefusedNow, hideNudge, homeNoticeOf, limitFromUsage, nudgeHidden, nudgeHideKey, planLimitOf, starterUsageOf, upgradeOffered, type StarterUsage } from '../planUsage';

/** MUT-731 (ADR-284): what the portal shows for Starter's limits, from GET /v1/billing `usage` and 409 PLAN_LIMIT. */

type Level = 'ok' | 'near' | 'nudge' | 'at_cap';
const usageOf = (documents: [number, Level], scans: [number, Level], plan = 'starter') =>
  ({
    usage: {
      month: '2026-11',
      resetsOn: '2026-12-01',
      plan,
      meters: [
        { meter: 'documents', used: documents[0], limit: plan === 'starter' ? 3 : null, level: documents[1] },
        { meter: 'scans', used: scans[0], limit: plan === 'starter' ? 12 : null, level: scans[1] },
      ],
      businesses: { used: 1, limit: 1 },
      partners: { limit: 0 },
    },
  }) as unknown as Pick<BillingOverview, 'usage'>;

afterEach(() => localStorage.clear());

describe('starterUsageOf', () => {
  it('reads both meters on Starter, with what is left', () => {
    expect(starterUsageOf(usageOf([2, 'nudge'], [7, 'ok']))).toEqual({
      resetsOn: '2026-12-01',
      documents: { meter: 'documents', used: 2, limit: 3, level: 'nudge', left: 1 },
      scans: { meter: 'scans', used: 7, limit: 12, level: 'ok', left: 5 },
    });
  });

  it('is null on any other plan, or with no usage (an older server)', () => {
    expect(starterUsageOf(usageOf([2, 'ok'], [7, 'ok'], 'solo'))).toBeNull();
    expect(starterUsageOf(undefined)).toBeNull();
  });
});

describe('planLimitOf', () => {
  it('reads a 409 PLAN_LIMIT’s details', () => {
    const error = new ApiError(409, 'PLAN_LIMIT', 'used up', { limit: 'documents', plan: 'starter', used: 3, cap: 3, resetsOn: '2026-12-01', nextPlan: 'solo', canUpgrade: true });
    expect(planLimitOf(error)).toEqual({ limit: 'documents', used: 3, cap: 3, resetsOn: '2026-12-01', nextPlan: 'solo', canUpgrade: true });
    expect(upgradeOffered(planLimitOf(error)!)).toBe(true);
  });

  it('is null for any other answer', () => {
    expect(planLimitOf(new ApiError(409, 'CONFLICT', 'x', { reason: 'PLAN_LIMIT' }))).toBeNull();
    expect(planLimitOf(new Error('x'))).toBeNull();
  });

  it('no Upgrade where nothing can be bought', () => {
    expect(upgradeOffered({ limit: 'scans', nextPlan: 'solo', canUpgrade: false })).toBe(false);
  });
});

describe('documentRefusedNow (Basel 2026-11-25)', () => {
  const at = starterUsageOf(usageOf([3, 'at_cap'], [0, 'ok']));
  it('refuses a new document at 3 of 3, never a receipt paying an issued document', () => {
    expect(documentRefusedNow(at, 'TAX_INVOICE', null)).toBe(true);
    expect(documentRefusedNow(at, 'CREDIT_NOTE', null)).toBe(true);
    expect(documentRefusedNow(at, 'RECEIPT', 'doc-1')).toBe(false);
    expect(documentRefusedNow(at, 'RECEIPT', null)).toBe(true);
  });

  it('refuses nothing below the cap or off Starter', () => {
    expect(documentRefusedNow(starterUsageOf(usageOf([2, 'nudge'], [0, 'ok'])), 'TAX_INVOICE', null)).toBe(false);
    expect(documentRefusedNow(null, 'TAX_INVOICE', null)).toBe(false);
  });

  it('builds the refusal the server would answer from the usage held', () => {
    expect(limitFromUsage(at!, 'documents', { configured: true, catalog: { ILS: { month: 2900, year: 29000 }, USD: null } } as never)).toEqual({ limit: 'documents', used: 3, cap: 3, resetsOn: '2026-12-01', nextPlan: 'solo', canUpgrade: true });
  });
});

describe('homeNoticeOf (wireframe 7, 13554 #5)', () => {
  const none = () => false;
  it('nothing at ok; the fuller meter otherwise (scans on a tie)', () => {
    expect(homeNoticeOf(starterUsageOf(usageOf([0, 'ok'], [7, 'ok'])), none)).toBeNull();
    expect(homeNoticeOf(starterUsageOf(usageOf([1, 'near'], [11, 'nudge'])), none)?.meter).toBe('scans');
    expect(homeNoticeOf(starterUsageOf(usageOf([3, 'at_cap'], [11, 'nudge'])), none)?.meter).toBe('documents');
    expect(homeNoticeOf(starterUsageOf(usageOf([1, 'near'], [10, 'near'])), none)?.meter).toBe('scans');
  });

  it('a hidden nudge stays hidden until the limit; the limit itself can’t be hidden', () => {
    const usage = starterUsageOf(usageOf([0, 'ok'], [11, 'nudge']))!;
    hideNudge(nudgeHideKey(usage.resetsOn, 'scans'));
    expect(homeNoticeOf(usage, nudgeHidden)).toBeNull();
    const atCap: StarterUsage = { ...usage, scans: { ...usage.scans, used: 12, level: 'at_cap', left: 0 } };
    expect(homeNoticeOf(atCap, nudgeHidden)?.level).toBe('at_cap');
  });

  it('hiding is per month and per meter', () => {
    hideNudge(nudgeHideKey('2026-12-01', 'scans'));
    expect(nudgeHidden(nudgeHideKey('2027-01-01', 'scans'))).toBe(false);
    expect(nudgeHidden(nudgeHideKey('2026-12-01', 'documents'))).toBe(false);
  });
});
