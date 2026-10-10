/**
 * Repository Interfaces
 *
 * These interfaces define the contract for all data access operations.
 * Currently implemented by Dexie (IndexedDB), but designed to allow
 * future implementation with SQLite in Tauri desktop builds.
 *
 * Usage:
 * - Web/PWA: Uses Dexie implementation (IndexedDB)
 * - Tauri Desktop (future): Uses SQLite implementation via Tauri SQL plugin
 *
 * @see CLAUDE.md for architecture decisions
 * @see .claude/TECH_DEBT.md TD-013 for migration tracking
 */

import type {
  Client,
  Project,
  Category,
  Transaction,
  FxRate,
  Settings,
  ResolvedSettings,
  QueryFilters,
  OverviewTotals,
  ProjectSummary,
  ClientSummary,
  TransactionDisplay,
  Currency,
  BusinessProfile,
  Document,
  DocumentSequence,
  DocumentFilters,
  DocumentDisplay,
  DocumentType,
  Expense,
  ExpenseDisplay,
  ExpenseFilters,
  MonthlyExpenseTotal,
  ProfileExpenseSummary,
  ExpenseCategory,
  Receipt,
  Vendor,
  MonthCloseStatus,
  MonthCloseChecklist,
  MonthCloseComputedStatus,
  RecurringRule,
  RecurringOccurrence,
  RecurringOccurrenceStatus,
  RetainerAgreement,
  RetainerAgreementDisplay,
  ProjectedIncome,
  ProjectedIncomeDisplay,
  ProjectedIncomeFilters,
  PaymentRecord,
  PaymentByClientFilters,
  PaymentByClientRow,
} from '../types';
import type { TransactionTotalsByCurrency } from './aggregations';

// ============================================================================
// Base Repository Interface
// ============================================================================

export interface BaseRepository<T, CreateData, ID = string> {
  get(id: ID): Promise<T | undefined>;
  create(data: CreateData): Promise<T>;
  update(id: ID, data: Partial<T>): Promise<void>;
  delete(id: ID): Promise<void>;
}

// ============================================================================
// Client Repository Interface
// ============================================================================

export interface IClientRepository extends BaseRepository<Client, Omit<Client, 'id' | 'createdAt' | 'updatedAt'>> {
  list(filters?: { profileId?: string; includeArchived?: boolean }): Promise<Client[]>;
  archive(id: string): Promise<void>;
}

// ============================================================================
// Project Repository Interface
// ============================================================================

export interface IProjectRepository extends BaseRepository<Project, Omit<Project, 'id' | 'createdAt' | 'updatedAt'>> {
  list(filters?: { profileId?: string; clientId?: string; includeArchived?: boolean }): Promise<Project[]>;
  archive(id: string): Promise<void>;
}

// ============================================================================
// Category Repository Interface
// ============================================================================

export interface ICategoryRepository extends BaseRepository<Category, Omit<Category, 'id'>> {
  list(kind?: 'income' | 'expense'): Promise<Category[]>;
}

// ============================================================================
// Transaction Repository Interface
// ============================================================================

/**
 * Transactions are soft-deleted, never hard-deleted, so `delete` is omitted
 * from the base contract. Use `softDelete`.
 */
export interface ITransactionRepository
  extends Omit<BaseRepository<Transaction, Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>, 'delete'> {
  list(filters?: QueryFilters): Promise<TransactionDisplay[]>;
  getDisplay(id: string): Promise<TransactionDisplay | undefined>;
  markPaid(id: string, opts?: { paidAt?: string }): Promise<void>;
  recordPartialPayment(id: string, paymentAmountMinor: number, opts?: { paidAt?: string }): Promise<void>;
  softDelete(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
  isLocked(id: string): Promise<boolean>;
  getOverviewTotals(filters: { dateFrom: string; dateTo: string; currency?: Currency; profileId?: string }): Promise<OverviewTotals>;
  getOverviewTotalsByCurrency(filters: { dateFrom: string; dateTo: string; profileId?: string }): Promise<TransactionTotalsByCurrency>;
  getAttentionReceivables(filters: { currency?: Currency; profileId?: string }): Promise<TransactionDisplay[]>;
}

// ============================================================================
// Project Summary Repository Interface
// ============================================================================

export interface IProjectSummaryRepository {
  list(filters?: { profileId?: string; currency?: Currency; search?: string; field?: string }): Promise<ProjectSummary[]>;
  get(projectId: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }): Promise<ProjectSummary | undefined>;
}

