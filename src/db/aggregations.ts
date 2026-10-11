/**
 * Shared aggregation helpers for transaction calculations.
 * Extracted from repository.ts to reduce duplication.
 */

import type {
  Transaction,
  Currency,
  Client,
  Project,
  Category,
  PaymentRecord,
  PaymentByClientRow,
  OwedByCurrency,
  LastPayment,
} from '../types';
import { isReceivable, isOverdueReceivable, daysOverdue } from '../lib/dates';

export type { OwedByCurrency, LastPayment };

// Types for aggregation results
export interface TransactionTotals {
  paidIncomeMinor: number;
  unpaidIncomeMinor: number;
  expensesMinor: number;
}

export interface TransactionTotalsByCurrency {
  USD: TransactionTotals;
  ILS: TransactionTotals;
  EUR: TransactionTotals;
}

export interface TransactionTotalsWithActivity extends TransactionTotals {
  lastActivityAt?: string;
  lastPaymentAt?: string;
}

/** Fixed display order, so a currency never moves around between screens. */
const OWED_CURRENCY_ORDER: readonly Currency[] = ['USD', 'ILS', 'EUR'];

export interface DateFilter {
  dateFrom?: string;
  dateTo?: string;
}

export interface EntityMaps {
  clientMap: Map<string, string>;
  projectMap: Map<string, string>;
  categoryMap: Map<string, string>;
}

/**
 * Compute paid and unpaid amounts for an income transaction,
 * correctly handling partial payments via receivedAmountMinor.
 */
export function accumulateIncomeAmount(tx: Transaction): { paid: number; unpaid: number } {
  if (tx.status === 'paid') {
    return { paid: tx.amountMinor, unpaid: 0 };
  }
  const received = tx.receivedAmountMinor ?? 0;
  return { paid: received, unpaid: tx.amountMinor - received };
}

/**
 * Owed Now, per currency: the remaining balance of every unpaid income, with
 * the overdue part split out. The single definition behind the client profile
 * (MUT-3), the clients index (MUT-7) and home (MUT-8).
 *
 * Counts unpaid, non-deleted, non-archived income -- the same rows the income
 * lists show, so the figure always adds up to what is listed beneath it.
 * Currencies are never combined; one with nothing owed is left out.
 */
export function summarizeOwedByCurrency(transactions: Transaction[], today: string): OwedByCurrency[] {
  const totals = new Map<Currency, OwedByCurrency>();

  for (const tx of transactions) {
    if (!isReceivable(tx) || tx.deletedAt || tx.archivedAt) continue;
    const remaining = Math.max(0, accumulateIncomeAmount(tx).unpaid);
    if (remaining === 0) continue;

    const entry = totals.get(tx.currency) ?? { currency: tx.currency, owedMinor: 0, overdueMinor: 0 };
    entry.owedMinor += remaining;
    if (isOverdueReceivable(tx, today)) entry.overdueMinor += remaining;
    totals.set(tx.currency, entry);
  }

  return OWED_CURRENCY_ORDER.flatMap((currency) => totals.get(currency) ?? []);
}

/** Group items by a key; ES2022-safe stand-in for Map.groupBy. */
export function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * Owed Now summed across several clients, per currency (MUT-7 strip). Sums
 * within a currency only; the order stays USD, ILS, EUR.
 */
export function combineOwed(lists: OwedByCurrency[][]): OwedByCurrency[] {
  const totals = new Map<Currency, OwedByCurrency>();
  for (const { currency, owedMinor, overdueMinor } of lists.flat()) {
    const entry = totals.get(currency) ?? { currency, owedMinor: 0, overdueMinor: 0 };
    entry.owedMinor += owedMinor;
    entry.overdueMinor += overdueMinor;
    totals.set(currency, entry);
  }
  return OWED_CURRENCY_ORDER.flatMap((currency) => totals.get(currency) ?? []);
}

/**
 * The payments one income entry stands for (ADR-033): a row per non-deleted
 * PaymentRecord, plus one 'entry' row for money the entry says was received
 * that no record covers -- income saved as Received writes no record. The
 * single derivation behind a client's Payments section and the clients
 * index's last payment.
 *
 * @param records the entry's non-deleted payment records
 */
