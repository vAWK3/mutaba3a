import { describe, expect, it } from 'vitest';
import type { IssuedDocumentRecord, ReceivableRecord } from '../../repositories/ports.js';
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

  it('a money document is paid; a credit note has no settlement', () => {
    expect(settlementOf(doc({ docType: 'RECEIPT', grossMinor: 100_000n }), null, [])).toEqual({ settledMinor: 100_000n, settlement: 'PAID' });
    expect(settlementOf(doc({ docType: 'CREDIT_NOTE' }), null, [])).toEqual({ settledMinor: null, settlement: null });
  });
});
