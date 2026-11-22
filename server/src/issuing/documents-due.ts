/**
 * MUT-660 (ADR-270): the documents each income entry is due, derived — never stored — from the client's documents
 * preference and what is already issued (MUT-568) or attached (MUT-647). Pure: the store hands it the rows, and the
 * count, the To issue list, Issue all and (later) MUT-661's offer all read this one function.
 */
import type { IsoDate } from '../dates.js';
import { ISSUING_CURRENCIES, type DealerType } from './types.js';

export const DOCUMENTS_PREFERENCES = ['TAX_INVOICE_FIRST', 'PAYMENT_REQUEST_FIRST', 'ON_PAYMENT', 'NO_DOCUMENT'] as const;
export type DocumentsPreference = (typeof DOCUMENTS_PREFERENCES)[number];
/** The profile default for a client with no preference, and for money received with no client (N1). */
export const DEFAULT_DOCUMENTS_PREFERENCE: DocumentsPreference = 'ON_PAYMENT';

export type DueKind = 'TAX_INVOICE' | 'PAYMENT_REQUEST' | 'RECEIPT' | 'TAX_INVOICE_RECEIPT';
/**
 * Why a due item can't be issued in MTB3A; it can still be attached (MUT-647) or marked not for invoice.
 * PAYMENT_REQUEST_PENDING is no longer produced (MUT-662 issues payment requests); old clients keep reading it.
 */
export type DueReason = 'PAYMENT_REQUEST_PENDING' | 'CURRENCY_NOT_ILS' | 'MIXED_ALLOCATION' | 'RECORDED_ELSEWHERE';

export interface DueReceivableInput {
  id: string;
  number: string;
  customerId: string;
  origin: 'INSTALLMENT' | 'RETAINER_CHARGE' | 'ADJUSTMENT' | 'ISSUED_DOCUMENT';
  currency: string;
  grossMinor: bigint;
  paidMinor: bigint;
  creditedMinor: bigint;
  postingDate: IsoDate;
  notForInvoice: boolean;
  deleted: boolean;
  /** A tax invoice or invoice-receipt is linked to it (`IssuedDocument.receivableId`). */
  documented: boolean;
  /** The linked tax invoice (305) a receipt can apply to. */
  taxInvoiceId: string | null;
  /** MUT-662: the live (uncancelled) payment request linked to it; its payments are due a document that refers to it. */
  paymentRequestId: string | null;
  /** A live invoice issued elsewhere is attached to it (MUT-647, OWED). */
  externalInvoice: boolean;
}

export interface DuePaymentInput {
  id: string;
  number: string;
  customerId: string | null;
  origin: 'INTEGRATION' | 'CAPTURE' | 'ISSUED_DOCUMENT';
  status: 'POSTED' | 'REVERSED';
  currency: string;
  amountMinor: bigint;
  receivedOn: IsoDate;
  notForInvoice: boolean;
  /** MUT-481: a receipt issued elsewhere; it settles a receipt only. */
  receiptNumber: string | null;
  /** A document is linked to it, or to the payment it corrected (`IssuedDocument.paymentId`). */
  documented: boolean;
  /** A live invoice issued elsewhere is attached to it (MUT-647, RECEIVED). */
  externalInvoice: boolean;
  /** Live allocations only (`releasedAt` null). */
  allocations: ReadonlyArray<{ receivableId: string; amountMinor: bigint }>;
}

export interface DocumentsDueInput {
  dealerType: DealerType | null;
  defaultPreference: DocumentsPreference;
  /** customerId → its own preference (null follows the profile default). */
  preferences: ReadonlyMap<string, DocumentsPreference | null>;
  receivables: readonly DueReceivableInput[];
  payments: readonly DuePaymentInput[];
}

export interface DueItem {
  kind: DueKind;
  entry: { kind: 'receivable' | 'payment'; id: string; number: string };
  customerId: string | null;
  amountMinor: bigint;
  currency: string;
  date: IsoDate;
  issuable: boolean;
  reason?: DueReason;
  /** The tax invoice a receipt pays, or the payment request a 320 or 400 settles (MUT-662). */
  appliesToDocumentId?: string;
  /** Issue it linked to the entry with no posting: the entry's money stays as recorded. */
  linkOnly: boolean;
}

type Share = { receivable: DueReceivableInput | undefined; amountMinor: bigint };

export function preferenceOf(input: Pick<DocumentsDueInput, 'defaultPreference' | 'preferences'>, customerId: string | null): DocumentsPreference {
  if (!customerId) return DEFAULT_DOCUMENTS_PREFERENCE;
  return input.preferences.get(customerId) ?? input.defaultPreference;
}

