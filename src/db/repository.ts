import { db } from './database';
import { DEFAULT_SETTINGS } from './defaultSettings';
import { enforceSingleDefaultProfile, pickDefaultProfileId } from './profileDefault';
import { resolveFeatures } from '../lib/features/features';
import type {
  ResolvedSettings,
  Client,
  Project,
  Category,
  Transaction,
  FxRate,
  Settings,
  QueryFilters,
  OverviewTotals,
  ProjectSummary,
  ClientSummary,
  ClientOwedIndex,
  OwedBusinessBuckets,
  TransactionDisplay,
  Currency,
  BusinessProfile,
  PaymentStatus,
  PaymentRecord,
  PaymentByClientRow,
  RecentPaymentRow,
  PaymentByClientFilters,
  ProfileScope,
} from '../types';
import { excludeDeleted, scopeToProfile } from './baseQuery';
import { todayLocalISO, isOverdueReceivable, daysOverdue, isFuturePaymentDate } from '../lib/dates';
import { selectAttentionReceivables } from '../lib/attention';
import {
  aggregateTransactionTotals,
  aggregateTransactionTotalsByCurrency,
  aggregateTransactionTotalsWithActivity,
  filterTransactionsByDateAndCurrency,
  filterTransactionsByEntity,
  filterTransactionsByEntityAndDate,
  filterExpensesByDateAndCurrency,
  filterExpensesByEntity,
  filterExpensesByEntityAndDate,
  sumExpensesMinor,
  sumExpensesByCurrency,
  createNameMap,
  sortByLastActivity,
  paymentRowsForIncome,
  summarizeClientCollection,
  groupBy,
  clientScopeOf,
  partitionOwedNow,
  type TransactionTotalsByCurrency,
} from './aggregations';

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Today in the user's LOCAL timezone. See src/lib/dates.ts. */
function todayISO(): string {
  return todayLocalISO();
}

