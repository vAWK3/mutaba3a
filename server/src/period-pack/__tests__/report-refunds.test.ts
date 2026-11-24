import { describe, expect, it } from 'vitest';
import type { PaymentRecord, RefundRecord } from '../../repositories/ports.js';
import { totalsByCurrency } from '../report.js';
import type { IncomeLine, RefundLine } from '../rows.js';

/** MUT-643: the period pack's income total is net of what credit notes gave back; the count stays the money received. */

const income = (amountMinor: bigint): IncomeLine => ({ ref: 'I0001', record: { currency: 'ILS', amountMinor } as PaymentRecord, client: null, project: null, loggedBy: null });
const refund = (amountMinor: bigint): RefundLine => ({ ref: 'R0001', record: { currency: 'ILS', amountMinor } as RefundRecord, client: null });

describe('totalsByCurrency', () => {
  it('takes refunds off the income total, not off the count', () => {
    const [[currency, t]] = totalsByCurrency({ expenses: [], income: [income(10_000n), income(5_000n)], refunds: [refund(4_000n)] }) as [[string, { income: number; incomeTotal: bigint }]];
    expect(currency).toBe('ILS');
    expect(t).toMatchObject({ income: 2, incomeTotal: 11_000n });
  });

  it('is unchanged with no refunds', () => {
    const [[, t]] = totalsByCurrency({ expenses: [], income: [income(10_000n)] }) as [[string, { incomeTotal: bigint }]];
    expect(t.incomeTotal).toBe(10_000n);
  });
});