// ============================================================================
// Client Summary Repository Interface
// ============================================================================

export interface IClientSummaryRepository {
  list(filters?: { profileId?: string; currency?: Currency; search?: string }): Promise<ClientSummary[]>;
  get(clientId: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }): Promise<ClientSummary | undefined>;
}

// ============================================================================
// FX Rate Repository Interface
// ============================================================================

export interface IFxRateRepository {
  list(): Promise<FxRate[]>;
  getLatest(baseCurrency: Currency, quoteCurrency: Currency): Promise<FxRate | undefined>;
  create(data: Omit<FxRate, 'id' | 'createdAt'>): Promise<FxRate>;
  delete(id: string): Promise<void>;
}

// ============================================================================
// Settings Repository Interface
// ============================================================================

export interface ISettingsRepository {
  /** The settings row with `features` fully resolved (every key present, boolean). */
  get(): Promise<ResolvedSettings>;
  update(data: Partial<Settings>): Promise<void>;
}

// ============================================================================
// Business Profile Repository Interface
// ============================================================================

export interface IBusinessProfileRepository extends BaseRepository<BusinessProfile, Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'>> {
  list(includeArchived?: boolean): Promise<BusinessProfile[]>;
  getDefault(): Promise<BusinessProfile | undefined>;
  setDefault(id: string): Promise<void>;
  archive(id: string): Promise<void>;
}

// ============================================================================
// Document Sequence Repository Interface
// ============================================================================

export interface IDocumentSequenceRepository {
  getNextNumber(businessProfileId: string, documentType: DocumentType): Promise<string>;
  get(businessProfileId: string, documentType: DocumentType): Promise<DocumentSequence | undefined>;
  listByBusinessProfile(businessProfileId: string): Promise<DocumentSequence[]>;
  update(businessProfileId: string, documentType: DocumentType, data: Partial<DocumentSequence>): Promise<void>;
  getOrCreate(businessProfileId: string, documentType: DocumentType): Promise<DocumentSequence>;
}

// ============================================================================
// Document Repository Interface
// ============================================================================