// Client Repository
export const clientRepo = {
  async list(filters?: { profileId?: ProfileScope; includeArchived?: boolean }): Promise<Client[]> {
    const { profileId, includeArchived = false } = filters || {};
    const results = await db.clients.toArray();

    return results
      .filter((c) => {
        if (!includeArchived && c.archivedAt) return false;
        if (!scopeToProfile(c, profileId)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async get(id: string): Promise<Client | undefined> {
    return db.clients.get(id);
  },

  async create(data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<Client> {
    const now = nowISO();

    // Auto-assign default profile if no profileId provided
    let profileId = data.profileId;
    if (!profileId) {
      const defaultProfile = await businessProfileRepo.getDefault();
      profileId = defaultProfile?.id;
    }

    const client: Client = {
      ...data,
      profileId,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.clients.add(client);
    return client;
  },

  async update(id: string, data: Partial<Client>): Promise<void> {
    await db.clients.update(id, { ...data, updatedAt: nowISO() });
  },

  async archive(id: string): Promise<void> {
    await db.clients.update(id, { archivedAt: nowISO(), updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.clients.delete(id);
  },
};

// Project Repository
export const projectRepo = {
  async list(filters?: { profileId?: string; clientId?: string; includeArchived?: boolean }): Promise<Project[]> {
    const results = await db.projects.toArray();
    return results
      .filter((p) => {
        if (!filters?.includeArchived && p.archivedAt) return false;
        if (filters?.clientId && p.clientId !== filters.clientId) return false;
        if (filters?.profileId && p.profileId !== filters.profileId) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async get(id: string): Promise<Project | undefined> {
    return db.projects.get(id);
  },

  async create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const now = nowISO();

    // Auto-assign default profile if no profileId provided
    let profileId = data.profileId;
    if (!profileId) {
      const defaultProfile = await businessProfileRepo.getDefault();
      profileId = defaultProfile?.id;
    }

    const project: Project = {
      ...data,
      profileId,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.projects.add(project);
    return project;
  },

  async update(id: string, data: Partial<Project>): Promise<void> {
    await db.projects.update(id, { ...data, updatedAt: nowISO() });
  },

  async archive(id: string): Promise<void> {
    await db.projects.update(id, { archivedAt: nowISO(), updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.projects.delete(id);
  },
};

// Category Repository
export const categoryRepo = {
  async list(kind?: 'income' | 'expense'): Promise<Category[]> {
    if (kind) {
      return db.categories.where('kind').equals(kind).sortBy('name');
    }
    return db.categories.orderBy('name').toArray();
  },

  async get(id: string): Promise<Category | undefined> {
    return db.categories.get(id);
  },

  async create(data: Omit<Category, 'id'>): Promise<Category> {
    const category: Category = {
      ...data,
      id: generateId(),
    };
    await db.categories.add(category);
    return category;
  },

  async update(id: string, data: Partial<Category>): Promise<void> {
    await db.categories.update(id, data);
  },

  async delete(id: string): Promise<void> {
    await db.categories.delete(id);
  },
};

// Transaction Repository
// Fields an entry's payment records own once it has any (ADR-039)
export const PAYMENT_STATE_KEYS = ['status', 'paidAt', 'receivedAmountMinor'] as const;

export const transactionRepo = {
  async list(filters: QueryFilters = {}): Promise<TransactionDisplay[]> {
    const transactions = await db.transactions.toArray();
    const clients = await db.clients.toArray();
    const projects = await db.projects.toArray();
    const categories = await db.categories.toArray();

    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const clientsById = new Map(clients.map((c) => [c.id, c]));
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    const today = todayISO();

    let filtered = transactions.filter((tx) => {
      if (!excludeDeleted(tx)) return false;
      if (tx.archivedAt && !filters.includeArchived) return false;
      if (!scopeToProfile(tx, filters.profileId)) return false;
      if (filters.clientScope && clientScopeOf(tx, clientsById) !== filters.clientScope) return false;
      if (filters.dateFrom && tx.occurredAt < filters.dateFrom) return false;
      if (filters.dateTo && tx.occurredAt > filters.dateTo + 'T23:59:59') return false;
      if (filters.currency && tx.currency !== filters.currency) return false;
      if (filters.kind && tx.kind !== filters.kind) return false;
      if (filters.clientId && tx.clientId !== filters.clientId) return false;
      if (filters.projectId && tx.projectId !== filters.projectId) return false;

      if (filters.status) {
        if (filters.status === 'overdue') {
          if (!isOverdueReceivable(tx, today)) {
            return false;
          }
        } else if (tx.status !== filters.status) {
          return false;
        }
      }

      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const clientName = tx.clientId ? clientMap.get(tx.clientId) : '';
        const projectName = tx.projectId ? projectMap.get(tx.projectId) : '';
        const matchesSearch =
          tx.title?.toLowerCase().includes(searchLower) ||
          tx.notes?.toLowerCase().includes(searchLower) ||
          clientName?.toLowerCase().includes(searchLower) ||
          projectName?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      return true;
    });

    // Sort
    const sortBy = filters.sort?.by || 'occurredAt';
    const sortDir = filters.sort?.dir || 'desc';
    filtered.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortBy];
      const bVal = (b as unknown as Record<string, unknown>)[sortBy];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });

    // Pagination
    if (filters.offset) {
      filtered = filtered.slice(filters.offset);
    }
    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered.map((tx) => {
      // Compute payment status and remaining amount for income transactions
      let paymentStatus: PaymentStatus | undefined;
      let remainingAmountMinor: number | undefined;

      if (tx.kind === 'income') {
        const received = tx.receivedAmountMinor ?? 0;
        remainingAmountMinor = Math.max(0, tx.amountMinor - received);

        if (tx.status === 'paid' || received >= tx.amountMinor) {
          paymentStatus = 'paid';
        } else if (received > 0) {
          paymentStatus = 'partial';
        } else {
          paymentStatus = 'unpaid';
        }
      }

      return {
        ...tx,
        clientName: tx.clientId ? clientMap.get(tx.clientId) : undefined,
        projectName: tx.projectId ? projectMap.get(tx.projectId) : undefined,
        categoryName: tx.categoryId ? categoryMap.get(tx.categoryId) : undefined,
        daysOverdue: daysOverdue(tx, today),
        paymentStatus,
        remainingAmountMinor,
      };
    });
  },

  async get(id: string): Promise<Transaction | undefined> {
    return db.transactions.get(id);
  },

  async getDisplay(id: string): Promise<TransactionDisplay | undefined> {
    const tx = await db.transactions.get(id);
    if (!tx || tx.deletedAt) return undefined;

    const client = tx.clientId ? await db.clients.get(tx.clientId) : undefined;
    const project = tx.projectId ? await db.projects.get(tx.projectId) : undefined;
    const category = tx.categoryId ? await db.categories.get(tx.categoryId) : undefined;
    const today = todayISO();

    // Compute payment status and remaining amount for income transactions
    let paymentStatus: PaymentStatus | undefined;
    let remainingAmountMinor: number | undefined;

    if (tx.kind === 'income') {
      const received = tx.receivedAmountMinor ?? 0;
      remainingAmountMinor = Math.max(0, tx.amountMinor - received);

      if (tx.status === 'paid' || received >= tx.amountMinor) {
        paymentStatus = 'paid';
      } else if (received > 0) {
        paymentStatus = 'partial';
      } else {
        paymentStatus = 'unpaid';
      }
    }

    return {
      ...tx,
      clientName: client?.name,
      projectName: project?.name,
      categoryName: category?.name,
      daysOverdue: daysOverdue(tx, today),
      paymentStatus,
      remainingAmountMinor,
    };
  },

  async create(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Transaction> {
    const now = nowISO();
    const transaction: Transaction = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.transactions.add(transaction);
    return transaction;
  },

  async update(id: string, data: Partial<Transaction>): Promise<void> {
    const existing = await db.transactions.get(id);
    if (!existing) return;

    const paymentStateSent = PAYMENT_STATE_KEYS.some((key) => key in data);
    const amountChanged = data.amountMinor !== undefined && data.amountMinor !== existing.amountMinor;
    const currencyChanged = data.currency !== undefined && data.currency !== existing.currency;
    if (!paymentStateSent && !amountChanged && !currencyChanged) {
      await db.transactions.update(id, { ...data, updatedAt: nowISO() });
      return;
    }

    // Payment records own received/status/paidAt (ADR-030, ADR-039). With live
    // records, a caller can't set those three, can't move the payments into
    // another currency, and can't cut the amount below what they add up to;
    // the payment state is then re-derived from the records.
    await db.transaction('rw', [db.transactions, db.paymentRecords], async () => {
      const records = await db.paymentRecords
        .where('transactionId')
        .equals(id)
        .filter((r) => !r.deletedAt)
        .toArray();
      if (records.length === 0) {
        await db.transactions.update(id, { ...data, updatedAt: nowISO() });
        return;
      }

      const recordedMinor = records.reduce((sum, r) => sum + r.amountMinor, 0);
      if (currencyChanged) {
        throw new PaymentRecordError(
          `Payment amount already recorded in ${existing.currency}; the currency can't change`,
          { transactionId: id }
        );
      }
      if (amountChanged && data.amountMinor! < recordedMinor) {
        throw new PaymentRecordError(
          `Payment amount already recorded (${recordedMinor / 100} ${existing.currency}) exceeds the new amount`,
          { transactionId: id }
        );
      }

      const changes: Partial<Transaction> = { ...data };
      for (const key of PAYMENT_STATE_KEYS) delete changes[key];
      await db.transactions.update(id, { ...changes, updatedAt: nowISO() });
      if (amountChanged || paymentStateSent) await recalculateReceivedAmount(id);
    });
  },

  async markPaid(id: string, opts?: { paidAt?: string }): Promise<void> {
    const tx = await db.transactions.get(id);
    if (!tx) return;

    const currentReceived = tx.receivedAmountMinor ?? 0;
    const remaining = tx.amountMinor - currentReceived;

    if (remaining > 0) {
      // Create a payment record for the remaining amount; recalculateReceivedAmount
      // (called by paymentRecordRepo.create) derives status/paidAt from it.
      await paymentRecordRepo.create({
        transactionId: id,
        amountMinor: remaining,
        paidAt: opts?.paidAt ?? nowISO(),
      });
    } else {
      // Already fully covered by existing payment records; just finalize status.
      await recalculateReceivedAmount(id);
    }
  },

  /**
   * Record a partial payment on an income transaction.
   * Creates a PaymentRecord and recalculates the transaction total.
   * Automatically marks as paid when full amount is received.
   */
  async recordPartialPayment(id: string, paymentAmountMinor: number, opts?: { paidAt?: string }): Promise<void> {
    if (paymentAmountMinor <= 0) {
      throw new PartialPaymentError('Payment amount must be positive', id);
    }

    const tx = await db.transactions.get(id);
    if (!tx) {
      throw new PartialPaymentError('Transaction not found', id);
    }

    if (tx.kind !== 'income') {
      throw new PartialPaymentError('Partial payments only apply to income', id);
    }

    if (tx.status === 'paid') {
      throw new PartialPaymentError('Transaction is already fully paid', id);
    }

    await paymentRecordRepo.create({
      transactionId: id,
      amountMinor: paymentAmountMinor,
      paidAt: opts?.paidAt ?? nowISO(),
    });
  },

  async softDelete(id: string): Promise<void> {
    await db.transactions.update(id, { deletedAt: nowISO(), updatedAt: nowISO() });
  },

  /**
   * Archive a transaction (soft-hide from lists).
   */
  async archive(id: string): Promise<void> {
    const now = nowISO();
    await db.transactions.update(id, { archivedAt: now, updatedAt: now });
  },

  /**
   * Unarchive a transaction.
   */
  async unarchive(id: string): Promise<void> {
    await db.transactions.update(id, { archivedAt: undefined, updatedAt: nowISO() });
  },

  async getOverviewTotals(filters: { dateFrom: string; dateTo: string; currency?: Currency; profileId?: string }): Promise<OverviewTotals> {
    const [transactions, expenses] = await Promise.all([db.transactions.toArray(), db.expenses.toArray()]);
    // Apply profile filter first
    const profileFiltered = filters.profileId
      ? transactions.filter((tx) => tx.profileId === filters.profileId)
      : transactions;
    const profileFilteredExpenses = filters.profileId
      ? expenses.filter((e) => e.profileId === filters.profileId)
      : expenses;
    const filtered = filterTransactionsByDateAndCurrency(profileFiltered, filters);
    const filteredExpenses = filterExpensesByDateAndCurrency(profileFilteredExpenses, filters);
    const totals = aggregateTransactionTotals(filtered);
    // Real expenses live in db.expenses since MUT-14; db.transactions' kind='expense'
    // rows are legacy (demo seed data, CSV import) and summed additively, not replaced.
    return { ...totals, expensesMinor: totals.expensesMinor + sumExpensesMinor(filteredExpenses) };
  },

  async getOverviewTotalsByCurrency(filters: { dateFrom: string; dateTo: string; profileId?: string }): Promise<TransactionTotalsByCurrency> {
    const [transactions, expenses] = await Promise.all([db.transactions.toArray(), db.expenses.toArray()]);
    // Apply profile filter first
    const profileFiltered = filters.profileId
      ? transactions.filter((tx) => tx.profileId === filters.profileId)
      : transactions;
    const profileFilteredExpenses = filters.profileId
      ? expenses.filter((e) => e.profileId === filters.profileId)
      : expenses;
    // Filter by date only, not currency - we want all currencies
    const filtered = filterTransactionsByDateAndCurrency(profileFiltered, {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });
    const filteredExpenses = filterExpensesByDateAndCurrency(profileFilteredExpenses, {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });
    const totals = aggregateTransactionTotalsByCurrency(filtered);
    const expenseTotals = sumExpensesByCurrency(filteredExpenses);
    for (const currency of Object.keys(totals) as Currency[]) {
      totals[currency].expensesMinor += expenseTotals[currency];
    }
    return totals;
  },

  async getAttentionReceivables(filters: { currency?: Currency; profileId?: string }): Promise<TransactionDisplay[]> {
    const today = todayISO();

    const transactions = await this.list({
      kind: 'income',
      currency: filters.currency,
      profileId: filters.profileId,
    });

    // Overdue, or due within the next 7 days, oldest first: the rule Home
    // applies to its own receivables (MUT-82), defined once
    return selectAttentionReceivables(transactions, today);
  },
};

// Project Summary Repository
export const projectSummaryRepo = {
  async list(filters?: { profileId?: string; currency?: Currency; search?: string; field?: string }): Promise<ProjectSummary[]> {
    const projects = await projectRepo.list({ profileId: filters?.profileId });
    const [clients, transactions, expenses] = await Promise.all([
      db.clients.toArray(),
      db.transactions.toArray(),
      db.expenses.toArray(),
    ]);

    const clientMap = createNameMap(clients);

    const summaries = projects
      .filter((p) => {
        if (filters?.search) {
          const searchLower = filters.search.toLowerCase();
          const clientName = p.clientId ? clientMap.get(p.clientId) : '';
          if (
            !p.name.toLowerCase().includes(searchLower) &&
            !clientName?.toLowerCase().includes(searchLower)
          ) {
            return false;
          }
        }
        if (filters?.field && p.field !== filters.field) return false;
        return true;
      })
      .map((p) => {
        const projectTxs = filterTransactionsByEntity(transactions, 'project', p.id, filters?.currency);
        const totals = aggregateTransactionTotalsWithActivity(projectTxs);
        // Real expenses live in db.expenses since MUT-14; db.transactions'
        // kind='expense' rows are legacy and summed additively, not replaced.
        const projectExpenses = filterExpensesByEntity(expenses, 'project', p.id, filters?.currency);
        const expensesMinor = totals.expensesMinor + sumExpensesMinor(projectExpenses);

        // When no currency filter, also compute per-currency breakdowns
        let perCurrencyData = {};
        if (!filters?.currency) {
          const allProjectTxs = filterTransactionsByEntity(transactions, 'project', p.id);
          const byCurrency = aggregateTransactionTotalsByCurrency(allProjectTxs);
          const allProjectExpenses = filterExpensesByEntity(expenses, 'project', p.id);
          const expensesByCurrency = sumExpensesByCurrency(allProjectExpenses);
          perCurrencyData = {
            paidIncomeMinorUSD: byCurrency.USD.paidIncomeMinor,
            paidIncomeMinorILS: byCurrency.ILS.paidIncomeMinor,
            paidIncomeMinorEUR: byCurrency.EUR.paidIncomeMinor,
            unpaidIncomeMinorUSD: byCurrency.USD.unpaidIncomeMinor,
            unpaidIncomeMinorILS: byCurrency.ILS.unpaidIncomeMinor,
            unpaidIncomeMinorEUR: byCurrency.EUR.unpaidIncomeMinor,
            expensesMinorUSD: byCurrency.USD.expensesMinor + expensesByCurrency.USD,
            expensesMinorILS: byCurrency.ILS.expensesMinor + expensesByCurrency.ILS,
            expensesMinorEUR: byCurrency.EUR.expensesMinor + expensesByCurrency.EUR,
          };
        }

        return {
          id: p.id,
          name: p.name,
          clientId: p.clientId,
          clientName: p.clientId ? clientMap.get(p.clientId) : undefined,
          field: p.field,
          ...totals,
          expensesMinor,
          netMinor: totals.paidIncomeMinor - expensesMinor,
          ...perCurrencyData,
        };
      });

    return sortByLastActivity(summaries);
  },

  async get(projectId: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }): Promise<ProjectSummary | undefined> {
    const project = await projectRepo.get(projectId);
    if (!project) return undefined;

    const client = project.clientId ? await clientRepo.get(project.clientId) : undefined;
    const [transactions, expenses] = await Promise.all([db.transactions.toArray(), db.expenses.toArray()]);

    const projectTxs = filterTransactionsByEntityAndDate(transactions, 'project', projectId, filters || {});
    const totals = aggregateTransactionTotalsWithActivity(projectTxs);
    // Real expenses live in db.expenses since MUT-14; db.transactions'
    // kind='expense' rows are legacy and summed additively, not replaced.
    const projectExpenses = filterExpensesByEntityAndDate(expenses, 'project', projectId, filters || {});
    const expensesMinor = totals.expensesMinor + sumExpensesMinor(projectExpenses);

    // When no currency filter, also compute per-currency breakdowns
    let perCurrencyData = {};
    if (!filters?.currency) {
      const allProjectTxs = filterTransactionsByEntityAndDate(transactions, 'project', projectId, { dateFrom: filters?.dateFrom, dateTo: filters?.dateTo });
      const byCurrency = aggregateTransactionTotalsByCurrency(allProjectTxs);
      const allProjectExpenses = filterExpensesByEntityAndDate(expenses, 'project', projectId, { dateFrom: filters?.dateFrom, dateTo: filters?.dateTo });
      const expensesByCurrency = sumExpensesByCurrency(allProjectExpenses);
      perCurrencyData = {
        paidIncomeMinorUSD: byCurrency.USD.paidIncomeMinor,
        paidIncomeMinorILS: byCurrency.ILS.paidIncomeMinor,
        paidIncomeMinorEUR: byCurrency.EUR.paidIncomeMinor,
        unpaidIncomeMinorUSD: byCurrency.USD.unpaidIncomeMinor,
        unpaidIncomeMinorILS: byCurrency.ILS.unpaidIncomeMinor,
        unpaidIncomeMinorEUR: byCurrency.EUR.unpaidIncomeMinor,
        expensesMinorUSD: byCurrency.USD.expensesMinor + expensesByCurrency.USD,
        expensesMinorILS: byCurrency.ILS.expensesMinor + expensesByCurrency.ILS,
        expensesMinorEUR: byCurrency.EUR.expensesMinor + expensesByCurrency.EUR,
      };
    }

    return {
      id: project.id,
      name: project.name,
      clientId: project.clientId,
      clientName: client?.name,
      field: project.field,
      ...totals,
      expensesMinor,
      netMinor: totals.paidIncomeMinor - expensesMinor,
      ...perCurrencyData,
    };
  },
};

// Client Summary Repository
export const clientSummaryRepo = {
  /**
   * One row per non-archived client: totals, activity and the MUT-7 collection
   * fields (owed now, oldest overdue age, last payment), each counted over the
   * client's entries in every business. Read by Insights and Reports; the
   * clients index reads listOwedIndex, which counts one business (ADR-049).
   * Transactions and payment records are each read and grouped once, so a few
   * hundred clients cost one pass, not one scan per client.
   */
  async list(filters?: { profileId?: string; currency?: Currency; search?: string }): Promise<ClientSummary[]> {
    const clients = await clientRepo.list({ profileId: filters?.profileId });
    const [projects, transactions, records] = await Promise.all([
      db.projects.toArray(),
      db.transactions.toArray(),
      db.paymentRecords.filter((r) => !r.deletedAt).toArray(),
    ]);

    const liveTxs = transactions.filter((tx) => !tx.deletedAt && tx.clientId);
    const txsByClient = groupBy(liveTxs, (tx) => tx.clientId!);
    const recordsByTx = groupBy(records, (r) => r.transactionId);
    const activeProjects = groupBy(projects.filter((p) => p.clientId && !p.archivedAt), (p) => p.clientId!);
    const today = todayLocalISO();
    const searchLower = filters?.search?.toLowerCase();

    const summaries = clients
      .filter((c) => !searchLower || c.name.toLowerCase().includes(searchLower))
      .map((c) => {
        const allClientTxs = txsByClient.get(c.id) ?? [];
        const clientTxs = filters?.currency
          ? allClientTxs.filter((tx) => tx.currency === filters.currency)
          : allClientTxs;
        const summary = buildClientSummary(c, clientTxs, activeProjects.get(c.id)?.length ?? 0, recordsByTx, today);
        return filters?.currency ? summary : { ...summary, ...perCurrencyReportTotals(allClientTxs) };
      });

    return sortByLastActivity(summaries);
  },

  /**
   * The clients index (MUT-83, ADR-049). Reads the business's entries through
   * transactionRepo.list -- the read behind Home's Owed now -- and splits them
   * with partitionOwedNow, so `total` equals Home's and the client rows plus
   * No client and Archived clients add up to it.
   *
   * Lists the business's own live clients (even with no entries) and live
   * clients of other businesses that have an entry here. Every figure on a row
   * counts only this business's entries; the client profile stays
   * all-businesses. A search narrows the client rows only.
   *
   * All businesses (MUT-89, ADR-051) passes every live business: each row
   * then counts the client's entries in all of them and names them
   * (`profileIds`, the row's tags), and the muted rows also come per business
   * (`byProfile`, O4) so each opens Income in its own business.
   *
   * @param filters.profileId the business, or the businesses; undefined reads every record
   */
  async listOwedIndex(filters: { profileId?: ProfileScope; search?: string } = {}): Promise<ClientOwedIndex> {
    const [clients, entries, projects, records] = await Promise.all([
      db.clients.toArray(),
      transactionRepo.list({ profileId: filters.profileId, includeArchived: true }),
      db.projects.toArray(),
      db.paymentRecords.filter((r) => !r.deletedAt).toArray(),
    ]);
    const today = todayLocalISO();
    const { total, entriesByClient, noClient, archivedClients } = partitionOwedNow(entries, clients, today);
    const recordsByTx = groupBy(records, (r) => r.transactionId);
    const activeProjects = groupBy(projects.filter((p) => p.clientId && !p.archivedAt), (p) => p.clientId!);
    const searchLower = filters.search?.toLowerCase();

    const listed = clients.filter(
      (c) =>
        !c.archivedAt &&
        (scopeToProfile(c, filters.profileId) || entriesByClient.has(c.id)) &&
        (!searchLower || c.name.toLowerCase().includes(searchLower))
    );

    return {
      clients: listed.map((c) => {
        const clientEntries = entriesByClient.get(c.id) ?? [];
        return {
          ...buildClientSummary(c, clientEntries, activeProjects.get(c.id)?.length ?? 0, recordsByTx, today),
          profileIds: businessesOfClient(c, clientEntries, filters.profileId),
        };
      }),
      total,
      noClient,
      archivedClients,
      ...(isScopeList(filters.profileId) && { byProfile: bucketsPerBusiness(entries, clients, filters.profileId, today) }),
    };
  },

  async get(clientId: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }): Promise<ClientSummary | undefined> {
    const client = await clientRepo.get(clientId);
    if (!client) return undefined;

    const projects = await db.projects.toArray();
    const transactions = await db.transactions.toArray();
    const clientTxs = filterTransactionsByEntityAndDate(transactions, 'client', clientId, filters || {});
    const records = await db.paymentRecords
      .where('transactionId')
      .anyOf(clientTxs.map((tx) => tx.id))
      .filter((r) => !r.deletedAt)
      .toArray();
    const activeProjectCount = projects.filter((p) => p.clientId === clientId && !p.archivedAt).length;

    return buildClientSummary(client, clientTxs, activeProjectCount, groupBy(records, (r) => r.transactionId), todayLocalISO());
  },
};

function isScopeList(scope: ProfileScope | undefined): scope is readonly string[] {
  return Array.isArray(scope);
}

/**
 * A clients-index row's tags (MUT-89): the businesses its entries are in, in
 * the scope's order, else the business it was created in.
 */
function businessesOfClient(client: Client, clientEntries: Transaction[], scope: ProfileScope | undefined): string[] {
  const inEntries = new Set(clientEntries.flatMap((tx) => (tx.profileId ? [tx.profileId] : [])));
  if (inEntries.size === 0) return client.profileId ? [client.profileId] : [];
  const order = isScopeList(scope) ? scope : [...inEntries];
  return order.filter((id) => inEntries.has(id));
}

/**
 * No client and Archived clients for each business in the list (MUT-89, O4),
 * with the same partition as the whole index, so the per-business owed
 * amounts add up to the index's own two. Counts need not: an archived client
 * owing in two businesses is counted in each business's row.
 */
function bucketsPerBusiness(
  entries: Transaction[],
  clients: Client[],
  scope: readonly string[],
  today: string
): OwedBusinessBuckets[] {
  const entriesByBusiness = groupBy(entries, (tx) => tx.profileId ?? '');
  return scope.map((profileId) => {
    const { noClient, archivedClients } = partitionOwedNow(entriesByBusiness.get(profileId) ?? [], clients, today);
    return { profileId, noClient, archivedClients };
  });
}

/** The Insights and Reports client tables' paid/unpaid columns, per currency. */
function perCurrencyReportTotals(clientTxs: Transaction[]) {
  const byCurrency = aggregateTransactionTotalsByCurrency(clientTxs);
  return {
    paidIncomeMinorUSD: byCurrency.USD.paidIncomeMinor,
    paidIncomeMinorILS: byCurrency.ILS.paidIncomeMinor,
    paidIncomeMinorEUR: byCurrency.EUR.paidIncomeMinor,
    unpaidIncomeMinorUSD: byCurrency.USD.unpaidIncomeMinor,
    unpaidIncomeMinorILS: byCurrency.ILS.unpaidIncomeMinor,
    unpaidIncomeMinorEUR: byCurrency.EUR.unpaidIncomeMinor,
  };
}

function buildClientSummary(
  client: Client,
  clientTxs: Transaction[],
  activeProjectCount: number,
  recordsByTx: Map<string, PaymentRecord[]>,
  today: string
): ClientSummary {
  const totals = aggregateTransactionTotalsWithActivity(clientTxs);
  const collection = summarizeClientCollection(clientTxs, recordsByTx, today);
  return {
    id: client.id,
    name: client.name,
    activeProjectCount,
    paidIncomeMinor: totals.paidIncomeMinor,
    unpaidIncomeMinor: totals.unpaidIncomeMinor,
    ...collection,
    lastPaymentAt: collection.lastPayment?.paidAt,
    lastActivityAt: totals.lastActivityAt,
  };
}

// FX Rate Repository
export const fxRateRepo = {
  async list(): Promise<FxRate[]> {
    return db.fxRates.orderBy('effectiveDate').reverse().toArray();
  },

  async getLatest(baseCurrency: Currency, quoteCurrency: Currency): Promise<FxRate | undefined> {
    const rates = await db.fxRates
      .where('[baseCurrency+quoteCurrency]')
      .equals([baseCurrency, quoteCurrency])
      .sortBy('effectiveDate');
    return rates[rates.length - 1];
  },

  async create(data: Omit<FxRate, 'id' | 'createdAt'>): Promise<FxRate> {
    const rate: FxRate = {
      ...data,
      id: generateId(),
      createdAt: nowISO(),
    };
    await db.fxRates.add(rate);
    return rate;
  },

  async delete(id: string): Promise<void> {
    await db.fxRates.delete(id);
  },
};

// Settings Repository
export const settingsRepo = {
  /**
   * The settings row with `features` always fully resolved (MUT-12): a row
   * written before v20, or imported from an older backup, has no `features`
   * field and must read as "everything off", never as `undefined`.
   */
  async get(): Promise<ResolvedSettings> {
    const settings = (await db.settings.get('default')) ?? DEFAULT_SETTINGS;
    return { ...settings, features: { ...resolveFeatures(settings.features) } };
  },

  async update(data: Partial<Settings>): Promise<void> {
    const current = await this.get();
    await db.settings.put({ ...current, ...data, id: 'default' });
  },
};

// ============================================================================
// Business Profile Repository
// ============================================================================

export const businessProfileRepo = {
  async list(includeArchived = false): Promise<BusinessProfile[]> {
    let query = db.businessProfiles.toCollection();
    if (!includeArchived) {
      query = db.businessProfiles.filter((p) => !p.archivedAt);
    }
    return query.sortBy('name');
  },

  async get(id: string): Promise<BusinessProfile | undefined> {
    return db.businessProfiles.get(id);
  },

  async getDefault(): Promise<BusinessProfile | undefined> {
    const profiles = await db.businessProfiles.filter((p) => p.isDefault && !p.archivedAt).toArray();
    return profiles[0];
  },

  // Every write below settles "exactly one default" in the same transaction
  // (MUT-88, ADR-072): a profile made default passes its id as the preference.
  async create(data: Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<BusinessProfile> {
    const now = nowISO();
    const profile: BusinessProfile = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    return db.transaction('rw', db.businessProfiles, async () => {
      await db.businessProfiles.add(profile);
      await enforceSingleDefaultProfile(db.businessProfiles, data.isDefault ? profile.id : undefined);
      return (await db.businessProfiles.get(profile.id)) ?? profile;
    });
  },

  async update(id: string, data: Partial<BusinessProfile>): Promise<void> {
    await db.transaction('rw', db.businessProfiles, async () => {
      await db.businessProfiles.update(id, { ...data, updatedAt: nowISO() });
      // Turning a default off hands the flag to the best of the *other*
      // profiles; otherwise the same rule could pick this one straight back.
      const preferId =
        data.isDefault === true
          ? id
          : data.isDefault === false
            ? pickDefaultProfileId((await db.businessProfiles.toArray()).filter((p) => p.id !== id))
            : undefined;
      await enforceSingleDefaultProfile(db.businessProfiles, preferId);
    });
  },

  async setDefault(id: string): Promise<void> {
    await this.update(id, { isDefault: true });
  },

  async archive(id: string): Promise<void> {
    await db.transaction('rw', db.businessProfiles, async () => {
      await db.businessProfiles.update(id, { archivedAt: nowISO(), updatedAt: nowISO(), isDefault: false });
      await enforceSingleDefaultProfile(db.businessProfiles);
    });
  },

  async delete(id: string): Promise<void> {
    await db.businessProfiles.delete(id);
  },
};

// ============================================================================
// Errors
// ============================================================================

// Custom error for partial payment violations
export class PartialPaymentError extends Error {
  transactionId: string;
  constructor(message: string, transactionId: string) {
    super(message);
    this.name = 'PartialPaymentError';
    this.transactionId = transactionId;
  }
}

// Custom error for payment record violations
export class PaymentRecordError extends Error {
  paymentRecordId?: string;
  transactionId?: string;
  constructor(message: string, opts?: { paymentRecordId?: string; transactionId?: string }) {
    super(message);
    this.name = 'PaymentRecordError';
    this.paymentRecordId = opts?.paymentRecordId;
    this.transactionId = opts?.transactionId;
  }
}

// ============================================================================
// Payment Record Repository
// ============================================================================

/**
 * Recalculate a transaction's receivedAmountMinor from its payment records.
 *
 * This is the sanctioned payment-side writer: receivedAmountMinor / status /
 * paidAt are payment tracking owned by the payment records (ADR-039), so it
 * writes db.transactions.update() directly. (The document lock this comment
 * once explained was removed with documents in MUT-145.)
 */
async function recalculateReceivedAmount(transactionId: string): Promise<void> {
  const tx = await db.transactions.get(transactionId);
  if (!tx) return;

  const records = await db.paymentRecords
    .where('transactionId')
    .equals(transactionId)
    .filter((r) => !r.deletedAt)
    .toArray();

  const sum = records.reduce((acc, r) => acc + r.amountMinor, 0);
  const isNowFullyPaid = sum >= tx.amountMinor;
  const now = nowISO();

  // paidAt must reflect when the money actually arrived, not when this
  // recalculation ran -- fall back to `now` only when no record carries a
  // date (e.g. legacy data with receivedAmountMinor set with no records).
  const latestRecordPaidAt = records.reduce<string | undefined>(
    (latest, r) => (!latest || r.paidAt > latest ? r.paidAt : latest),
    undefined
  );

  await db.transactions.update(transactionId, {
    receivedAmountMinor: sum,
    status: isNowFullyPaid ? 'paid' : 'unpaid',
    paidAt: isNowFullyPaid ? (latestRecordPaidAt ?? now) : undefined,
    updatedAt: now,
  });
}

export { recalculateReceivedAmount };

/**
 * Reject a payment that would push a transaction's recorded payments past its
 * total (ADR-030). The data model has no credit or refund concept, and
 * recalculateReceivedAmount clamps remaining at 0, so an excess would be stored
 * with nothing in the UI able to show it.
 *
 * Call this *inside* the caller's db.transaction('rw', ...) block: the sum and
 * the transaction total must be read in the same transaction as the write, or
 * two concurrent creates both read the same pre-state and both pass.
 *
 * The message deliberately starts with "Payment amount" so getErrorMessage()
 * in useMutationWithFeedback.ts surfaces it verbatim instead of the generic
 * fallback.
 */
async function assertWithinTransactionTotal(
  transactionId: string,
  newAmountMinor: number,
  excludePaymentRecordId?: string
): Promise<void> {
  const tx = await db.transactions.get(transactionId);
  if (!tx) return; // Existence is the caller's check; nothing to compare against.

  const others = await db.paymentRecords
    .where('transactionId')
    .equals(transactionId)
    .filter((r) => !r.deletedAt && r.id !== excludePaymentRecordId)
    .toArray();

  const otherSum = others.reduce((acc, r) => acc + r.amountMinor, 0);
  if (otherSum + newAmountMinor > tx.amountMinor) {
    throw new PaymentRecordError(
      `Payment amount exceeds the remaining balance of ${(tx.amountMinor - otherSum) / 100} ${tx.currency}`,
      { transactionId, paymentRecordId: excludePaymentRecordId }
    );
  }
}

export const paymentRecordRepo = {
  async create(data: {
    transactionId: string;
    amountMinor: number;
    paidAt: string;
    notes?: string;
  }): Promise<PaymentRecord> {
    if (data.amountMinor <= 0) {
      throw new PaymentRecordError('Payment amount must be positive', { transactionId: data.transactionId });
    }
    // A payment can't have arrived before it was received (MUT-18)
    if (isFuturePaymentDate(data.paidAt)) {
      throw new PaymentRecordError('Payment date cannot be in the future', { transactionId: data.transactionId });
    }

    const tx = await db.transactions.get(data.transactionId);
    if (!tx) {
      throw new PaymentRecordError('Transaction not found', { transactionId: data.transactionId });
    }
    if (tx.kind !== 'income') {
      throw new PaymentRecordError('Payment records only apply to income transactions', { transactionId: data.transactionId });
    }

    const now = nowISO();
    const record: PaymentRecord = {
      id: generateId(),
      transactionId: data.transactionId,
      amountMinor: data.amountMinor,
      paidAt: data.paidAt,
      notes: data.notes,
      createdAt: now,
      updatedAt: now,
    };

    await db.transaction('rw', [db.paymentRecords, db.transactions], async () => {
      await assertWithinTransactionTotal(data.transactionId, data.amountMinor);
      await db.paymentRecords.add(record);
      await recalculateReceivedAmount(data.transactionId);
    });

    return record;
  },

  async update(id: string, data: {
    amountMinor?: number;
    paidAt?: string;
    notes?: string;
  }): Promise<void> {
    const record = await db.paymentRecords.get(id);
    if (!record) {
      throw new PaymentRecordError('Payment record not found', { paymentRecordId: id });
    }
    if (record.deletedAt) {
      throw new PaymentRecordError('Payment record has been deleted', { paymentRecordId: id });
    }
    if (data.amountMinor !== undefined && data.amountMinor <= 0) {
      throw new PaymentRecordError('Payment amount must be positive', { paymentRecordId: id, transactionId: record.transactionId });
    }
    if (data.paidAt !== undefined && isFuturePaymentDate(data.paidAt)) {
      throw new PaymentRecordError('Payment date cannot be in the future', { paymentRecordId: id, transactionId: record.transactionId });
    }

    await db.transaction('rw', [db.paymentRecords, db.transactions], async () => {
      if (data.amountMinor !== undefined) {
        await assertWithinTransactionTotal(record.transactionId, data.amountMinor, id);
      }
      await db.paymentRecords.update(id, { ...data, updatedAt: nowISO() });
      await recalculateReceivedAmount(record.transactionId);
    });
  },

  async delete(id: string): Promise<void> {
    const record = await db.paymentRecords.get(id);
    if (!record) {
      throw new PaymentRecordError('Payment record not found', { paymentRecordId: id });
    }

    const now = nowISO();
    await db.transaction('rw', [db.paymentRecords, db.transactions], async () => {
      await db.paymentRecords.update(id, { deletedAt: now, updatedAt: now });
      await recalculateReceivedAmount(record.transactionId);
    });
  },

  async get(id: string): Promise<PaymentRecord | undefined> {
    return db.paymentRecords.get(id);
  },

  async listByTransaction(transactionId: string): Promise<PaymentRecord[]> {
    const records = await db.paymentRecords
      .where('transactionId')
      .equals(transactionId)
      .filter((r) => !r.deletedAt)
      .toArray();

    return records.sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  },

  /**
   * The newest payments across every client (MUT-8, Home's Recent payments):
   * the same rows as a client's Payments section (ADR-033), each naming its
   * client. Deleted entries and records are left out; archived entries'
   * payments stay -- they happened.
   */
  async listRecent(filters: { profileId?: ProfileScope; limit?: number } = {}): Promise<RecentPaymentRow[]> {
    const incomes = await db.transactions
      .filter((tx) => tx.kind === 'income' && !tx.deletedAt && scopeToProfile(tx, filters.profileId))
      .toArray();
    if (incomes.length === 0) return [];

    const [records, clients] = await Promise.all([
      db.paymentRecords
        .where('transactionId')
        .anyOf(incomes.map((tx) => tx.id))
        .filter((r) => !r.deletedAt)
        .toArray(),
      db.clients.toArray(),
    ]);
    const recordsByTx = groupBy(records, (r) => r.transactionId);
    const clientNames = createNameMap(clients);

    const rows: RecentPaymentRow[] = incomes.flatMap((tx) =>
      paymentRowsForIncome(tx, recordsByTx.get(tx.id) ?? []).map((row) => ({
        ...row,
        clientId: tx.clientId,
        clientName: tx.clientId ? clientNames.get(tx.clientId) : undefined,
        profileId: tx.profileId,
      }))
    );

    rows.sort((a, b) => b.paidAt.localeCompare(a.paidAt) || a.id.localeCompare(b.id));
    return rows.slice(0, filters.limit ?? 10);
  },

  /**
   * List a client's payment history, joined to parent income transactions.
   * Sorted by paidAt descending; filters applied before sort and limit.
   *
   * Returns every non-deleted PaymentRecord of the client's live income, plus
   * one 'entry' row per income whose received amount its records do not cover
   * (MUT-3 D3). Income saved as Received writes no record, so without those
   * rows the history would omit every job logged as already paid. Reconciling
   * on read keeps every write path, past and future, correct with no
   * migration.
   *
   * Index: transactions.clientId, then paymentRecords.transactionId (anyOf).
   * Date bounds compare the calendar date of paidAt, which may be a timestamp.
   */
  async listByClient(
    clientId: string,
    filters: PaymentByClientFilters = {}
  ): Promise<PaymentByClientRow[]> {
    const incomes = await db.transactions
      .where('clientId')
      .equals(clientId)
      .filter((tx) => !tx.deletedAt && tx.kind === 'income')
      .toArray();

    if (incomes.length === 0) return [];

    const records = await db.paymentRecords
      .where('transactionId')
      .anyOf(incomes.map((tx) => tx.id))
      .filter((r) => !r.deletedAt)
      .toArray();

    const recordsByTx = groupBy(records, (r) => r.transactionId);
    const rows = incomes.flatMap((tx) => paymentRowsForIncome(tx, recordsByTx.get(tx.id) ?? []));

    const matching = rows.filter((row) => {
      const paidOn = row.paidAt.slice(0, 10);
      if (filters.dateFrom && paidOn < filters.dateFrom) return false;
      if (filters.dateTo && paidOn > filters.dateTo) return false;
      if (filters.currency && row.currency !== filters.currency) return false;
      return true;
    });

    matching.sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    return filters.limit !== undefined ? matching.slice(0, filters.limit) : matching;
  },
};
