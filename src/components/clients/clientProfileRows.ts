/**
 * Row shaping for the client profile's work list (MUT-3).
 *
 * The table receives rows that already know everything a cell shows, so no
 * cell classifies dates or derives a status per render. Overdue and due-in
 * come from the shared ADR-010 helpers, never a local comparison.
 */

import { isReceivable, daysOverdue, daysUntilDue } from '../../lib/dates';
import type { Currency, PaymentStatus, TransactionDisplay } from '../../types';

export interface WorkRow {
  id: string;
  /** The entry itself, for the row actions (Record payment, Mark paid, invoice) */
  tx: TransactionDisplay;
  /** When the work was done (occurredAt) */
  date: string;
  /** What was done; undefined for older entries saved without a title */
  title?: string;
  projectId?: string;
  projectName?: string;
  amountMinor: number;
  currency: Currency;
  paymentStatus: PaymentStatus;
  /** Still owed on a partially paid entry; undefined otherwise */
  remainingMinor?: number;
  /** Whole days past due; undefined unless the entry is overdue */
  overdueDays?: number;
  /** Days until due (0 = today); undefined when overdue, paid or undated */
  dueInDays?: number;
  isReceivable: boolean;
}

export function toWorkRow(tx: TransactionDisplay, today: string): WorkRow {
  const paymentStatus = tx.paymentStatus ?? (tx.status === 'paid' ? 'paid' : 'unpaid');
  const receivable = isReceivable(tx);
  const overdueDays = daysOverdue(tx, today);
  const dueInDays =
    receivable && tx.dueDate && overdueDays === undefined ? daysUntilDue(tx.dueDate, today) : undefined;

  return {
    id: tx.id,
    tx,
    date: tx.occurredAt,
    title: tx.title,
    projectId: tx.projectId,
    projectName: tx.projectName,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    paymentStatus,
    remainingMinor: paymentStatus === 'partial' ? tx.remainingAmountMinor : undefined,
    overdueDays,
    dueInDays,
    isReceivable: receivable,
  };
}
