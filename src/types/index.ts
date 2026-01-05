// Currency types
export type Currency = 'USD' | 'ILS';

// Transaction types
export type TxKind = 'income' | 'expense';
export type TxStatus = 'paid' | 'unpaid';

// Client entity
export interface Client {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

// Project entity
export interface Project {
  id: string;
  name: string;
  clientId?: string;
  field?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

// Category entity
export interface Category {
  id: string;
  kind: TxKind;
  name: string;
}

// Transaction entity
export interface Transaction {
  id: string;
  kind: TxKind;
  status: TxStatus;
  title?: string;
  clientId?: string;
  projectId?: string;
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  occurredAt: string;
  dueDate?: string;
  paidAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// FX Rate entity
export interface FxRate {
  id: string;
  baseCurrency: Currency;
  quoteCurrency: Currency;
  rate: number;
  effectiveDate: string;
  source: string;
  createdAt: string;
}

// Settings entity
export interface Settings {
  id: string;
  enabledCurrencies: Currency[];
  defaultCurrency: Currency;
  defaultBaseCurrency: Currency;
}

// Query filters for transactions
export interface QueryFilters {
  dateFrom?: string;
  dateTo?: string;
  currency?: Currency;
  kind?: TxKind;
  status?: TxStatus | 'overdue';
  clientId?: string;
  projectId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: { by: string; dir: 'asc' | 'desc' };
}

// Overview totals
export interface OverviewTotals {
  paidIncomeMinor: number;
  unpaidIncomeMinor: number;
  expensesMinor: number;
}

// Project summary for list view
export interface ProjectSummary {
  id: string;
  name: string;
  clientId?: string;
  clientName?: string;
  field?: string;
  paidIncomeMinor: number;
  unpaidIncomeMinor: number;
  expensesMinor: number;
  netMinor: number;
  lastActivityAt?: string;
}

// Client summary for list view
export interface ClientSummary {
  id: string;
  name: string;
  activeProjectCount: number;
  paidIncomeMinor: number;
  unpaidIncomeMinor: number;
  lastPaymentAt?: string;
  lastActivityAt?: string;
}

// Transaction with resolved names for display
export interface TransactionDisplay extends Transaction {
  clientName?: string;
  projectName?: string;
  categoryName?: string;
}