export function documentsDue(input: DocumentsDueInput): DueItem[] {
  const byId = new Map(input.receivables.map((r) => [r.id, r]));
  const exempt = input.dealerType === 'EXEMPT';
  const items = [
    ...(exempt ? [] : input.receivables.flatMap((r) => receivableDue(input, r))),
    ...input.payments.flatMap((p) => (exempt ? exemptPaymentDue(input, p, byId) : paymentDue(input, p, byId))),
  ];
  return items.sort(byClientThenDate);
}

/** Items dated before today minus `months` (0 = no filter). A month end clamps (31 May − 3 months = 28 Feb). */
export function olderThan<T extends Pick<DueItem, 'date'>>(items: readonly T[], months: number, today: IsoDate): T[] {
  if (!months) return [...items];
  const cutoff = monthsBefore(today, months);
  return items.filter((i) => i.date < cutoff);
}

function monthsBefore(today: IsoDate, months: number): IsoDate {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

function receivableDue(input: DocumentsDueInput, r: DueReceivableInput): DueItem[] {
  // MUT-662: an Owed with a live payment request has had its document; its payments are due theirs.
  if (r.deleted || r.notForInvoice || r.origin === 'ISSUED_DOCUMENT' || r.documented || r.paymentRequestId || r.externalInvoice) return [];
  const amountMinor = r.grossMinor - r.creditedMinor;
  if (amountMinor <= 0n) return [];
  const preference = preferenceOf(input, r.customerId);
  if (preference !== 'TAX_INVOICE_FIRST' && preference !== 'PAYMENT_REQUEST_FIRST') return [];
  const kind: DueKind = preference === 'TAX_INVOICE_FIRST' ? 'TAX_INVOICE' : 'PAYMENT_REQUEST';
  const reason = currencyReason(r.currency);
  return [{
    kind,
    entry: { kind: 'receivable', id: r.id, number: r.number },
    customerId: r.customerId,
    amountMinor,
    currency: r.currency,
    date: r.postingDate,
    // An ADJUSTMENT Owed is taken over by its tax invoice (MUT-648's path); an agreement's charge, or a credited one,
    // keeps its money and gets the document linked to it. A payment request is always linked (MUT-662).
    linkOnly: kind === 'PAYMENT_REQUEST' || r.origin !== 'ADJUSTMENT' || r.creditedMinor > 0n,
    ...outcome(reason),
  }];
}

function counted(p: DuePaymentInput): boolean {
  return p.status === 'POSTED' && p.origin !== 'ISSUED_DOCUMENT' && !p.notForInvoice && !p.documented && !p.externalInvoice;
}

function exemptPaymentDue(input: DocumentsDueInput, p: DuePaymentInput, byId: ReadonlyMap<string, DueReceivableInput>): DueItem[] {
  if (!counted(p) || p.receiptNumber || preferenceOf(input, p.customerId) === 'NO_DOCUMENT') return [];
  const requested = requestOf(p, byId);
  return [{ ...paymentItem(p, 'RECEIPT', p.amountMinor, p.allocations.length > 0, paymentReason(p)), ...(requested ? { appliesToDocumentId: requested } : {}) }];
}

/** MUT-662: the live payment request a payment settles, when all of it went to that request's Owed. */
function requestOf(p: DuePaymentInput, byId: ReadonlyMap<string, DueReceivableInput>): string | null {
  if (p.allocations.length !== 1) return null;
  const r = byId.get(p.allocations[0]!.receivableId);
  return r && !r.documented && !r.externalInvoice ? r.paymentRequestId : null;
}

function paymentDue(input: DocumentsDueInput, p: DuePaymentInput, byId: ReadonlyMap<string, DueReceivableInput>): DueItem[] {
  if (!counted(p)) return [];
  if (p.allocations.length === 0) return unallocatedDue(input, p);
  // MUT-662: a payment on a payment request's Owed gets an invoice-receipt that refers to the request, linked only.
  const requested = requestOf(p, byId);
  if (requested && !excludedShare(input, { receivable: byId.get(p.allocations[0]!.receivableId), amountMinor: p.amountMinor })) {
    return [{ ...paymentItem(p, 'TAX_INVOICE_RECEIPT', p.amountMinor, true, paymentReason(p)), appliesToDocumentId: requested }];
  }
  const shares: Share[] = p.allocations.map((a) => ({ receivable: byId.get(a.receivableId), amountMinor: a.amountMinor }));
  const live = shares.filter((s) => !excludedShare(input, s));
  if (live.length === 0) return [];
  const liveMinor = live.reduce((sum, s) => sum + s.amountMinor, 0n);
  const waiting = live.filter((s) => awaitsTaxInvoice(input, s));
  const invoiced = live.filter((s) => s.receivable?.documented || s.receivable?.externalInvoice);
  if (waiting.length === live.length) return [];
  const mixed = live.length !== shares.length || waiting.length > 0 || (invoiced.length > 0 && invoiced.length < live.length);
  if (mixed) return [paymentItem(p, invoiced.length > 0 ? 'RECEIPT' : 'TAX_INVOICE_RECEIPT', liveMinor, true, 'MIXED_ALLOCATION')];
  if (invoiced.length === live.length) {
    if (p.receiptNumber) return [];
    const only = live.length === 1 ? live[0]?.receivable?.taxInvoiceId : null;
    return [{ ...paymentItem(p, 'RECEIPT', p.amountMinor, true, paymentReason(p)), ...(only ? { appliesToDocumentId: only } : {}) }];
  }
  return [paymentItem(p, 'TAX_INVOICE_RECEIPT', p.amountMinor, true, paymentReason(p))];
}

function unallocatedDue(input: DocumentsDueInput, p: DuePaymentInput): DueItem[] {
  const preference = preferenceOf(input, p.customerId);
  if (preference === 'NO_DOCUMENT') return [];
  const open = preference === 'TAX_INVOICE_FIRST' ? openTaxInvoiceFor(input, p) : null;
  if (open) {
    if (p.receiptNumber) return [];
    return [{ ...paymentItem(p, 'RECEIPT', p.amountMinor, false, paymentReason(p)), appliesToDocumentId: open }];
  }
  // No client: an invoice-receipt can't post an Owed, so it is linked (fromEntryMode).
  return [paymentItem(p, 'TAX_INVOICE_RECEIPT', p.amountMinor, !p.customerId, paymentReason(p))];
}

/** The client's oldest open tax invoice that still covers the payment (the receipt allocates to it). */
function openTaxInvoiceFor(input: DocumentsDueInput, p: DuePaymentInput): string | null {
  const open = input.receivables
    .filter((r) => r.customerId === p.customerId && r.taxInvoiceId && !r.deleted && r.currency === p.currency && r.grossMinor - r.paidMinor - r.creditedMinor >= p.amountMinor)
    .sort((a, b) => a.postingDate.localeCompare(b.postingDate));
  return open[0]?.taxInvoiceId ?? null;
}

function excludedShare(input: DocumentsDueInput, s: Share): boolean {
  if (!s.receivable) return false;
  return s.receivable.notForInvoice || preferenceOf(input, s.receivable.customerId) === 'NO_DOCUMENT';
}

/** Tax invoice first, and the Owed has no invoice yet: the Owed's tax invoice is due, not this share (no double invoicing). */
function awaitsTaxInvoice(input: DocumentsDueInput, s: Share): boolean {
  const r = s.receivable;
  return !!r && !r.documented && !r.externalInvoice && preferenceOf(input, r.customerId) === 'TAX_INVOICE_FIRST';
}

function paymentItem(p: DuePaymentInput, kind: DueKind, amountMinor: bigint, linkOnly: boolean, reason: DueReason | null): DueItem {
  return {
    kind,
    entry: { kind: 'payment', id: p.id, number: p.number },
    customerId: p.customerId,
    amountMinor,
    currency: p.currency,
    date: p.receivedOn,
    linkOnly,
    ...outcome(reason),
  };
}

function paymentReason(p: DuePaymentInput): DueReason | null {
  return currencyReason(p.currency) ?? (p.origin === 'CAPTURE' ? null : 'RECORDED_ELSEWHERE');
}

function currencyReason(currency: string): DueReason | null {
  return (ISSUING_CURRENCIES as readonly string[]).includes(currency) ? null : 'CURRENCY_NOT_ILS';
}

function outcome(reason: DueReason | null): Pick<DueItem, 'issuable' | 'reason'> {
  return reason ? { issuable: false, reason } : { issuable: true };
}

function byClientThenDate(a: DueItem, b: DueItem): number {
  if (a.customerId !== b.customerId) {
    if (a.customerId === null) return 1;
    if (b.customerId === null) return -1;
    return a.customerId.localeCompare(b.customerId);
  }
  return a.date.localeCompare(b.date) || a.entry.id.localeCompare(b.entry.id);
}
