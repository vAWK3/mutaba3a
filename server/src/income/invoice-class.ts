/**
 * MUT-660 (ADR-270): the books split. Every received payment's money is either Invoice income or Not for invoice, so
 * All income = Invoice income + Not for invoice, per currency (ADR-004). Cash basis, like Reports' `received`: Owed is
 * not classified. Applies only where invoicing is on; the caller decides that.
 */
import { preferenceOf, type DocumentsPreference } from '../issuing/documents-due.js';

export interface ClassPaymentInput {
  currency: string;
  amountMinor: bigint;
  customerId: string | null;
  origin: 'INTEGRATION' | 'CAPTURE' | 'ISSUED_DOCUMENT';
  notForInvoice: boolean;
  /** A document is linked to the payment. */
  documented: boolean;
  /** A live invoice issued elsewhere is attached to it (MUT-647). */
  externalInvoice: boolean;
  /** Live allocations only. */
  allocations: ReadonlyArray<{ receivableId: string; amountMinor: bigint }>;
}

export interface IncomeClassContext {
  defaultPreference: DocumentsPreference;
  preferences: ReadonlyMap<string, DocumentsPreference | null>;
  receivables: ReadonlyMap<string, { customerId: string; notForInvoice: boolean }>;
}

export interface PaymentSplit {
  invoiceMinor: bigint;
  notForInvoiceMinor: bigint;
}

export interface IncomeSplitRow extends PaymentSplit {
  currency: string;
  allMinor: bigint;
}

/** Which part of one payment is invoice income. A document on the money wins over every mark. */
export function splitPayment(p: ClassPaymentInput, ctx: IncomeClassContext): PaymentSplit {
  if (p.documented || p.externalInvoice || p.origin === 'ISSUED_DOCUMENT') return { invoiceMinor: p.amountMinor, notForInvoiceMinor: 0n };
  if (p.notForInvoice) return { invoiceMinor: 0n, notForInvoiceMinor: p.amountMinor };
  let outside = 0n;
  let allocated = 0n;
  for (const a of p.allocations) {
    allocated += a.amountMinor;
    const r = ctx.receivables.get(a.receivableId);
    if (r && (r.notForInvoice || preferenceOf(ctx, r.customerId) === 'NO_DOCUMENT')) outside += a.amountMinor;
  }
  const rest = p.amountMinor - allocated;
  if (rest > 0n && preferenceOf(ctx, p.customerId) === 'NO_DOCUMENT') outside += rest;
  return { invoiceMinor: p.amountMinor - outside, notForInvoiceMinor: outside };
}

/** Per currency, sorted by code; the caller passes the payments it counts as received (POSTED). */
export function splitIncome(payments: readonly ClassPaymentInput[], ctx: IncomeClassContext): IncomeSplitRow[] {
  const rows = new Map<string, IncomeSplitRow>();
  for (const p of payments) {
    const split = splitPayment(p, ctx);
    const row = rows.get(p.currency) ?? { currency: p.currency, invoiceMinor: 0n, notForInvoiceMinor: 0n, allMinor: 0n };
    row.invoiceMinor += split.invoiceMinor;
    row.notForInvoiceMinor += split.notForInvoiceMinor;
    row.allMinor += p.amountMinor;
    rows.set(p.currency, row);
  }
  return [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** MUT-660: an income row's status in exports: English codes in every language (canvas D24). */
export type InvoiceStatus = 'due' | 'issued' | 'not_for_invoice' | 'no_document';

/** A document on the money first; then the marks; then a No document client; else it still needs its document. */
export function invoiceStatusOf(p: ClassPaymentInput, ctx: IncomeClassContext): InvoiceStatus {
  if (p.documented || p.externalInvoice || p.origin === 'ISSUED_DOCUMENT') return 'issued';
  if (p.notForInvoice) return 'not_for_invoice';
  const shares = p.allocations.map((a) => ctx.receivables.get(a.receivableId)).filter((r): r is { customerId: string; notForInvoice: boolean } => !!r);
  if (shares.length > 0 && shares.every((r) => r.notForInvoice)) return 'not_for_invoice';
  const customerId = shares[0]?.customerId ?? p.customerId;
  return preferenceOf(ctx, customerId) === 'NO_DOCUMENT' ? 'no_document' : 'due';
}