export function paymentRowsForIncome(tx: Transaction, records: PaymentRecord[]): PaymentByClientRow[] {
  const rows: PaymentByClientRow[] = records.map((record) => ({
    id: record.id,
    transactionId: tx.id,
    transactionTitle: tx.title,
    amountMinor: record.amountMinor,
    currency: tx.currency,
    paidAt: record.paidAt,
    notes: record.notes,
    source: 'record',
  }));

  const recordedMinor = records.reduce((sum, r) => sum + r.amountMinor, 0);
  const uncoveredMinor = accumulateIncomeAmount(tx).paid - recordedMinor;
  if (uncoveredMinor > 0) {
    rows.push({
      id: `entry:${tx.id}`,
      transactionId: tx.id,
      transactionTitle: tx.title,
      amountMinor: uncoveredMinor,
      currency: tx.currency,
      paidAt: tx.paidAt ?? tx.occurredAt,
      notes: undefined,
      source: 'entry',
    });
  }
  return rows;
}

/**
 * The newest payment by paidAt. A same-day tie goes to the larger amount,
 * then the smaller id, so the answer never depends on the input order.
 */
export function latestPayment(rows: PaymentByClientRow[]): LastPayment | undefined {
  let latest: PaymentByClientRow | undefined;
  for (const row of rows) {
    if (!latest || isLaterPayment(row, latest)) latest = row;
  }
  return latest && { paidAt: latest.paidAt, amountMinor: latest.amountMinor, currency: latest.currency };
}

function isLaterPayment(a: PaymentByClientRow, b: PaymentByClientRow): boolean {
  const byDate = a.paidAt.slice(0, 10).localeCompare(b.paidAt.slice(0, 10));
  if (byDate !== 0) return byDate > 0;
  if (a.amountMinor !== b.amountMinor) return a.amountMinor > b.amountMinor;
  return a.id < b.id;
}

export interface ClientCollection {
  owed: OwedByCurrency[];
  oldestOverdueDays?: number;
  lastPayment?: LastPayment;
}

/**
 * What the clients index shows per client (MUT-7): owed now, how late the
 * oldest overdue item is, and the newest payment. Owed and overdue come from
 * the same rows as summarizeOwedByCurrency (archived income excluded); the
 * last payment from paymentRowsForIncome, so it matches the profile's
 * Payments section -- archived entries' payments included, they happened.
 *
 * @param transactions one client's transactions (any kind; filtered here)
 * @param recordsByTx that client's non-deleted payment records by transaction
 */
export function summarizeClientCollection(
  transactions: Transaction[],
  recordsByTx: Map<string, PaymentRecord[]>,
  today: string
): ClientCollection {
  const incomes = transactions.filter((tx) => tx.kind === 'income' && !tx.deletedAt);

  let oldestOverdueDays: number | undefined;
  for (const tx of incomes) {
    if (tx.archivedAt) continue;
    const days = daysOverdue(tx, today);
    if (days !== undefined && (oldestOverdueDays === undefined || days > oldestOverdueDays)) {
      oldestOverdueDays = days;
    }
  }

  const payments = incomes.flatMap((tx) => paymentRowsForIncome(tx, recordsByTx.get(tx.id) ?? []));

  return {
    owed: summarizeOwedByCurrency(incomes, today),
    oldestOverdueDays,
    lastPayment: latestPayment(payments),
  };
}

/**
 * Aggregate transaction totals (paid income, unpaid income, expenses).
 * Handles partial payments correctly via accumulateIncomeAmount.
 */
export function aggregateTransactionTotals(transactions: Transaction[]): TransactionTotals {
  let paidIncomeMinor = 0;
  let unpaidIncomeMinor = 0;
  let expensesMinor = 0;

  for (const tx of transactions) {
    if (tx.kind === 'income') {
      const { paid, unpaid } = accumulateIncomeAmount(tx);
      paidIncomeMinor += paid;
      unpaidIncomeMinor += unpaid;
    } else {
      expensesMinor += tx.amountMinor;
    }
  }

  return { paidIncomeMinor, unpaidIncomeMinor, expensesMinor };
}

/**
 * Aggregate transaction totals separated by currency.
 * Returns totals for each currency independently - never mixes currencies.
 */
export function aggregateTransactionTotalsByCurrency(
  transactions: Transaction[]
): TransactionTotalsByCurrency {
  const result: TransactionTotalsByCurrency = {
    USD: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
    ILS: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
    EUR: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
  };

  for (const tx of transactions) {
    const currencyTotals = result[tx.currency];
    if (!currencyTotals) continue; // Skip unknown currencies

    if (tx.kind === 'income') {
      const { paid, unpaid } = accumulateIncomeAmount(tx);
      currencyTotals.paidIncomeMinor += paid;
      currencyTotals.unpaidIncomeMinor += unpaid;
    } else {
      currencyTotals.expensesMinor += tx.amountMinor;
    }
  }

  return result;
}

/**
 * Aggregate transaction totals with activity tracking.
 * Used by project and client summary calculations.
 */
