import { todayIn, type IsoDate } from '../dates.js';
import { CAPTURE_UNDO_REASON, type LedgerCreditRow, type LedgerPaymentRow, type LedgerReceivableRow, type PaymentRecord } from '../repositories/ports.js';
import { countsOn } from '../summaries/compute.js';

/**
 * The ledger's line rule (ADR-217 §3–4, MUT-483 ADR-227): which rows are lines, how each is dated, and its debit or
 * credit. One classifier, read by the customer statement (`build.ts`, which decorates and pages the lines) and by the
 * period totals (`period.ts`, which sums them across the organization), so a statement line and a period figure can
 * never disagree about what counts. Pure: no store, no clock.
 *
 * | Line             | Rows                                              | Date                                | Debit | Credit |
 * | CHARGE           | a receivable, not deleted, `countsOn` at asOf     | postingDate                         | gross |        |
 * | CREDIT           | a credit on a CHARGE line's receivable            | effectiveDate                       |       | amount |
 * | PAYMENT          | POSTED, or REVERSED but not the person's undo     | receivedOn                          |       | amount |
 * | PAYMENT_REVERSAL | REVERSED but not the person's undo                | the reversal instant's day in the   | amount|        |
 * |                  |                                                   | organization timezone               |       |        |
 */

export type StatementLineKind = 'CHARGE' | 'CREDIT' | 'PAYMENT' | 'PAYMENT_REVERSAL';

/** A payment sorts before its own reversal on the same day; the rest is tie-breaking only. */
export const LINE_RANK: Readonly<Record<StatementLineKind, number>> = { CHARGE: 0, CREDIT: 1, PAYMENT: 2, PAYMENT_REVERSAL: 3 };

/** ADR-217 §3: a charge is on the statement (and in every period figure) when the summary counts it and it isn't deleted. */
export function isStatementCharge(r: Pick<LedgerReceivableRow, 'deletedAt' | 'origin' | 'postingDate' | 'paidMinor' | 'creditedMinor'>, asOf: IsoDate): boolean {
  return r.deletedAt === null && countsOn(r, asOf);
}

/** POSTED, or REVERSED by anything but the person's own undo (ADR-217 D2). */
export function isStatementPayment(p: Pick<PaymentRecord, 'status' | 'reversalReason'>): boolean {
  return p.status === 'POSTED' || (p.status === 'REVERSED' && p.reversalReason !== CAPTURE_UNDO_REASON);
}

/** A reversal's instant: `reversedAt`, else `updatedAt` (a row reversed before the column existed). */
export function reversalInstantOf(p: Pick<PaymentRecord, 'reversedAt' | 'updatedAt'>): Date {
  return p.reversedAt ?? p.updatedAt;
}

/** The day a reversal is dated: its instant's calendar day in the organization timezone (ADR-217 D6). */
export function reversalDateOf(p: Pick<PaymentRecord, 'reversedAt' | 'updatedAt'>, timezone: string): IsoDate {
  return todayIn(timezone, reversalInstantOf(p));
}

interface EntryBase {
  /** CHARGE = the receivable's id, CREDIT = the credit's, PAYMENT = the payment's, PAYMENT_REVERSAL = `${paymentId}:reversal`. */
  id: string;
  date: IsoDate;
  /** createdAt for a charge, a credit and a payment; the reversal instant for a reversal. */
  atMs: number;
  rank: number;
  currency: string;
  /** Null only for a payment captured with no client (MUT-65). */
  customerId: string | null;
  debitMinor: bigint;
  creditMinor: bigint;
}

export type LedgerEntry<R extends LedgerReceivableRow = LedgerReceivableRow, C extends LedgerCreditRow = LedgerCreditRow, P extends LedgerPaymentRow = LedgerPaymentRow> =
  | (EntryBase & { kind: 'CHARGE'; source: R })
  | (EntryBase & { kind: 'CREDIT'; source: C; receivable: R })
  | (EntryBase & { kind: 'PAYMENT'; source: P })
  | (EntryBase & { kind: 'PAYMENT_REVERSAL'; source: P });

/**
 * The whole-customer line set, undecorated and unsorted. Each line depends on its own row alone (a credit on its
 * receivable), so over one customer's rows it is that customer's statement lines, and over an organization's rows it
 * is the union of every customer's, plus the lines of payments with no client.
 */
export function ledgerEntries<R extends LedgerReceivableRow, C extends LedgerCreditRow, P extends LedgerPaymentRow>(
  rows: { receivables: readonly R[]; credits: readonly C[]; payments: readonly P[] },
  view: { asOf: IsoDate; timezone: string },
): Array<LedgerEntry<R, C, P>> {
  const entries: Array<LedgerEntry<R, C, P>> = [];
  const charged = new Map<string, R>();
  for (const r of rows.receivables) {
    if (!isStatementCharge(r, view.asOf)) continue;
    charged.set(r.id, r);
    entries.push({ kind: 'CHARGE', id: r.id, date: r.postingDate, atMs: r.createdAt.getTime(), rank: LINE_RANK.CHARGE, currency: r.currency, customerId: r.customerId, debitMinor: r.grossMinor, creditMinor: 0n, source: r });
  }
  for (const c of rows.credits) {
    const r = charged.get(c.receivableId);
    if (r) entries.push({ kind: 'CREDIT', id: c.id, date: c.effectiveDate, atMs: c.createdAt.getTime(), rank: LINE_RANK.CREDIT, currency: r.currency, customerId: r.customerId, debitMinor: 0n, creditMinor: c.amountMinor, source: c, receivable: r });
  }
  for (const p of rows.payments) {
    if (!isStatementPayment(p)) continue;
    const base = { currency: p.currency, customerId: p.customerId, source: p };
    entries.push({ ...base, kind: 'PAYMENT', id: p.id, date: p.receivedOn, atMs: p.createdAt.getTime(), rank: LINE_RANK.PAYMENT, debitMinor: 0n, creditMinor: p.amountMinor });
    if (p.status === 'REVERSED') {
      entries.push({ ...base, kind: 'PAYMENT_REVERSAL', id: `${p.id}:reversal`, date: reversalDateOf(p, view.timezone), atMs: reversalInstantOf(p).getTime(), rank: LINE_RANK.PAYMENT_REVERSAL, debitMinor: p.amountMinor, creditMinor: 0n });
    }
  }
  return entries;
}
