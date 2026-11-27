import { describe, expect, it } from 'vitest';
import { hardCapOf } from '../caps.js';
import { giftAvailable, giftCovers, giftUntil, NO_GIFT } from '../gift.js';

/** MUT-733 (ADR-292): the gift's rule and the paid hard caps. */
const USED = { usedAt: new Date('2026-11-20T10:00:00Z'), meter: 'DOCUMENTS' as const, month: '2026-11' };

describe('giftCovers / giftAvailable', () => {
  it('covers only the meter that was hit, only in its month', () => {
    expect(giftCovers(USED, 'DOCUMENTS', '2026-11')).toBe(true);
    expect(giftCovers(USED, 'SCANS', '2026-11')).toBe(false);
    expect(giftCovers(USED, 'DOCUMENTS', '2026-12')).toBe(false);
    expect(giftCovers(NO_GIFT, 'DOCUMENTS', '2026-11')).toBe(false);
  });

  it('is offered once, on Solo and Business with the flag; never on Starter, Firm or Freelancer', () => {
    expect(giftAvailable(NO_GIFT, 'solo', true)).toBe(true);
    expect(giftAvailable(NO_GIFT, 'business', true)).toBe(true);
    expect(giftAvailable(USED, 'solo', true)).toBe(false);
    for (const plan of ['starter', 'firm', 'freelancer', 'malafat', 'none'] as const) expect(giftAvailable(NO_GIFT, plan, true)).toBe(false);
    expect(giftAvailable(NO_GIFT, 'solo', false)).toBe(false);
  });

  it('runs until the first instant of the next Jerusalem month (winter and summer offsets)', () => {
    expect(giftUntil('2026-11').toISOString()).toBe('2026-11-30T22:00:00.000Z');
    expect(giftUntil('2026-06').toISOString()).toBe('2026-06-30T21:00:00.000Z');
    expect(giftUntil('2026-12').toISOString()).toBe('2026-12-31T22:00:00.000Z');
  });
});

describe('hardCapOf with the paid rule', () => {
  const rule = { paidHardCaps: true, giftMeter: null, giftAvailable: true };
  it('Starter is always capped; Solo and Business only with the flag; Firm never', () => {
    expect(hardCapOf('starter', 'DOCUMENTS')).toBe(3);
    expect(hardCapOf('solo', 'DOCUMENTS')).toBeNull();
    expect(hardCapOf('solo', 'DOCUMENTS', rule)).toBe(50);
    expect(hardCapOf('business', 'SCANS', rule)).toBe(500);
    expect(hardCapOf('firm', 'DOCUMENTS', rule)).toBeNull();
    expect(hardCapOf('freelancer', 'DOCUMENTS', rule)).toBeNull();
  });

  it('the gifted meter has no cap; the other keeps it', () => {
    const gifted = { ...rule, giftMeter: 'DOCUMENTS' as const, giftAvailable: false };
    expect(hardCapOf('solo', 'DOCUMENTS', gifted)).toBeNull();
    expect(hardCapOf('solo', 'SCANS', gifted)).toBe(100);
  });
});
