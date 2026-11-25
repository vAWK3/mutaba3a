import type { IsoDate } from '../dates.js';
import type { CreditInput, IssueDocumentInput, IssueResult, PaymentMethod, ReceivableRecord } from '../repositories/ports.js';
import { creditCap } from './credit-split.js';
import type { VatTreatment } from '../vat.js';

/**
 * MUT-568 (D5): the ledger rows an issued document posts, worked out once for both stores. Both write them in the issue
 * transaction, under the document's id, so a document and its money land together or not at all.
 *
 *  - 305 tax invoice: an Owed
 *  - 320 invoice-receipt: an Owed and a Received that pays it in full
 *  - 400 receipt: a Received, paying an open 305 when `appliesToDocumentId` names one
 *  - 330 credit note: a credit on its original's Owed. MUT-643: on an Owed the original owns it may reach past what is
 *    still owed into what was paid (the paid part, `creditNoteRefusal`); the stores release it (credit-split.ts)
 *  - 300 payment request (MUT-662): nothing from an Owed (it is linked, never takes it over); an ordinary Owed when
 *    issued with no entry. A 320 or 400 that applies a payment request posts only a Received paying its Owed.
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
  /** MUT-662: a payment request's Owed is an ordinary one (cancelling the request leaves it); others are the document's. */
  origin: 'ISSUED_DOCUMENT' | 'ADJUSTMENT';
}

export interface PlannedPayment {
  customerId: string | null;
  currency: string;
  amountMinor: bigint;
  receivedOn: IsoDate;
  method: PaymentMethod;
  reference: string | null;
  /** 'own': pays this document's Owed (320); 'applies': pays the 305 or payment request it names; null: unallocated. */
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
    origin: input.docType === 'PAYMENT_REQUEST' ? 'ADJUSTMENT' : 'ISSUED_DOCUMENT',
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
      // MUT-662: applying a payment request, it pays the request's Owed and posts no Owed of its own.
      if (input.appliesToDocumentId) return { receivable: null, payment: received('applies'), credit: null };
      return { receivable: owed(requireCustomer(input)), payment: received('own'), credit: null };
    case 'PAYMENT_REQUEST':
      return { receivable: input.fromEntry ? null : owed(requireCustomer(input)), payment: null, credit: null };
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

/** Whether the document posts a new Owed (the year counter is taken before any lock, review fix 7). */
export function postsNewOwed(input: Pick<IssueDocumentInput, 'docType' | 'appliesToDocumentId' | 'fromEntry'>): boolean {
  if (input.fromEntry?.kind === 'receivable') return false;
  if (input.docType === 'TAX_INVOICE') return true;
  if (input.docType === 'TAX_INVOICE_RECEIPT') return !input.appliesToDocumentId;
  return input.docType === 'PAYMENT_REQUEST' && !input.fromEntry;
}

function requireCustomer(input: IssueDocumentInput): string {
  if (!input.customerId) throw new Error('a 305, 320, 330 or 300 names its customer (the route checks this first)');
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
  /** A document is already linked to it (`receivableId` / `paymentId`; credit notes and cancelled payment requests aside). */
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
    // MUT-662: a payment request asks for an Owed's money and never takes it over: it is always linked.
    if (docType === 'PAYMENT_REQUEST') return 'link';
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

/**
 * MUT-643 (D1, D5): why a credit note can't be issued against this original, or null when it can. Both stores ask this
 * under the original Owed's lock.
 *  - the credit notes on one original never add up to more than its gross (AC2)
 *  - past what is still owed, only an Owed the original owns may give back what was paid (else MUT-730), and only with
 *    a `paidPart` choice; without one the answer names the paid part so a client can ask
 */
export function creditNoteRefusal(
  facts: { original: { id: string; grossMinor: bigint }; owed: Pick<ReceivableRecord, 'origin' | 'originId'>; creditedByNotesMinor: bigint; outstandingMinor: bigint },
  input: Pick<IssueDocumentInput, 'composed' | 'paidPart'>,
): Extract<IssueResult, { kind: 'credit_exceeds_original' | 'original_paid' }> | null {
  const creditMinor = input.composed.grossMinor;
  const maximumMinor = creditCap(facts.original.grossMinor, facts.creditedByNotesMinor);
  if (creditMinor > maximumMinor) return { kind: 'credit_exceeds_original', maximumMinor };
  const { outstandingMinor } = facts;
  if (creditMinor <= outstandingMinor) return null;
  const owned = facts.owed.origin === 'ISSUED_DOCUMENT' && facts.owed.originId === facts.original.id;
  if (!owned) return { kind: 'original_paid', outstandingMinor };
  if (!input.paidPart) return { kind: 'original_paid', outstandingMinor, paidMinor: creditMinor - outstandingMinor };
  return null;
}
