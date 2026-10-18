/**
 * Shared aggregation helpers for transaction calculations.
 * Extracted from repository.ts to reduce duplication.
 */

import type {
  Transaction,
  Expense,
  Currency,
  Client,
  Project,
  Category,
  PaymentRecord,
  PaymentByClientRow,
  OwedByCurrency,
  LastPayment,
  ClientScope,
  OwedBucket,
} from '../types';
import { isReceivable, isOverdueReceivable, daysOverdue } from '../lib/dates';

export type { OwedByCurrency, LastPayment, ClientScope, OwedBucket };

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
  JOD: TransactionTotals;
  AED: TransactionTotals;
  SAR: TransactionTotals;
  QAR: TransactionTotals;
  BHD: TransactionTotals;
  OMR: TransactionTotals;
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
 * What one entry adds to Owed Now: its remaining balance when it is an
 * unpaid, non-deleted, non-archived income; 0 otherwise (ADR-033).
 */
export function owedNowRemaining(tx: Transaction): number {
  if (!isReceivable(tx) || tx.deletedAt || tx.archivedAt) return 0;
  return Math.max(0, accumulateIncomeAmount(tx).unpaid);
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
    const remaining = owedNowRemaining(tx);
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
 * Whose list an entry belongs on (MUT-83): 'none' when it has no client or its
 * client row is gone, 'archived' when its client is archived, undefined for a
 * live client. One definition for the clients index's muted rows and the
 * /income filter they open.
 */
export function clientScopeOf(
  tx: { clientId?: string },
  clientsById: ReadonlyMap<string, Pick<Client, 'archivedAt'>>
): ClientScope | undefined {
  const client = tx.clientId ? clientsById.get(tx.clientId) : undefined;
  if (!client) return 'none';
  return client.archivedAt ? 'archived' : undefined;
}

export interface OwedNowPartition<T extends Transaction = Transaction> {
  /** Owed Now over every entry passed in: Home's figure (ADR-036 §5) */
  total: OwedByCurrency[];
  /** Every live entry of each live client, in any state: a row's other columns need them */
  entriesByClient: Map<string, T[]>;
  noClient: OwedBucket;
  archivedClients: OwedBucket;
}

/**
 * The clients index's split of Owed Now (MUT-83, ADR-049): the entries Home
 * sums, divided into one group per live client, "No client" and "Archived
 * clients". Every entry lands in exactly one part, so the parts add up to
 * `total`, which is `summarizeOwedByCurrency` over the same entries.
 *
 * Takes entries and clients rather than a business, so a lens over several
 * businesses (MUT-89) can pass them all in.
 *
 * @param entries the entries in scope (deleted ones are skipped)
 * @param clients every client those entries may name, archived ones included
 */
export function partitionOwedNow<T extends Transaction>(
  entries: T[],
  clients: Client[],
  today: string
): OwedNowPartition<T> {
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const entriesByClient = new Map<string, T[]>();
  const noClient: T[] = [];
  const archived: T[] = [];

  for (const tx of entries) {
    if (tx.deletedAt) continue;
    const scope = clientScopeOf(tx, clientsById);
    if (scope === 'none') noClient.push(tx);
    else if (scope === 'archived') archived.push(tx);
    else {
      const group = entriesByClient.get(tx.clientId!);
      if (group) group.push(tx);
      else entriesByClient.set(tx.clientId!, [tx]);
    }
  }

  const owing = (txs: T[]) => txs.filter((tx) => owedNowRemaining(tx) > 0);
  return {
    total: summarizeOwedByCurrency(entries, today),
    entriesByClient,
    noClient: { owed: summarizeOwedByCurrency(noClient, today), count: owing(noClient).length },
    archivedClients: {
      owed: summarizeOwedByCurrency(archived, today),
      count: new Set(owing(archived).map((tx) => tx.clientId)).size,
    },
  };
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
    } else if (tx.kind === 'expense') {
      expensesMinor += tx.amountMinor;
    }
    // kind === 'conversion' (MUT-141): non-operating cash movement, excluded
    // from P&L by construction, not summed into either bucket.
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
    JOD: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
    AED: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
    SAR: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
    QAR: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
    BHD: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
    OMR: { paidIncomeMinor: 0, unpaidIncomeMinor: 0, expensesMinor: 0 },
  };

  for (const tx of transactions) {
    const currencyTotals = result[tx.currency];
    if (!currencyTotals) continue; // Skip unknown currencies

    if (tx.kind === 'income') {
      const { paid, unpaid } = accumulateIncomeAmount(tx);
      currencyTotals.paidIncomeMinor += paid;
      currencyTotals.unpaidIncomeMinor += unpaid;
    } else if (tx.kind === 'expense') {
      currencyTotals.expensesMinor += tx.amountMinor;
    }
    // kind === 'conversion' (MUT-141): excluded from P&L by construction.
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
    } else if (tx.kind === 'expense') {
      expensesMinor += tx.amountMinor;
    }
    // kind === 'conversion' (MUT-141): excluded from P&L totals, but still
    // counts toward lastActivityAt below — it did happen on this entity.

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
 * Expense-table equivalents of the transaction filter/sum helpers above
 * (MUT-94). Real expenses live in db.expenses since MUT-14, not
 * db.transactions -- any total that mixes the two sources without these
 * reads db.transactions alone and silently drops every real expense.
 */
