import type { DocumentsPreference, IncomeResponse } from '../api/client';
import type { IssueStart } from './IssueDocumentDrawer';

/**
 * MUT-648 / MUT-661: the documents an entry just saved can take, the suggested one first, following the client's
 * documents preference (MUT-660; `preference` is the client's own, else the profile default).
 *
 * An Owed with a client: Tax invoice first -> a tax invoice; Payment request first -> a payment request; On payment and
 * No document -> nothing (its document comes with each payment). A Received: No document -> nothing; otherwise an
 * invoice-receipt (when it has a client) or a receipt. An exempt dealer issues receipts and payment requests only, so
 * its Owed offer is a payment request unless the client takes no document before payment. Each offer is linked to the
 * entry (I1-a: it takes the entry over, so no second Owed or Received), with one line for the amount, VAT included, so
 * the totals equal the entry.
 */
export function issueOffers(saved: IncomeResponse, defaultLine: string, exempt: boolean, preference: DocumentsPreference = 'TAX_INVOICE_FIRST'): IssueStart[] {
  if (preference === 'NO_DOCUMENT') return [];
  const lines = [{ description: saved.title?.trim() || defaultLine, kind: 'SERVICE' as const, quantity: '1', unitPrice: saved.amount, discount: '', pricesIncludeVat: true }];
  const base = { customerId: saved.customerId ?? undefined, lines, pricesIncludeVat: true, fromEntry: { kind: saved.kind === 'owed' ? ('owed' as const) : ('received' as const), id: saved.id } };
  if (saved.kind === 'owed') {
    if (!saved.customerId || preference === 'ON_PAYMENT') return [];
    if (preference === 'PAYMENT_REQUEST_FIRST' || exempt) return [{ ...base, docType: 'PAYMENT_REQUEST' }];
    return [{ ...base, docType: 'TAX_INVOICE' }];
  }
  if (exempt) return [{ ...base, docType: 'RECEIPT' }];
  return saved.customerId ? [{ ...base, docType: 'TAX_INVOICE_RECEIPT' }, { ...base, docType: 'RECEIPT' }] : [{ ...base, docType: 'RECEIPT' }];
}
