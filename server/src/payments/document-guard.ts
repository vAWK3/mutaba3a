import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';

/**
 * MUT-709: refuses (409 HAS_DOCUMENT) to reverse, correct or undo a payment an issued receipt or invoice-receipt stands
 * on. An issued document is final at the Tax Authority, so the money behind it stays; the way out is a credit note.
 */
export async function assertNoMoneyDocument(store: LedgerStore, organizationId: string, paymentId: string): Promise<void> {
  const document = await store.issuing.moneyDocumentOn(organizationId, paymentId);
  if (!document) return;
  throw new ApiError('CONFLICT', 'A document was issued for this payment; issue a credit note first', { reason: 'HAS_DOCUMENT', documentId: document.id, docType: document.docType, number: document.number });
}
