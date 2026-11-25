import { describe, expect, it } from 'vitest';
import { capOf, levelOf, meterView } from '../caps.js';
import { assertDetail, DETAIL_VOCABULARY, doorOf, meterOf, USAGE_KINDS } from '../kinds.js';
import { lastMonths, resetsOn, usageMonthOf } from '../month.js';
import { BUCKET_UPPER_MS, bucketOf, p95Of } from '../route-buckets.js';
import { subjectKeyOf } from '../subject.js';

/** MUT-735 (ADR-281): the metering model's pure rules. */

describe('usageMonthOf: the Asia/Jerusalem calendar month', () => {
  it('turns over at Jerusalem midnight in winter (UTC+2)', () => {
    expect(usageMonthOf(new Date('2026-12-31T21:59:59Z'))).toBe('2026-12');
    expect(usageMonthOf(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01');
  });

  it('turns over at Jerusalem midnight in summer (UTC+3)', () => {
    expect(usageMonthOf(new Date('2026-07-31T20:59:59Z'))).toBe('2026-07');
    expect(usageMonthOf(new Date('2026-07-31T21:00:00Z'))).toBe('2026-08');
  });

  it('does not depend on the server timezone', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(usageMonthOf(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01');
    } finally {
      process.env.TZ = before;
    }
  });

  it('resets on the first of the next month', () => {
    expect(resetsOn('2026-12')).toBe('2027-01-01');
    expect(resetsOn('2026-02')).toBe('2026-03-01');
  });

  it('lists the last n months, oldest first', () => {
    expect(lastMonths('2027-02', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(lastMonths('2026-06', 1)).toEqual(['2026-06']);
  });
});

describe('kinds and meters', () => {
  it('meters every issued document type (Basel 2026-11-25: every type counts)', () => {
    expect(meterOf('DOCUMENT_ISSUED')).toBe('DOCUMENTS');
    for (const docType of ['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT', 'PAYMENT_REQUEST']) expect(() => assertDetail('DOCUMENT_ISSUED', docType)).not.toThrow();
  });

  it('meters scans, and nothing else', () => {
    expect(meterOf('SCAN')).toBe('SCANS');
    for (const kind of USAGE_KINDS.filter((k) => k !== 'DOCUMENT_ISSUED' && k !== 'SCAN')) expect(meterOf(kind)).toBeNull();
  });

  it('accepts only the closed detail vocabulary: no free text, no amounts, no names', () => {
    expect(() => assertDetail('SCAN', 'LIBRARY')).not.toThrow();
    expect(() => assertDetail('SCAN', 'EXPENSE')).not.toThrow();
    expect(() => assertDetail('SCAN', 'Cafe Aroma 42.50')).toThrow(/detail/);
    expect(() => assertDetail('DOCUMENT_ISSUED', 'tax invoice')).toThrow(/detail/);
    expect(() => assertDetail('ALLOCATION_REQUESTED', 'AUTOMATIC')).not.toThrow();
    // A kind with no vocabulary takes no detail at all.
    expect(() => assertDetail('PROFILE_CREATED', null)).not.toThrow();
    expect(() => assertDetail('PROFILE_CREATED', 'x')).toThrow(/detail/);
  });

  it('every vocabulary value is an upper-case code', () => {
    for (const values of Object.values(DETAIL_VOCABULARY)) for (const v of values ?? []) expect(v).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it('names the door from the principal', () => {
    expect(doorOf({ kind: 'session', sessionKind: 'cookie', delegated: false })).toBe('PORTAL');
    expect(doorOf({ kind: 'session', sessionKind: 'device', delegated: false })).toBe('PHONE');
    expect(doorOf({ kind: 'session', sessionKind: null, delegated: true })).toBe('MALAFAT');
    expect(doorOf({ kind: 'apiKey' })).toBe('MALAFAT');
    expect(doorOf({ kind: 'agent' })).toBe('MCP');
    expect(doorOf({ kind: 'operator' })).toBe('OPERATOR');
    expect(doorOf({ kind: 'job' })).toBe('JOB');
  });
});

describe('subjectKeyOf: who pays', () => {
  it('a business profile is its creator’s, whoever acts on it', () => {
    expect(subjectKeyOf({ id: 'o1', ownerUserId: 'u-creator', personalOwnerUserId: null })).toBe('user:u-creator');
  });
  it('a personal profile is its owner’s', () => {
    expect(subjectKeyOf({ id: 'o2', ownerUserId: null, personalOwnerUserId: 'u-me' })).toBe('user:u-me');
  });
  it('an operator-provisioned firm with no owner is the profile’s own', () => {
    expect(subjectKeyOf({ id: 'o3', ownerUserId: null, personalOwnerUserId: null })).toBe('org:o3');
  });
});

describe('caps', () => {
  it('reads the paid plans’ monthly limits from PLAN_LIMITS', () => {
    expect([capOf('solo', 'DOCUMENTS'), capOf('solo', 'SCANS')]).toEqual([50, 100]);
    expect([capOf('business', 'DOCUMENTS'), capOf('business', 'SCANS')]).toEqual([250, 500]);
    expect([capOf('firm', 'DOCUMENTS'), capOf('firm', 'SCANS')]).toEqual([1000, 2000]);
  });

  it('has no cap for Malafat, no plan, legacy Freelancer, or Starter until MUT-731 sets its row', () => {
    for (const plan of ['malafat', 'none', 'freelancer', 'starter'] as const) expect(capOf(plan, 'DOCUMENTS')).toBeNull();
  });

  it('levels: ok below 80%, near from 80%, nudge from 90%, at_cap at the limit', () => {
    expect(levelOf(39, 50)).toBe('ok');
    expect(levelOf(40, 50)).toBe('near');
    expect(levelOf(45, 50)).toBe('nudge');
    expect(levelOf(50, 50)).toBe('at_cap');
    expect(levelOf(51, 50)).toBe('at_cap');
    expect(levelOf(10_000, null)).toBe('ok');
    expect(levelOf(0, 0)).toBe('at_cap');
  });

  it('a meter view names the meter in lower case, with its limit and level', () => {
    expect(meterView('DOCUMENTS', 41, 'solo')).toEqual({ meter: 'documents', used: 41, limit: 50, level: 'near' });
    expect(meterView('SCANS', 7, 'malafat')).toEqual({ meter: 'scans', used: 7, limit: null, level: 'ok' });
  });
});

describe('route buckets', () => {
  it('puts a duration in the first bucket whose upper bound holds it', () => {
    expect(BUCKET_UPPER_MS).toHaveLength(12);
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(5)).toBe(0);
    expect(bucketOf(5.0001)).toBe(1);
    expect(bucketOf(10_000)).toBe(10);
    expect(bucketOf(10_001)).toBe(11);
  });

  it('p95 is the upper bound of the bucket where the cumulative share crosses 95%', () => {
    const uniform = Array.from({ length: 12 }, () => 0);
    uniform[3] = 100; // all at ≤50 ms
    expect(p95Of(uniform)).toEqual({ p95Ms: 50, over: false });
    const skewed = Array.from({ length: 12 }, () => 0);
    skewed[0] = 94;
    skewed[7] = 6; // 94% ≤5 ms, then ≤1000 ms
    expect(p95Of(skewed)).toEqual({ p95Ms: 1000, over: false });
    const slow = Array.from({ length: 12 }, () => 0);
    slow[11] = 3;
    expect(p95Of(slow)).toEqual({ p95Ms: 10_000, over: true });
  });

  it('no requests: no p95', () => {
    expect(p95Of(Array.from({ length: 12 }, () => 0))).toBeNull();
  });
});
