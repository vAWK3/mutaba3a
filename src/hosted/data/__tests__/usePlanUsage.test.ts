import { describe, expect, it } from 'vitest';
import type { PlanUsage, StarterMeter } from '../planUsage';
import { giftBeforeTyping } from '../usePlanUsage';

/** MUT-733: the gift known before the person types (a paid meter at its cap, the gift unused, not running). */

const meter = (used: number, limit: number, level: StarterMeter['level'], graceUntil: string | null = null): StarterMeter => ({ meter: 'documents', used, limit, level, left: Math.max(0, limit - used), graceUntil });
const usage = (plan: PlanUsage['plan'], documents: StarterMeter, giftAvailable = true): PlanUsage => ({ plan, resetsOn: '2026-12-01', documents, scans: { ...meter(0, 100, 'ok'), meter: 'scans' }, giftAvailable });

describe('giftBeforeTyping', () => {
  it('offers the gift on Solo and Business at the cap, naming the next plan', () => {
    expect(giftBeforeTyping(usage('solo', meter(50, 50, 'at_cap')), 'documents')).toEqual({ limit: 'documents', used: 50, cap: 50, resetsOn: '2026-12-01', nextPlan: 'business', canUpgrade: true, gift: true });
    expect(giftBeforeTyping(usage('business', meter(250, 250, 'at_cap')), 'documents')?.nextPlan).toBe('firm');
  });

  it('nothing below the cap, once the gift is used or running, on Firm, or on Starter', () => {
    expect(giftBeforeTyping(usage('solo', meter(49, 50, 'nudge')), 'documents')).toBeNull();
    expect(giftBeforeTyping(usage('solo', meter(50, 50, 'at_cap'), false), 'documents')).toBeNull();
    expect(giftBeforeTyping(usage('solo', meter(63, 50, 'at_cap', '2026-11-30T22:00:00.000Z')), 'documents')).toBeNull();
    expect(giftBeforeTyping(usage('firm', meter(1000, 1000, 'at_cap')), 'documents')).toBeNull();
    expect(giftBeforeTyping(usage('starter', meter(3, 3, 'at_cap')), 'documents')).toBeNull();
    expect(giftBeforeTyping(null, 'documents')).toBeNull();
  });
});
