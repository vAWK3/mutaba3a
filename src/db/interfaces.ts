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
  ExpenseCategory,
  Receipt,
  Vendor,
  MonthCloseStatus,
  RecurringRule,
  RetainerAgreement,
  ProjectedIncome,
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
  list(includeArchived?: boolean): Promise<Client[]>;
  archive(id: string): Promise<void>;
}

// ============================================================================
// Project Repository Interface
// ============================================================================

export interface IProjectRepository extends BaseRepository<Project, Omit<Project, 'id' | 'createdAt' | 'updatedAt'>> {
  list(filters?: { clientId?: string; includeArchived?: boolean }): Promise<Project[]>;
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

export interface ITransactionRepository extends BaseRepository<Transaction, Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>> {
  list(filters?: QueryFilters): Promise<TransactionDisplay[]>;
  getDisplay(id: string): Promise<TransactionDisplay | undefined>;
  markPaid(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
  isLocked(id: string): Promise<boolean>;
  getOverviewTotals(filters: { dateFrom: string; dateTo: string; currency?: Currency }): Promise<OverviewTotals>;
  getOverviewTotalsByCurrency(filters: { dateFrom: string; dateTo: string }): Promise<TransactionTotalsByCurrency>;
  getAttentionReceivables(filters: { currency?: Currency }): Promise<TransactionDisplay[]>;
}

// ============================================================================
// Project Summary Repository Interface
// ============================================================================

export interface IProjectSummaryRepository {
  list(filters?: { currency?: Currency; search?: string; field?: string }): Promise<ProjectSummary[]>;
  get(projectId: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }): Promise<ProjectSummary | undefined>;
}

// ============================================================================
// Client Summary Repository Interface
// ============================================================================

export interface IClientSummaryRepository {
  list(filters?: { currency?: Currency; search?: string }): Promise<ClientSummary[]>;
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
  get(): Promise<Settings>;
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
  list(filters?: { profileId?: string; categoryId?: string; vendorId?: string; dateFrom?: string; dateTo?: string }): Promise<Expense[]>;
  softDelete(id: string): Promise<void>;
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

export interface IReceiptRepository extends BaseRepository<Receipt, Omit<Receipt, 'id' | 'createdAt'>> {
  list(filters?: { profileId?: string; expenseId?: string; monthKey?: string }): Promise<Receipt[]>;
  getByExpense(expenseId: string): Promise<Receipt[]>;
}

// ============================================================================
// Vendor Repository Interface
// ============================================================================

export interface IVendorRepository extends BaseRepository<Vendor, Omit<Vendor, 'id' | 'createdAt'>> {
  list(profileId?: string): Promise<Vendor[]>;
  findByName(profileId: string, name: string): Promise<Vendor | undefined>;
}

// ============================================================================
// Month Close Status Repository Interface
// ============================================================================

export interface IMonthCloseStatusRepository {
  get(profileId: string, monthKey: string): Promise<MonthCloseStatus | undefined>;
  set(profileId: string, monthKey: string, isClosed: boolean): Promise<void>;
  list(profileId: string): Promise<MonthCloseStatus[]>;
}

// ============================================================================
// Recurring Rule Repository Interface
// ============================================================================

export interface IRecurringRuleRepository extends BaseRepository<RecurringRule, Omit<RecurringRule, 'id' | 'createdAt'>> {
  list(filters?: { profileId?: string; isPaused?: boolean }): Promise<RecurringRule[]>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
}

// ============================================================================
// Retainer Agreement Repository Interface
// ============================================================================

export interface IRetainerAgreementRepository extends BaseRepository<RetainerAgreement, Omit<RetainerAgreement, 'id' | 'createdAt' | 'updatedAt'>> {
  list(filters?: { profileId?: string; clientId?: string; projectId?: string; status?: string }): Promise<RetainerAgreement[]>;
  archive(id: string): Promise<void>;
}

// ============================================================================
// Projected Income Repository Interface
// ============================================================================

export interface IProjectedIncomeRepository extends BaseRepository<ProjectedIncome, Omit<ProjectedIncome, 'id' | 'createdAt' | 'updatedAt'>> {
  list(filters?: { profileId?: string; sourceId?: string; clientId?: string; state?: string }): Promise<ProjectedIncome[]>;
  getBySource(sourceId: string): Promise<ProjectedIncome[]>;
  getByPeriod(sourceId: string, periodStart: string, periodEnd: string): Promise<ProjectedIncome | undefined>;
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
  expenses: IExpenseRepository;
  expenseCategories: IExpenseCategoryRepository;
  receipts: IReceiptRepository;
  vendors: IVendorRepository;
  monthCloseStatuses: IMonthCloseStatusRepository;
  recurringRules: IRecurringRuleRepository;
  retainerAgreements: IRetainerAgreementRepository;
  projectedIncome: IProjectedIncomeRepository;
}