export function filterExpensesByDateAndCurrency(
  expenses: Expense[],
  filters: { dateFrom?: string; dateTo?: string; currency?: Currency }
): Expense[] {
  return expenses.filter((e) => {
    if (e.deletedAt) return false;
    if (filters.dateFrom && e.occurredAt < filters.dateFrom) return false;
    if (filters.dateTo && e.occurredAt > filters.dateTo + 'T23:59:59') return false;
    if (filters.currency && e.currency !== filters.currency) return false;
    return true;
  });
}

/**
 * Filter expenses by entity ID (project or client).
 */
export function filterExpensesByEntity(
  expenses: Expense[],
  entityType: 'project' | 'client',
  entityId: string,
  currency?: Currency
): Expense[] {
  return expenses.filter((e) => {
    if (e.deletedAt) return false;
    if (entityType === 'project' && e.projectId !== entityId) return false;
    if (entityType === 'client' && e.clientId !== entityId) return false;
    if (currency && e.currency !== currency) return false;
    return true;
  });
}

/**
 * Filter expenses by entity with additional date filters.
 */
export function filterExpensesByEntityAndDate(
  expenses: Expense[],
  entityType: 'project' | 'client',
  entityId: string,
  filters: { dateFrom?: string; dateTo?: string; currency?: Currency }
): Expense[] {
  return expenses.filter((e) => {
    if (e.deletedAt) return false;
    if (entityType === 'project' && e.projectId !== entityId) return false;
    if (entityType === 'client' && e.clientId !== entityId) return false;
    if (filters.currency && e.currency !== filters.currency) return false;
    if (filters.dateFrom && e.occurredAt < filters.dateFrom) return false;
    if (filters.dateTo && e.occurredAt > filters.dateTo + 'T23:59:59') return false;
    return true;
  });
}

/** Sum expense amounts, mixing currencies -- callers must pre-filter to one currency. */
export function sumExpensesMinor(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + e.amountMinor, 0);
}

/** Sum expense amounts per currency. Currencies are never combined (ADR-004). */
export function sumExpensesByCurrency(expenses: Expense[]): Record<Currency, number> {
  const result: Record<Currency, number> = { USD: 0, ILS: 0, EUR: 0, JOD: 0, AED: 0, SAR: 0, QAR: 0, BHD: 0, OMR: 0 };
  for (const e of expenses) {
    if (result[e.currency] === undefined) continue;
    result[e.currency] += e.amountMinor;
  }
  return result;
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
