/**
 * Shared aggregation helpers for transaction calculations.
 * Extracted from repository.ts to reduce duplication.
 */

import type { Transaction, Currency, Client, Project, Category } from '../types';
import { isReceivable, isOverdueReceivable } from '../lib/dates';

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

/** What one client (or everyone) owes in a single currency, right now. */
export interface OwedByCurrency {
  currency: Currency;
  owedMinor: number;
  /** The part of owedMinor whose due date has passed (ADR-010) */
  overdueMinor: number;
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