export interface IDocumentRepository {
  list(filters?: DocumentFilters): Promise<DocumentDisplay[]>;
  get(id: string): Promise<Document | undefined>;
  getByNumber(number: string): Promise<Document | undefined>;
  isNumberTaken(number: string, excludeId?: string): Promise<boolean>;
  create(data: Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt'>): Promise<Document>;
  createWithNumber(data: Omit<Document, 'id' | 'createdAt' | 'updatedAt'> & { number: string }): Promise<Document>;
  getNextAvailableNumber(businessProfileId: string, type: DocumentType): Promise<string>;
  update(id: string, data: Partial<Document>): Promise<void>;
  markPaid(id: string): Promise<void>;
  markVoided(id: string): Promise<void>;
  markIssued(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
  linkTransactions(documentId: string, transactionIds: string[]): Promise<void>;
  unlinkTransaction(documentId: string, transactionId: string): Promise<void>;
  lockAfterExport(id: string, pdfSavedPath?: string): Promise<number>;
  isLocked(id: string): Promise<boolean>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
}

// ============================================================================
// Expense Repository Interface
// ============================================================================

export interface IExpenseRepository extends BaseRepository<Expense, Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>> {
  /** Returns display rows (receipt count, recurring flag), not bare entities. */
  list(filters?: ExpenseFilters): Promise<ExpenseDisplay[]>;
  softDelete(id: string): Promise<void>;
  getYearlyTotals(
    profileId: string,
    year: number
  ): Promise<{ totalMinorUSD: number; totalMinorILS: number; byMonth: MonthlyExpenseTotal[] }>;
  getAllProfilesTotals(year: number): Promise<ProfileExpenseSummary[]>;
  getReceiptCount(expenseId: string): Promise<number>;
}

// ============================================================================
// Expense Category Repository Interface
// ============================================================================

export interface IExpenseCategoryRepository extends BaseRepository<ExpenseCategory, Omit<ExpenseCategory, 'id'>> {
  list(profileId?: string): Promise<ExpenseCategory[]>;
}

// ============================================================================
// Receipt Repository Interface
// ============================================================================

export interface IReceiptRepository extends BaseRepository<Receipt, Omit<Receipt, 'id' | 'createdAt' | 'updatedAt'>> {
  list(filters?: { profileId?: string; expenseId?: string; monthKey?: string }): Promise<Receipt[]>;
  linkToExpense(receiptId: string, expenseId: string): Promise<void>;
  unlinkFromExpense(receiptId: string): Promise<void>;
  getUnlinkedByProfile(profileId: string): Promise<Receipt[]>;
  getByProfileAndMonth(profileId: string, monthKey: string): Promise<Receipt[]>;
  getLinkedByProfileAndMonth(profileId: string, monthKey: string): Promise<Receipt[]>;
}

// ============================================================================
// Vendor Repository Interface
// ============================================================================

export interface IVendorRepository extends BaseRepository<Vendor, Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>> {
  list(profileId?: string): Promise<Vendor[]>;
  /** Vendors are matched by alias, not by exact name. */
  findByAlias(profileId: string, rawVendor: string): Promise<Vendor | undefined>;
  findOrCreate(profileId: string, rawVendor: string): Promise<Vendor>;
  mergeVendors(targetId: string, sourceId: string): Promise<void>;
  addAlias(vendorId: string, alias: string): Promise<void>;
}

// ============================================================================
// Month Close Status Repository Interface
// ============================================================================

export interface IMonthCloseStatusRepository {
  /** Looks up by the status row's own id, not by profile + month. */
  get(id: string): Promise<MonthCloseStatus | undefined>;
  getByProfileAndMonth(profileId: string, monthKey: string): Promise<MonthCloseStatus | undefined>;
  getOrCreate(profileId: string, monthKey: string): Promise<MonthCloseStatus>;
  updateChecklist(profileId: string, monthKey: string, updates: Partial<MonthCloseChecklist>): Promise<void>;
  closeMonth(profileId: string, monthKey: string, notes?: string): Promise<void>;
  reopenMonth(profileId: string, monthKey: string): Promise<void>;
  isMonthClosed(profileId: string, monthKey: string): Promise<boolean>;
  getComputedStatus(profileId: string, monthKey: string): Promise<MonthCloseComputedStatus>;
  list(profileId: string): Promise<MonthCloseStatus[]>;
}

// ============================================================================
// Recurring Rule Repository Interface
// ============================================================================

export interface IRecurringRuleRepository extends BaseRepository<RecurringRule, Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>> {
  list(filters?: {
    profileId?: string;
    isPaused?: boolean;
    scope?: 'general' | 'project';
  }): Promise<RecurringRule[]>;
  listActive(profileId: string): Promise<RecurringRule[]>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
}

// ============================================================================
// Recurring Occurrence Repository Interface
// ============================================================================

export interface IRecurringOccurrenceRepository extends BaseRepository<RecurringOccurrence, Omit<RecurringOccurrence, 'id' | 'createdAt' | 'updatedAt'>> {
  // Query - always profile-scoped
  list(filters: {
    profileId: string;              // REQUIRED
    ruleId?: string;
    status?: RecurringOccurrenceStatus | RecurringOccurrenceStatus[];
    dateFrom?: string;
    dateTo?: string;
  }): Promise<RecurringOccurrence[]>;

  getByRuleAndDate(ruleId: string, expectedDate: string): Promise<RecurringOccurrence | undefined>;

  // Get history for a specific rule
  getHistoryForRule(ruleId: string): Promise<RecurringOccurrence[]>;
}

// ============================================================================
// Retainer Agreement Repository Interface
// ============================================================================

/** Retainers are archived or ended, never hard-deleted, so `delete` is omitted. */
export interface IRetainerAgreementRepository
  extends Omit<BaseRepository<RetainerAgreement, Omit<RetainerAgreement, 'id' | 'createdAt' | 'updatedAt'>>, 'delete'> {
  list(filters?: { profileId?: string; clientId?: string; projectId?: string; status?: string }): Promise<RetainerAgreementDisplay[]>;
  getDisplay(id: string): Promise<RetainerAgreementDisplay | undefined>;
  archive(id: string): Promise<void>;
  activate(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  end(id: string): Promise<void>;
}

// ============================================================================
// Projected Income Repository Interface
// ============================================================================

/**
 * Projected income rows are generated from a retainer's schedule, so this
 * repository has no `create` and no `delete` — it extends nothing.
 */
export interface IProjectedIncomeRepository {
  get(id: string): Promise<ProjectedIncome | undefined>;
  update(id: string, data: Partial<ProjectedIncome>): Promise<void>;
  list(filters?: ProjectedIncomeFilters): Promise<ProjectedIncomeDisplay[]>;
  getByRetainer(retainerId: string): Promise<ProjectedIncome[]>;
  getDueItems(currency?: Currency): Promise<ProjectedIncomeDisplay[]>;
  getForForecast(dateFrom: string, dateTo: string, currency?: Currency): Promise<ProjectedIncome[]>;
}

// ============================================================================
// Payment Record Repository Interface
// ============================================================================

export interface IPaymentRecordRepository {
  get(id: string): Promise<PaymentRecord | undefined>;
  listByTransaction(transactionId: string): Promise<PaymentRecord[]>;
  listByClient(clientId: string, filters?: PaymentByClientFilters): Promise<PaymentByClientRow[]>;
  create(data: { transactionId: string; amountMinor: number; paidAt: string; notes?: string }): Promise<PaymentRecord>;
  update(id: string, data: { amountMinor?: number; paidAt?: string; notes?: string }): Promise<void>;
  delete(id: string): Promise<void>;
}

// ============================================================================
// Synced Repository Interfaces
// ============================================================================

/**
 * The op-capturing decorators in `sync/core/synced-repository.ts` expose a
 * NARROWER surface than the base repositories they wrap — they only forward
 * the reads and writes that sync cares about. These `Pick`s describe what each
 * decorator actually has, so the contract stays tied to the base interfaces
 * instead of duplicating their signatures.
 *
 * Note the asymmetry: `transactions` has no `delete` and no `getDisplay`,
 * `businessProfiles` has no `getDefault` passthrough beyond what is listed,
 * and there is no synced expense repository at all — expenses never enter the
 * op-log. See `provider.ts` and TODOS.md item 1.
 */
export interface ISyncedRepositories {
  clients: Pick<IClientRepository, 'list' | 'get' | 'create' | 'update' | 'archive' | 'delete'>;
  projects: Pick<IProjectRepository, 'list' | 'get' | 'create' | 'update' | 'archive' | 'delete'>;
  transactions: Pick<
    ITransactionRepository,
    | 'list'
    | 'get'
    | 'getOverviewTotals'
    | 'getOverviewTotalsByCurrency'
    | 'getAttentionReceivables'
    | 'create'
    | 'update'
    | 'markPaid'
    | 'recordPartialPayment'
    | 'softDelete'
  >;
  categories: Pick<ICategoryRepository, 'list' | 'get' | 'create' | 'update' | 'delete'>;
  fxRates: Pick<IFxRateRepository, 'list' | 'getLatest' | 'create' | 'delete'>;
  businessProfiles: Pick<
    IBusinessProfileRepository,
    'list' | 'get' | 'getDefault' | 'create' | 'update' | 'setDefault' | 'archive' | 'delete'
  >;
  documents: Pick<
    IDocumentRepository,
    | 'list'
    | 'get'
    | 'getByNumber'
    | 'create'
    | 'update'
    | 'markPaid'
    | 'markVoided'
    | 'softDelete'
    | 'linkTransactions'
    | 'unlinkTransaction'
  >;
  paymentRecords: IPaymentRecordRepository;
}

// ============================================================================
// Complete Repository Provider Interface
// ============================================================================

/**
 * Repository provider that returns the appropriate implementation
 * based on the runtime environment (IndexedDB for web, SQLite for Tauri).
 */
export interface IRepositoryProvider {
  clients: IClientRepository;
  projects: IProjectRepository;
  categories: ICategoryRepository;
  transactions: ITransactionRepository;
  projectSummaries: IProjectSummaryRepository;
  clientSummaries: IClientSummaryRepository;
  fxRates: IFxRateRepository;
  settings: ISettingsRepository;
  businessProfiles: IBusinessProfileRepository;
  documentSequences: IDocumentSequenceRepository;
  documents: IDocumentRepository;
  paymentRecords: IPaymentRecordRepository;
  expenses: IExpenseRepository;
  expenseCategories: IExpenseCategoryRepository;
  receipts: IReceiptRepository;
  vendors: IVendorRepository;
  monthCloseStatuses: IMonthCloseStatusRepository;
  recurringRules: IRecurringRuleRepository;
  recurringOccurrences: IRecurringOccurrenceRepository;
  retainerAgreements: IRetainerAgreementRepository;
  projectedIncome: IProjectedIncomeRepository;
}
