/**
 * MUT-662: a payment request's status, derived from what refers to it and never stored. Each payment on its Owed gets
 * its own invoice-receipt (320) or, for an exempt dealer, receipt (400) that refers to the request; a credit note on one
 * of those 320s takes its money back off. A cancellation is a record of its own (D18).
 */
import type { IssuedDocType } from './types.js';

export const PAYMENT_REQUEST_STATUSES = ['UNPAID', 'PARTLY_PAID', 'PAID', 'CANCELLED'] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export interface ReferringDocument {
  id: string;
  docType: IssuedDocType;
  number: number;
  grossMinor: bigint;
  /** Σ the credit notes on it (a 320 only; a receipt is never credited). */
  creditedMinor: bigint;
}

export interface CancellationFacts {
  number: number;
  cancelledAt: Date;
  reason: string | null;
}

export interface PaymentRequestFacts {
  status: PaymentRequestStatus;
  /** What the referring documents still cover after their credit notes. */
  coveredMinor: bigint;
  linked: Array<Pick<ReferringDocument, 'id' | 'docType' | 'number' | 'grossMinor'>>;
  cancellation: CancellationFacts | null;
}

/** The 320s and 400s that refer to a request (credit notes refer to their 320, not to the request). */
export function referringToRequest(docType: IssuedDocType): boolean {
  return docType === 'TAX_INVOICE_RECEIPT' || docType === 'RECEIPT';
}

/** A referring document still stands: a 320 not fully cancelled by credit notes, or any receipt. */
export function isLive(doc: Pick<ReferringDocument, 'grossMinor' | 'creditedMinor'>): boolean {
  return doc.creditedMinor < doc.grossMinor;
}

export function paymentRequestFacts(requestGrossMinor: bigint, referring: readonly ReferringDocument[], cancellation: CancellationFacts | null): PaymentRequestFacts {
  const coveredMinor = referring.reduce((sum, d) => sum + (isLive(d) ? d.grossMinor - d.creditedMinor : 0n), 0n);
  const linked = referring.map(({ id, docType, number, grossMinor }) => ({ id, docType, number, grossMinor }));
  const status: PaymentRequestStatus = cancellation ? 'CANCELLED' : coveredMinor >= requestGrossMinor ? 'PAID' : coveredMinor > 0n ? 'PARTLY_PAID' : 'UNPAID';
  return { status, coveredMinor, linked, cancellation };
}

/** D18: a request is cancelled only while nothing live refers to it. */
export function blocksCancel(referring: readonly ReferringDocument[]): boolean {
  return referring.some(isLive);
}
