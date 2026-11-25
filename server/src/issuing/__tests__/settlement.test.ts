import { describe, expect, it } from 'vitest';
import type { IssuedDocumentRecord, ReceivableRecord } from '../../repositories/ports.js';
import type { PaymentRequestFacts } from '../payment-request.js';
import { settlementOf } from '../settlement.js';

const doc = (o: Partial<IssuedDocumentRecord>) => ({ id: 'd1', docType: 'TAX_INVOICE', grossMinor: 600_000n, originalId: null, ...o }) as IssuedDocumentRecord;
const owed = (paidMinor: bigint, creditedMinor = 0n) => ({ paidMinor, creditedMinor }) as ReceivableRecord;

describe('settlementOf (MUT-664, D22)', () => {
  it('a tax invoice is open, partly paid or paid by its Owed', () => {
    expect(settlementOf(doc({}), owed(0n), [])).toEqual({ settledMinor: 0n, settlement: 'OPEN' });
    expect(settlementOf(doc({}), owed(100_000n, 50_000n), [])).toEqual({ settledMinor: 150_000n, settlement: 'PARTLY_PAID' });
    expect(settlementOf(doc({}), owed(600_000n), [])).toEqual({ settledMinor: 600_000n, settlement: 'PAID' });
  });

  it('is cancelled when credit notes cover its gross', () => {
    expect(settlementOf(doc({}), owed(0n, 600_000n), [doc({ id: 'c1', docType: 'CREDIT_NOTE', originalId: 'd1', grossMinor: 600_000n })]).settlement).toBe('CANCELLED');
  });

  it('MUT-643: an invoice-receipt is paid until credit notes cover its gross, then cancelled', () => {
    const receipt = doc({ docType: 'TAX_INVOICE_RECEIPT' });
    expect(settlementOf(receipt, owed(300_000n, 300_000n), [doc({ id: 'c1', docType: 'CREDIT_NOTE', originalId: 'd1', grossMinor: 300_000n })])).toEqual({ settledMinor: 600_000n, settlement: 'PAID' });
    expect(settlementOf(receipt, owed(0n, 600_000n), [doc({ id: 'c1', docType: 'CREDIT_NOTE', originalId: 'd1', grossMinor: 600_000n })])).toEqual({ settledMinor: 600_000n, settlement: 'CANCELLED' });
  });

  it('a money document is paid; a credit note has no settlement', () => {
    expect(settlementOf(doc({ docType: 'RECEIPT', grossMinor: 100_000n }), null, [])).toEqual({ settledMinor: 100_000n, settlement: 'PAID' });
    expect(settlementOf(doc({ docType: 'CREDIT_NOTE' }), null, [])).toEqual({ settledMinor: null, settlement: null });
  });

  it('a payment request is settled by what its documents cover (MUT-662), not paid on issue', () => {
    const pr = doc({ docType: 'PAYMENT_REQUEST' });
    const facts = (status: PaymentRequestFacts['status'], coveredMinor: bigint) => ({ status, coveredMinor, linked: [], cancellation: null }) as PaymentRequestFacts;
    expect(settlementOf(pr, null, [])).toEqual({ settledMinor: 0n, settlement: 'OPEN' });
    expect(settlementOf(pr, null, [], facts('UNPAID', 0n))).toEqual({ settledMinor: 0n, settlement: 'OPEN' });
    expect(settlementOf(pr, null, [], facts('PARTLY_PAID', 200_000n))).toEqual({ settledMinor: 200_000n, settlement: 'PARTLY_PAID' });
    expect(settlementOf(pr, null, [], facts('PAID', 700_000n))).toEqual({ settledMinor: 600_000n, settlement: 'PAID' });
    expect(settlementOf(pr, null, [], facts('CANCELLED', 0n)).settlement).toBe('CANCELLED');
  });
});
