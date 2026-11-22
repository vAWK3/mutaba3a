import type { IncomeResponse } from '../api/client';
import type { IssueStart } from './IssueDocumentDrawer';

/**
 * MUT-648: the documents an entry just saved can take, the suggested one first. An Owed takes a tax invoice; a Received
 * an invoice-receipt (when it has a client) or a receipt. Each is linked to the entry (I1-a: it takes the entry over,
 * so no second Owed or Received), with one line for the amount, VAT included, so the totals equal the entry.
 */
export function issueOffers(saved: IncomeResponse, defaultLine: string, exempt: boolean): IssueStart[] {
  const lines = [{ description: saved.title?.trim() || defaultLine, kind: 'SERVICE' as const, quantity: '1', unitPrice: saved.amount, discount: '', pricesIncludeVat: true }];
  const base = { customerId: saved.customerId ?? undefined, lines, pricesIncludeVat: true, fromEntry: { kind: saved.kind === 'owed' ? ('owed' as const) : ('received' as const), id: saved.id } };
  // An exempt dealer issues receipts and (MUT-662) payment requests: a payment request for an Owed with a client.
  if (exempt) return saved.kind === 'owed' ? (saved.customerId ? [{ ...base, docType: 'PAYMENT_REQUEST' }] : []) : [{ ...base, docType: 'RECEIPT' }];
  if (saved.kind === 'owed') return saved.customerId ? [{ ...base, docType: 'TAX_INVOICE' }] : [];
  return saved.customerId ? [{ ...base, docType: 'TAX_INVOICE_RECEIPT' }, { ...base, docType: 'RECEIPT' }] : [{ ...base, docType: 'RECEIPT' }];
}
