import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { aboveAllocationThreshold, ALLOCATION_THRESHOLDS, allocationNumberRequired, normalizeAllocationNumber, readAllocationDigits, thresholdOn } from '../allocation-number.js';

/** MUT-557 (D1, D4, R1): the Tax Authority's dated thresholds, before VAT, by the invoice's date; at the threshold counts. */

const shekels = (n: number): bigint => BigInt(Math.round(n * 100));

describe('thresholdOn', () => {
  it.each([
    ['2024-05-04', null],
    ['2024-05-05', shekels(25_000)],
    ['2024-12-31', shekels(25_000)],
    ['2025-01-01', shekels(20_000)],
    ['2026-01-01', shekels(10_000)],
    ['2026-05-31', shekels(10_000)],
    ['2026-06-01', shekels(5_000)],
    ['2030-01-01', shekels(5_000)],
  ] as const)('%s → %s', (date, threshold) => {
    expect(thresholdOn(date)).toBe(threshold);
  });

  it('keeps the table in date order', () => {
    const dates = ALLOCATION_THRESHOLDS.map((t) => t.from);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('aboveAllocationThreshold', () => {
  const base = { currency: 'ILS', occurredOn: '2026-06-01', netMinor: shekels(5_000), vatMinor: shekels(900) };

  it('counts a net exactly at the threshold (R1)', () => {
    expect(aboveAllocationThreshold(base)).toBe(true);
  });
  it('a net one agora under does not count', () => {
    expect(aboveAllocationThreshold({ ...base, netMinor: shekels(4_999.99) })).toBe(false);
  });
  it('the day before 2026-06-01 the threshold is ₪10,000', () => {
    expect(aboveAllocationThreshold({ ...base, occurredOn: '2026-05-31', netMinor: shekels(9_000) })).toBe(false);
    expect(aboveAllocationThreshold({ ...base, occurredOn: '2026-05-31', netMinor: shekels(10_000) })).toBe(true);
  });
  it('before the first threshold nothing is required', () => {
    expect(aboveAllocationThreshold({ ...base, occurredOn: '2024-05-04', netMinor: shekels(100_000) })).toBe(false);
  });
  it('only ILS', () => {
    expect(aboveAllocationThreshold({ ...base, currency: 'USD' })).toBe(false);
  });
  it('only with VAT on the invoice', () => {
    expect(aboveAllocationThreshold({ ...base, vatMinor: 0n })).toBe(false);
  });
  it('an unknown net or VAT is not a guess', () => {
    expect(aboveAllocationThreshold({ ...base, netMinor: null })).toBe(false);
    expect(aboveAllocationThreshold({ ...base, vatMinor: null })).toBe(false);
  });
});

describe('allocationNumberRequired', () => {
  const base = { firm: true, currency: 'ILS', occurredOn: '2026-07-01', vatTreatment: 'STANDARD_RATED', netMinor: shekels(6_000), vatMinor: shekels(1_080) } as const;

  it('a firm profile\'s ILS expense with VAT at or above the threshold', () => {
    expect(allocationNumberRequired(base)).toBe(true);
  });
  it('never on a profile without firm features (a Personal one included)', () => {
    expect(allocationNumberRequired({ ...base, firm: false })).toBe(false);
  });
  it('needs the VAT treatment, net and VAT all recorded (A4)', () => {
    expect(allocationNumberRequired({ ...base, vatTreatment: null })).toBe(false);
    expect(allocationNumberRequired({ ...base, netMinor: null })).toBe(false);
    expect(allocationNumberRequired({ ...base, vatMinor: null })).toBe(false);
  });
  it('a zero-rated or exempt expense carries no VAT to claim', () => {
    expect(allocationNumberRequired({ ...base, vatTreatment: 'ZERO_RATED', vatMinor: 0n })).toBe(false);
  });
});

describe('normalizeAllocationNumber', () => {
  it.each([
    ['123456789', '123456789'],
    ['123 456 789', '123456789'],
    ['123-456-789', '123456789'],
    [' 12345 6789 ', '123456789'],
  ])('%j → %s', (raw, value) => {
    expect(normalizeAllocationNumber(raw)).toBe(value);
  });

  it.each(['12345678', '1234567890', '12345678a', '', '   ', '१२३४५६७८९'])('refuses %j with ALLOCATION_NUMBER_INVALID', (raw) => {
    try {
      normalizeAllocationNumber(raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).details).toMatchObject({ reason: 'ALLOCATION_NUMBER_INVALID', field: 'allocationNumber' });
    }
  });
});

describe('readAllocationDigits', () => {
  it('the same rule without throwing', () => {
    expect(readAllocationDigits('123-456-789')).toBe('123456789');
    expect(readAllocationDigits('12345678')).toBeNull();
  });
});

describe('pasted numbers (review)', () => {
  it.each(['304\u2013512\u2013876', '304\u2212512\u2212876', '\u200F304512876\u200E', '304\uFF0D512\uFF0D876'])('reads %j as the nine digits', (raw) => {
    expect(readAllocationDigits(raw)).toBe('304512876');
  });
});
