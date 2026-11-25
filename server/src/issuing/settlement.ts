import type { IssuedDocumentRecord, ReceivableRecord } from '../repositories/ports.js';
import type { PaymentRequestFacts } from './payment-request.js';

/**
 * MUT-664 (D22): how much of an issued document is settled, for the client page's Documents tab. Derived from the
 * Owed it stands on (`paidMinor + creditedMinor`; money with no Owed already settles the oldest open one first,
 * `OLDEST_FIRST`) and the credit notes against it. Pure. A credit note itself has no settlement.
 *
 * | Document            | settled                                  | settlement                                     |
 * | credit note         | null                                     | null                                           |
 * | receipt             | gross                                    | PAID (money documents are paid when issued)    |
 * | invoice-receipt     | gross                                    | CANCELLED when credit notes cover the gross    |
 * |                     |                                          | (MUT-643), else PAID                           |
 * | tax invoice         | paid + credited on its Owed, ≤ gross      | CANCELLED when credit notes cover the gross,   |
 * |                     |                                          | else PAID / PARTLY_PAID / OPEN                 |
 * | payment request     | what its 320s/400s cover (MUT-662), ≤ gross | its MUT-662 status, UNPAID shown as OPEN     |
 */
export type Settlement = 'OPEN' | 'PARTLY_PAID' | 'PAID' | 'CANCELLED';

export function settlementOf(doc: IssuedDocumentRecord, owed: ReceivableRecord | null, creditNotes: readonly IssuedDocumentRecord[], request: PaymentRequestFacts | null = null): { settledMinor: bigint | null; settlement: Settlement | null } {
  if (doc.docType === 'CREDIT_NOTE') return { settledMinor: null, settlement: null };
  if (doc.docType === 'PAYMENT_REQUEST') {
    // A payment request is not money in: its settlement is what the documents issued against it cover (MUT-662).
    const covered = request?.coveredMinor ?? 0n;
    const settledMinor = covered > doc.grossMinor ? doc.grossMinor : covered;
    const status = request?.status ?? 'UNPAID';
    return { settledMinor, settlement: status === 'UNPAID' ? 'OPEN' : status };
  }
  const credited = creditNotes.filter((n) => n.originalId === doc.id).reduce((sum, n) => sum + n.grossMinor, 0n);
  if (doc.docType === 'RECEIPT') return { settledMinor: doc.grossMinor, settlement: 'PAID' };
  if (credited >= doc.grossMinor) return { settledMinor: doc.grossMinor, settlement: 'CANCELLED' };
  if (doc.docType === 'TAX_INVOICE_RECEIPT') return { settledMinor: doc.grossMinor, settlement: 'PAID' };
  const covered = owed ? owed.paidMinor + owed.creditedMinor : credited;
  const settledMinor = covered > doc.grossMinor ? doc.grossMinor : covered;
  return { settledMinor, settlement: settledMinor >= doc.grossMinor ? 'PAID' : settledMinor > 0n ? 'PARTLY_PAID' : 'OPEN' };
}