export function aggregateTransactionTotalsWithActivity(
  transactions: Transaction[],
  options: { trackPayments?: boolean } = {}
): TransactionTotalsWithActivity {
  let paidIncomeMinor = 0;
  let unpaidIncomeMinor = 0;
  let expensesMinor = 0;
  let lastActivityAt: string | undefined;
  let lastPaymentAt: string | undefined;

  for (const tx of transactions) {
    if (tx.kind === 'income') {
      const { paid, unpaid } = accumulateIncomeAmount(tx);
      paidIncomeMinor += paid;
      unpaidIncomeMinor += unpaid;
      if (options.trackPayments && tx.status === 'paid' && (!lastPaymentAt || (tx.paidAt && tx.paidAt > lastPaymentAt))) {
        lastPaymentAt = tx.paidAt;
      }
    } else {
      expensesMinor += tx.amountMinor;
    }

    if (!lastActivityAt || tx.occurredAt > lastActivityAt) {
      lastActivityAt = tx.occurredAt;
    }
  }

  return { paidIncomeMinor, unpaidIncomeMinor, expensesMinor, lastActivityAt, lastPaymentAt };
}

/**
 * Filter transactions by date range and currency.
 * Common filter pattern used across overview, project, and client queries.
 */
export function filterTransactionsByDateAndCurrency(
  transactions: Transaction[],
  filters: { dateFrom?: string; dateTo?: string; currency?: Currency }
): Transaction[] {
  return transactions.filter((tx) => {
    if (tx.deletedAt) return false;
    if (filters.dateFrom && tx.occurredAt < filters.dateFrom) return false;
    if (filters.dateTo && tx.occurredAt > filters.dateTo + 'T23:59:59') return false;
    if (filters.currency && tx.currency !== filters.currency) return false;
    return true;
  });
}

/**
 * Filter transactions by entity ID (project or client).
 */
export function filterTransactionsByEntity(
  transactions: Transaction[],
  entityType: 'project' | 'client',
  entityId: string,
  currency?: Currency
): Transaction[] {
  return transactions.filter((tx) => {
    if (tx.deletedAt) return false;
    if (entityType === 'project' && tx.projectId !== entityId) return false;
    if (entityType === 'client' && tx.clientId !== entityId) return false;
    if (currency && tx.currency !== currency) return false;
    return true;
  });
}

/**
 * Filter transactions by entity with additional date filters.
 */
export function filterTransactionsByEntityAndDate(
  transactions: Transaction[],
  entityType: 'project' | 'client',
  entityId: string,
  filters: { dateFrom?: string; dateTo?: string; currency?: Currency }
): Transaction[] {
  return transactions.filter((tx) => {
    if (tx.deletedAt) return false;
    if (entityType === 'project' && tx.projectId !== entityId) return false;
    if (entityType === 'client' && tx.clientId !== entityId) return false;
    if (filters.currency && tx.currency !== filters.currency) return false;
    if (filters.dateFrom && tx.occurredAt < filters.dateFrom) return false;
    if (filters.dateTo && tx.occurredAt > filters.dateTo + 'T23:59:59') return false;
    return true;
  });
}

/**
 * Create name lookup maps for clients, projects, and categories.
 * Enables O(1) lookups when enriching transaction data.
 */
export function createEntityMaps(
  clients: Client[],
  projects: Project[],
  categories: Category[]
): EntityMaps {
  return {
    clientMap: new Map(clients.map((c) => [c.id, c.name])),
    projectMap: new Map(projects.map((p) => [p.id, p.name])),
    categoryMap: new Map(categories.map((c) => [c.id, c.name])),
  };
}

/**
 * Create a single entity name map.
 */
export function createNameMap<T extends { id: string; name: string }>(
  entities: T[]
): Map<string, string> {
  return new Map(entities.map((e) => [e.id, e.name]));
}

/**
 * Get the most recent activity date from a list of transactions.
 */
export function getLastActivityDate(transactions: Transaction[]): string | undefined {
  let lastActivityAt: string | undefined;
  for (const tx of transactions) {
    if (!lastActivityAt || tx.occurredAt > lastActivityAt) {
      lastActivityAt = tx.occurredAt;
    }
  }
  return lastActivityAt;
}

/**
 * Sort entities by last activity date (most recent first).
 */
export function sortByLastActivity<T extends { lastActivityAt?: string }>(items: T[]): T[] {
  return items.sort((a, b) => {
    if (!a.lastActivityAt && !b.lastActivityAt) return 0;
    if (!a.lastActivityAt) return 1;
    if (!b.lastActivityAt) return -1;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
}
