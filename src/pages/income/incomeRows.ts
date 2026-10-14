/**
 * Row shaping and columns for the /income ledger (MUT-62).
 *
 * The table receives rows that already know what each cell shows, and one
 * column list drives both the header and every row, so the two can't drift.
 * The lists are module constants, so they are the same objects on every
 * render (CLAUDE.md performance guardrails).
 */

import type { Currency, PaymentStatus, TransactionDisplay, TxStatus } from '../../types';

export interface IncomeRow {
  id: string;
  /** The entry itself, for the row actions (Record payment) */
  tx: TransactionDisplay;
  /** When the work was done (occurredAt) */
  date: string;
  /** What was done; undefined for an entry saved without a title, or a blank one */
  title?: string;
  clientName?: string;
  projectName?: string;
  status: TxStatus;
  paymentStatus?: PaymentStatus;
  /** Whole days past due; undefined unless the entry is overdue */
  overdueDays?: number;
  amountMinor: number;
  currency: Currency;
  /** What has come in on a part-paid entry; undefined otherwise */
  partialReceivedMinor?: number;
  /** Unpaid and not yet fully received, so the row offers Mark paid */
  canMarkPaid: boolean;
  /** Money has come in, so the row offers Edit payment (MUT-169) */
  canEditPayment: boolean;
}

export function toIncomeRow(tx: TransactionDisplay): IncomeRow {
  const received = tx.receivedAmountMinor ?? 0;

  return {
    id: tx.id,
    tx,
    date: tx.occurredAt,
    title: tx.title?.trim() || undefined,
    clientName: tx.clientName,
    projectName: tx.projectName,
    status: tx.status,
    paymentStatus: tx.paymentStatus,
    overdueDays: tx.daysOverdue !== undefined && tx.daysOverdue > 0 ? tx.daysOverdue : undefined,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    partialReceivedMinor: tx.paymentStatus === 'partial' && received > 0 ? received : undefined,
    canMarkPaid: tx.status === 'unpaid' && tx.paymentStatus !== 'paid',
    canEditPayment: received > 0,
  };
}

export type IncomeColumnKey = 'date' | 'work' | 'client' | 'project' | 'status' | 'amount' | 'actions';

export interface IncomeColumn {
  key: IncomeColumnKey;
  /** i18n key of the header; the actions column is headed by RowActionsHeader */
  headerKey?: string;
  /** Class of the header cell */
  headerClassName?: string;
  /** Class of each body cell */
  cellClassName?: string;
  /** Shown only on a wide table (useIsCompactTable is false) */
  wideOnly?: boolean;
}

const INCOME_COLUMNS: readonly IncomeColumn[] = [
  { key: 'date', headerKey: 'transactions.columns.date', cellClassName: 'date-cell' },
  // The client profile's Work list label (MUT-3): "What" / "العمل"
  { key: 'work', headerKey: 'clients.profile.work.what', cellClassName: 'work-cell' },
  { key: 'client', headerKey: 'transactions.columns.client' },
  { key: 'project', headerKey: 'transactions.columns.project', cellClassName: 'text-secondary', wideOnly: true },
  { key: 'status', headerKey: 'transactions.columns.status' },
  { key: 'amount', headerKey: 'transactions.columns.amount', headerClassName: 'text-end', cellClassName: 'amount-cell' },
  { key: 'actions' },
];

const COMPACT_INCOME_COLUMNS: readonly IncomeColumn[] = INCOME_COLUMNS.filter((column) => !column.wideOnly);

/** The ledger's columns: all of them on a wide table, without Project on a compact one. */
export function incomeColumns(compact: boolean): readonly IncomeColumn[] {
  return compact ? COMPACT_INCOME_COLUMNS : INCOME_COLUMNS;
}
