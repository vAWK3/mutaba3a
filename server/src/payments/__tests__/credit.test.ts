import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '../../money.js';
import { checkCredit, splitCredit } from '../credit.js';

const ils = (s: string) => parseMoney(s, 'ILS').minor;
const fmt = (n: bigint) => formatMoney({ minor: n, currency: 'ILS' });

describe('splitCredit', () => {
  it.each([
    ['1180.00', 'STANDARD_RATED', 1800, '1000.00', '180.00'],
    ['100.00', 'STANDARD_RATED', 1800, '84.75', '15.25'],
    ['0.01', 'STANDARD_RATED', 1800, '0.01', '0.00'],
    ['0.02', 'STANDARD_RATED', 1800, '0.02', '0.00'],
    ['1234.56', 'STANDARD_RATED', 1600, '1064.28', '170.28'],
    ['1000.00', 'ZERO_RATED', 1800, '1000.00', '0.00'],
    ['1000.00', 'EXEMPT', 1800, '1000.00', '0.00'],
    ['1000.00', 'OUT_OF_SCOPE', 1800, '1000.00', '0.00'],
    ['1000.00', 'STANDARD_RATED', 0, '1000.00', '0.00'],
  ] as const)('%s %s @%ibp → net %s vat %s', (amount, treatment, rate, net, vat) => {
    const split = splitCredit({ amountMinor: ils(amount), treatment, rateBasisPoints: rate });
    expect(fmt(split.netMinor)).toBe(net);
    expect(fmt(split.vatMinor)).toBe(vat);
    expect(split.netMinor + split.vatMinor).toBe(split.amountMinor);
  });

  it('net + vat = credit for a grid of amounts and rates', () => {
    for (const rate of [1600, 1700, 1800, 2000]) {
      for (let minor = 1n; minor < 2000n; minor += 97n) {
        const split = splitCredit({ amountMinor: minor, treatment: 'STANDARD_RATED', rateBasisPoints: rate });
        expect(split.netMinor + split.vatMinor).toBe(minor);
        expect(split.vatMinor).toBeGreaterThanOrEqual(0n);
      }
    }
  });

  it('rejects a non-positive credit and an impossible rate', () => {
    expect(() => splitCredit({ amountMinor: 0n, treatment: 'STANDARD_RATED', rateBasisPoints: 1800 })).toThrow();
    expect(() => splitCredit({ amountMinor: -1n, treatment: 'EXEMPT', rateBasisPoints: 0 })).toThrow();
    expect(() => splitCredit({ amountMinor: 1n, treatment: 'STANDARD_RATED', rateBasisPoints: 10001 })).toThrow();
  });
});

describe('checkCredit', () => {
  it('allows up to the outstanding on an open receivable', () => {
    expect(checkCredit({ amountMinor: 500n, outstandingMinor: 500n, status: 'OPEN' })).toEqual({ ok: true });
    expect(checkCredit({ amountMinor: 501n, outstandingMinor: 500n, status: 'OPEN' })).toEqual({ ok: false, reason: 'CREDIT_EXCEEDS_OUTSTANDING', outstandingMinor: 500n });
    expect(checkCredit({ amountMinor: 1n, outstandingMinor: 0n, status: 'SETTLED' })).toEqual({ ok: false, reason: 'RECEIVABLE_NOT_OPEN' });
    expect(checkCredit({ amountMinor: 1n, outstandingMinor: 0n, status: 'OPEN' })).toEqual({ ok: false, reason: 'RECEIVABLE_NOT_OPEN' });
    expect(checkCredit({ amountMinor: 0n, outstandingMinor: 500n, status: 'OPEN' })).toEqual({ ok: false, reason: 'AMOUNT_INVALID' });
  });
});
