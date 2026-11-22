import type { IsoDate } from '../dates.js';
import type { CreditInput, IssueDocumentInput, IssueResult, PaymentMethod } from '../repositories/ports.js';
import type { VatTreatment } from '../vat.js';

/**
 * MUT-568 (D5): the ledger rows an issued document posts, worked out once for both stores. Both write them in the issue
 * transaction, under the document's id, so a document and its money land together or not at all.
 *
 *  - 305 tax invoice: an Owed
 *  - 320 invoice-receipt: an Owed and a Received that pays it in full
 *  - 400 receipt: a Received, paying an open 305 when `appliesToDocumentId` names one
 *  - 330 credit note: a credit on its tax invoice's Owed (R-D2: up to what's still owed)
 */

export interface PlannedReceivable {
  customerId: string;
  currency: string;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  vatTreatment: VatTreatment;
  vatRateBasisPoints: number;
  title: string;
  dueDate: IsoDate;
  postingDate: IsoDate;
}

export interface PlannedPayment {
  customerId: string | null;
  currency: string;
  amountMinor: bigint;
  receivedOn: IsoDate;
  method: PaymentMethod;
  reference: string | null;
  /** 'own': pays this document's Owed (320); 'applies': pays the 305 it names (400); null: unallocated. */
  allocate: 'own' | 'applies' | null;
}

export interface LedgerPlan {
  receivable: PlannedReceivable | null;
  payment: PlannedPayment | null;
  /** Lands on the original's Owed. */
  credit: Omit<CreditInput, 'requestId'> | null;
}

export function documentTitle(input: Pick<IssueDocumentInput, 'titlePrefix'>, number: number): string {
  return `${input.titlePrefix} ${number}`;
}

export function ledgerPlan(input: IssueDocumentInput, number: number): LedgerPlan {
  const { composed } = input;
  const title = documentTitle(input, number);
  const owed = (customerId: string): PlannedReceivable => ({
    customerId,
    currency: input.currency,
    netMinor: composed.netMinor,
    vatMinor: composed.vatMinor,
    grossMinor: composed.grossMinor,
    vatTreatment: composed.vatRateBasisPoints > 0 ? 'STANDARD_RATED' : 'OUT_OF_SCOPE',
    vatRateBasisPoints: composed.vatRateBasisPoints,
    title,
    dueDate: input.dueDate ?? input.documentDate,
    postingDate: input.documentDate,
  });
  const received = (allocate: PlannedPayment['allocate']): PlannedPayment => {
    if (!input.payment) throw new Error('a 320 or 400 carries its payment details');
    return {
      customerId: input.customerId,
      currency: input.currency,
      amountMinor: composed.grossMinor,
      receivedOn: input.payment.receivedOn,
      method: input.payment.method,
      reference: input.payment.reference,
      allocate,
    };
  };
  switch (input.docType) {
    case 'TAX_INVOICE':
      return { receivable: owed(requireCustomer(input)), payment: null, credit: null };
    case 'TAX_INVOICE_RECEIPT':
      return { receivable: owed(requireCustomer(input)), payment: received('own'), credit: null };
    case 'RECEIPT':
      return { receivable: null, payment: received(input.appliesToDocumentId ? 'applies' : null), credit: null };
    case 'CREDIT_NOTE':
      return {
        receivable: null,
        payment: null,
        // R-7: the published reason codes stay as they are; the note's number is in the reason.
        credit: { amountMinor: composed.grossMinor, netMinor: composed.netMinor, vatMinor: composed.vatMinor, reason: title, reasonCode: 'OTHER', effectiveDate: input.documentDate },
      };
  }
}

function requireCustomer(input: IssueDocumentInput): string {
  if (!input.customerId) throw new Error('a 305, 320 or 330 names its customer (the route checks this first)');
  return input.customerId;
}

/** I1-a: why a recorded entry can't become this document's, or null when it can. Both stores ask this. */
export function fromEntryRefusal(
  entry: { ok: boolean; customerId: string | null; currency: string; amountMinor: bigint },
  input: Pick<IssueDocumentInput, 'customerId' | 'currency' | 'composed'>,
): Extract<IssueResult, { kind: 'entry_not_found' | 'entry_mismatch' }> | null {
  if (!entry.ok) return { kind: 'entry_not_found' };
  if (entry.customerId !== input.customerId) return { kind: 'entry_mismatch', field: 'customer' };
  if (entry.currency !== input.currency) return { kind: 'entry_mismatch', field: 'currency' };
  if (entry.amountMinor !== input.composed.grossMinor) return { kind: 'entry_mismatch', field: 'amount' };
  return null;
}
