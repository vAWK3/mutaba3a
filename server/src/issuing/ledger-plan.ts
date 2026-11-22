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
    // Review fix 4: an all-exempt document is EXEMPT, not standard-rated at 0. A mixed one stays STANDARD_RATED with its
    // real VAT; its exempt part is in the receivable's net (the document's lines keep the split for the uniform file).
    vatTreatment: composed.vatRateBasisPoints === 0 ? 'OUT_OF_SCOPE' : composed.lines.every((l) => l.vatExempt) ? 'EXEMPT' : 'STANDARD_RATED',
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

/** What a store reads of the entry a document is issued for (MUT-660). */
export interface EntryState {
  kind: 'receivable' | 'payment';
  origin: string;
  deleted: boolean;
  /** A Received that is POSTED (an Owed is always true). */
  posted: boolean;
  customerId: string | null;
  currency: string;
  /** An Owed's gross, a Received's amount. */
  grossMinor: bigint;
  creditedMinor: bigint;
  allocatedMinor: bigint;
  /** A document is already linked to it (`receivableId` / `paymentId`; credit notes aside). */
  documented: boolean;
}

/**
 * MUT-660 (ADR-270): `take` = the document takes the entry over and its money becomes the document's (I1-a, MUT-648):
 * an untouched recorded Owed, an unallocated captured Received. `link` = the document is numbered and linked to the
 * entry, nothing is posted or changed: an agreement's charge or a credited Owed (taking it over would cut the agreement
 * or the credit), an allocated Received (a partial payment would rewrite its Owed), and no-client money taking an
 * invoice-receipt (no Owed can be posted without a client). Null = it can't take a document. Both stores ask this.
 */
export function fromEntryMode(entry: EntryState | null, docType: IssueDocumentInput['docType']): 'take' | 'link' | null {
  if (!entry || entry.documented || entry.origin === 'ISSUED_DOCUMENT') return null;
  if (entry.kind === 'receivable') {
    if (entry.deleted || entryAmount(entry) <= 0n) return null;
    if (entry.origin === 'ADJUSTMENT' && entry.creditedMinor === 0n) return 'take';
    return docType === 'TAX_INVOICE' ? 'link' : null;
  }
  if (!entry.posted || entry.origin !== 'CAPTURE') return null;
  if (docType !== 'TAX_INVOICE_RECEIPT' && docType !== 'RECEIPT') return null;
  if (entry.allocatedMinor === 0n && (entry.customerId || docType === 'RECEIPT')) return 'take';
  return 'link';
}

/** The amount a document for this entry must carry. */
export function entryAmount(entry: Pick<EntryState, 'kind' | 'grossMinor' | 'creditedMinor'>): bigint {
  return entry.kind === 'receivable' ? entry.grossMinor - entry.creditedMinor : entry.grossMinor;
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
