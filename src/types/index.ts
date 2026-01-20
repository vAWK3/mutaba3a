// Currency types
export type Currency = 'USD' | 'ILS';

// Currency mode for reports (BOTH shows separate totals per currency)
export type CurrencyMode = 'USD' | 'ILS' | 'BOTH';

// Period preset for reports
export type PeriodPreset = 'month' | 'quarter' | 'year' | 'custom';

// Report types
export type ReportType = 'summary' | 'by-project' | 'by-client' | 'expenses-by-project' | 'unpaid-aging';

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
  linkedDocumentId?: string; // Optional link to invoice/receipt document
  linkedProjectedIncomeId?: string; // Optional link to projected income (from retainer)
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

// Overview totals separated by currency
export interface OverviewTotalsByCurrency {
  USD: OverviewTotals;
  ILS: OverviewTotals;
}

// FX rate source types
export type FxSource = 'live' | 'cached' | 'none';

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
  // Per-currency breakdown (present when currency filter is undefined)
  paidIncomeMinorUSD?: number;
  paidIncomeMinorILS?: number;
  unpaidIncomeMinorUSD?: number;
  unpaidIncomeMinorILS?: number;
  expensesMinorUSD?: number;
  expensesMinorILS?: number;
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
  // Per-currency breakdown (present when currency filter is undefined)
  paidIncomeMinorUSD?: number;
  paidIncomeMinorILS?: number;
  unpaidIncomeMinorUSD?: number;
  unpaidIncomeMinorILS?: number;
}

// Transaction with resolved names for display
export interface TransactionDisplay extends Transaction {
  clientName?: string;
  projectName?: string;
  categoryName?: string;
}

// ============================================================================
// Document / Invoice Types
// ============================================================================

// Document types (invoice, receipt, etc.)
export type DocumentType =
  | 'invoice'
  | 'receipt'
  | 'invoice_receipt'
  | 'credit_note'
  | 'price_offer'
  | 'proforma_invoice'
  | 'donation_receipt';

// Document status
export type DocumentStatus = 'draft' | 'issued' | 'paid' | 'voided';

// Business type for tax purposes
export type BusinessType = 'exempt' | 'authorized' | 'company' | 'lawyer' | 'none';

// Document language
export type DocumentLanguage = 'ar' | 'en';

// Payment method
export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'credit_card' | 'other';

// Template ID type
export type TemplateId = 'template1' | 'template2' | 'template3';

// Business Profile entity (multi-identity support)
export interface BusinessProfile {
  id: string;
  name: string;                    // Business name (Arabic)
  nameEn?: string;                 // Business name (English)
  email: string;
  phone?: string;
  taxId?: string;
  businessType: BusinessType;
  address1?: string;
  address1En?: string;
  city?: string;
  cityEn?: string;
  country?: string;
  countryEn?: string;
  postalCode?: string;
  logoDataUrl?: string;            // Base64 encoded logo (offline-first)
  primaryColor?: string;           // Brand color hex
  defaultCurrency: Currency;
  defaultLanguage: DocumentLanguage;
  isDefault: boolean;              // Only one can be default

  // Document defaults
  website?: string;
  defaultTemplateId?: TemplateId;
  defaultTaxRate?: number;         // e.g., 0.17 for 17%
  allowedCurrencies?: Currency[];  // Restrict available currencies

  // Payment/Bank details (for PDF footer)
  bankName?: string;
  bankBranch?: string;
  bankAccountNumber?: string;
  bankIban?: string;
  paymentNotes?: string;           // Additional payment instructions

  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

// Document line item (embedded in Document.items)
export interface DocumentItem {
  name: string;
  quantity: number;
  rateMinor: number;               // Price per unit in minor units (cents/agorot)
  rateVatMinor: number;            // Price including VAT in minor units
  discountMinor: number;           // Discount in minor units
  taxExempt: boolean;
}

// Document payment record (embedded in Document.payments)
export interface DocumentPayment {
  id: string;
  amountMinor: number;
  currency: Currency;
  method: PaymentMethod;
  details?: Record<string, unknown>;
  notes?: string;
  paidAt: string;
}

// Document entity (Invoice, Receipt, Credit Note, etc.)
export interface Document {
  id: string;
  number: string;                  // Auto-generated: INV-001, REC-001, etc.
  type: DocumentType;
  status: DocumentStatus;
  businessProfileId: string;       // FK to BusinessProfile
  clientId?: string;               // FK to Client

  // Document content
  subject?: string;
  brief?: string;
  notes?: string;

  // Line items (embedded array)
  items: DocumentItem[];

  // Payment records (for receipts)
  payments: DocumentPayment[];

  // Amounts (stored in minor units)
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxRate: number;                 // e.g., 0.18 for 18%
  vatEnabled: boolean;             // Toggle VAT on/off per document

  // Currency & Language
  currency: Currency;
  language: DocumentLanguage;

  // Dates
  issueDate: string;               // ISO date
  dueDate?: string;                // ISO date
  paidAt?: string;                 // ISO timestamp when fully paid

  // References
  refDocumentId?: string;          // For credit notes, links to original document
  linkedTransactionIds: string[];  // Links to transactions table

  // Template
  templateId: string;              // 'template1' | 'template2' | 'template3'

  // Metadata
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;              // Soft delete
}

// Document sequence for auto-numbering
export interface DocumentSequence {
  id: string;                      // "{businessProfileId}:{documentType}"
  businessProfileId: string;
  documentType: DocumentType;
  lastNumber: number;
  prefix: string;                  // Custom prefix (default: "INV", "REC", etc.)
  prefixEnabled: boolean;          // Toggle prefix on/off
  updatedAt: string;
}

// Query filters for documents
export interface DocumentFilters {
  dateFrom?: string;
  dateTo?: string;
  currency?: Currency;
  type?: DocumentType;
  status?: DocumentStatus;
  businessProfileId?: string;
  clientId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: { by: string; dir: 'asc' | 'desc' };
}

// Document with resolved names for display
export interface DocumentDisplay extends Document {
  clientName?: string;
  businessProfileName?: string;
}

// ============================================================================
// Expense Types (Profile-scoped expenses with recurring support)
// ============================================================================

// Expense frequency for recurring rules
export type ExpenseFrequency = 'monthly' | 'yearly';

// Recurring rule end mode
export type RecurringEndMode = 'endOfYear' | 'untilDate' | 'noEnd';

// Expense entity (separate from Transaction, profile-scoped)
export interface Expense {
  id: string;
  profileId: string;
  title?: string;
  vendor?: string;
  vendorId?: string; // Reference to normalized vendor
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  occurredAt: string;
  notes?: string;
  recurringRuleId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// Recurring Rule entity (for monthly/yearly expenses)
export interface RecurringRule {
  id: string;
  profileId: string;
  title: string;
  vendor?: string;
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  frequency: ExpenseFrequency;
  startDate: string;
  endMode: RecurringEndMode;
  endDate?: string;
  isPaused: boolean;
  createdAt: string;
  updatedAt: string;
}

// Receipt entity (stores file as base64, can be linked to expense)
export interface Receipt {
  id: string;
  profileId: string;
  expenseId?: string;
  monthKey: string; // YYYY-MM format
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  data: string; // base64 encoded file
  notes?: string;
  // Metadata for matching
  vendorRaw?: string; // Original vendor text
  vendorId?: string; // Reference to normalized vendor
  amountMinor?: number; // User-entered amount
  currency?: Currency;
  occurredAt?: string; // Manual or file-detected date
  createdAt: string;
  updatedAt: string;
}

// Expense Category (profile-scoped)
export interface ExpenseCategory {
  id: string;
  profileId: string;
  name: string;
  color?: string;
}

// Query filters for expenses
export interface ExpenseFilters {
  profileId?: string;
  year?: number;
  month?: number;
  categoryId?: string;
  currency?: Currency;
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  sort?: { by: string; dir: 'asc' | 'desc' };
}

// Query filters for receipts
export interface ReceiptFilters {
  profileId?: string;
  expenseId?: string;
  monthKey?: string;
  unlinkedOnly?: boolean;
  limit?: number;
  offset?: number;
}

// Expense with resolved names for display
export interface ExpenseDisplay extends Expense {
  categoryName?: string;
  categoryColor?: string;
  receiptCount: number;
  isFromRecurring: boolean;
}

// Monthly expense total
export interface MonthlyExpenseTotal {
  month: number; // 1-12
  totalMinorUSD: number;
  totalMinorILS: number;
}

// Profile expense summary
export interface ProfileExpenseSummary {
  profileId: string;
  profileName: string;
  year: number;
  totalMinorUSD: number;
  totalMinorILS: number;
  monthlyBreakdown: MonthlyExpenseTotal[];
}

// Forecast month data
export interface ForecastMonth {
  month: number;
  year: number;
  projectedMinor: number;
  actualMinor?: number;
  isPast: boolean;
}

// Expense forecast result
export interface ExpenseForecast {
  profileId: string;
  profileName: string;
  year: number;
  monthsRemaining: number;
  projectedTotalMinor: number;
  currency: Currency;
  breakdown: ForecastMonth[];
}

// ============================================================================
// Vendor Types (for vendor normalization)
// ============================================================================

// Vendor entity (normalized vendor names)
export interface Vendor {
  id: string;
  profileId: string;
  canonicalName: string; // The normalized/display name
  aliases: string[]; // Alternative names/spellings
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Receipt Matching Types
// ============================================================================

// Receipt match suggestion with scoring
export interface ReceiptMatchSuggestion {
  receiptId: string;
  expenseId: string;
  score: number; // 0-100
  confidence: 'high' | 'medium' | 'low';
  breakdown: {
    amountScore: number; // 0-50
    dateScore: number; // 0-25
    vendorScore: number; // 0-25
  };
  expense: ExpenseDisplay;
}

// ============================================================================
// Bulk Upload Types
// ============================================================================

// Bulk upload file status
export type BulkUploadStatus = 'pending' | 'uploading' | 'success' | 'error' | 'duplicate';

// Bulk upload file entry
export interface BulkUploadFile {
  file: File;
  detectedMonthKey: string; // YYYY-MM format
  overrideMonthKey?: string; // User override
  status: BulkUploadStatus;
  error?: string;
  receiptId?: string; // Set after successful upload
}

// ============================================================================
// Monthly Close Types
// ============================================================================

// Monthly close checklist items
export interface MonthCloseChecklist {
  receiptsLinked: boolean;
  recurringConfirmed: boolean;
  categorized: boolean;
  zipExported: boolean;
}

// Month close status entity
export interface MonthCloseStatus {
  id: string; // "{profileId}:{monthKey}"
  profileId: string;
  monthKey: string; // YYYY-MM format
  isClosed: boolean;
  closedAt?: string;
  checklist: MonthCloseChecklist;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// Computed status based on actual data
export interface MonthCloseComputedStatus {
  monthKey: string;
  profileId: string;
  unlinkedReceiptsCount: number;
  uncategorizedExpensesCount: number;
  isFullyLinked: boolean;
  isFullyCategorized: boolean;
}

// ============================================================================
// Retainer Types (for recurring income agreements)
// ============================================================================

// Retainer cadence
export type RetainerCadence = 'monthly' | 'quarterly';

// Retainer status
export type RetainerStatus = 'draft' | 'active' | 'paused' | 'ended';

// Projected income state
export type ProjectedIncomeState = 'upcoming' | 'due' | 'received' | 'partial' | 'missed' | 'canceled';

// Retainer Agreement entity
export interface RetainerAgreement {
  id: string;
  profileId: string; // FK to BusinessProfile
  clientId: string;
  projectId?: string;
  title: string;
  currency: Currency;
  amountMinor: number;
  cadence: RetainerCadence;
  paymentDay: number; // 1-28
  startDate: string; // ISO date
  endDate?: string; // ISO date (optional)
  status: RetainerStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

// Projected Income entity (generated from retainers)
export interface ProjectedIncome {
  id: string;
  profileId: string; // FK to BusinessProfile
  sourceType: 'retainer';
  sourceId: string; // Reference to RetainerAgreement.id
  clientId: string;
  projectId?: string;
  currency: Currency;
  expectedAmountMinor: number;
  expectedDate: string; // ISO date
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  state: ProjectedIncomeState;
  receivedAmountMinor: number;
  receivedAt?: string; // ISO timestamp
  matchedTransactionIds: string[];
  createdAt: string;
  updatedAt: string;
}

// Retainer with resolved names for display
export interface RetainerAgreementDisplay extends RetainerAgreement {
  profileName?: string;
  clientName?: string;
  projectName?: string;
  nextExpectedDate?: string;
  dueNowAmountMinor: number;
  lastReceivedDate?: string;
  lastReceivedAmountMinor?: number;
}

// Projected income with resolved names for display
export interface ProjectedIncomeDisplay extends ProjectedIncome {
  clientName?: string;
  projectName?: string;
  retainerTitle?: string;
  daysOverdue?: number;
}

// Query filters for retainers
export interface RetainerFilters {
  profileId?: string;
  status?: RetainerStatus;
  currency?: Currency;
  clientId?: string;
  projectId?: string;
  dueOnly?: boolean;
  search?: string;
}

// Query filters for projected income
export interface ProjectedIncomeFilters {
  profileId?: string;
  sourceId?: string;
  clientId?: string;
  state?: ProjectedIncomeState | ProjectedIncomeState[];
  dateFrom?: string;
  dateTo?: string;
  currency?: Currency;
}

// Retainer match suggestion (for matching transactions to projected income)
export interface RetainerMatchSuggestion {
  projectedIncomeId: string;
  score: number; // 0-100
  confidence: 'high' | 'medium' | 'low';
  projectedIncome: ProjectedIncomeDisplay;
}

// ============================================================================
// Money Answers Types (Unified Financial Cockpit)
// ============================================================================

// Money Event Direction
export type MoneyDirection = 'inflow' | 'outflow';

// Money Event Source
export type MoneyEventSource =
  | 'actual_income'      // Transaction kind=income, status=paid
  | 'actual_cost'        // Transaction kind=expense
  | 'receivable'         // Transaction kind=income, status=unpaid
  | 'profile_expense'    // Expense table
  | 'projected_expense'  // From RecurringRule forecast
  | 'retainer';          // From ProjectedIncome

// Money Event State
export type MoneyEventState =
  | 'paid' | 'unpaid' | 'overdue' | 'upcoming' | 'missed' | 'cancelled';

// Confidence Level
export type MoneyConfidence = 'high' | 'medium' | 'low';

// Core MoneyEvent
export interface MoneyEvent {
  id: string;
  profileId?: string;
  direction: MoneyDirection;
  source: MoneyEventSource;
  state: MoneyEventState;
  amountMinor: number;
  currency: Currency;
  eventDate: string;        // Primary: paidAt || dueDate || expectedDate || occurredAt
  dueDate?: string;
  paidDate?: string;
  expectedDate?: string;
  counterparty?: { id: string; name: string; type: 'client' | 'vendor' };
  title: string;
  confidence: MoneyConfidence;
  sourceEntityId: string;
  sourceEntityType: 'transaction' | 'expense' | 'projectedIncome';
}

// Daily Aggregate
export interface DailyAggregate {
  date: string;
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  runningBalanceMinor: number;
  events: MoneyEvent[];
  confidenceLevel: MoneyConfidence;
}

// Month Summary
export interface MonthSummary {
  month: string;
  totalInflowMinor: number;
  totalOutflowMinor: number;
  netMinor: number;
  awaitingMinor: number;
  projectedOutflowMinor: number;
}

// Year Summary
export interface YearSummary {
  year: number;
  totalInflowMinor: number;
  totalOutflowMinor: number;
  netMinor: number;
  avgAwaitingMinor: number;
  retainerStabilityPercent: number;
  months: MonthSummary[];
  bestMonth?: string;
  worstMonth?: string;
}

// Guidance Item
export type GuidanceSeverity = 'critical' | 'warning' | 'info';
export type GuidanceCategory = 'collect' | 'reduce' | 'delay' | 'hygiene';

export interface GuidanceItem {
  id: string;
  severity: GuidanceSeverity;
  category: GuidanceCategory;
  title: string;
  description: string;
  impactMinor: number;
  impactCurrency: Currency;
  relatedEventIds: string[];
  primaryAction?: { label: string; type: string; payload?: Record<string, unknown> };
}

// Money Answers Filters
export interface MoneyAnswersFilters {
  month?: string; // YYYY-MM
  year?: number;
  currency: Currency;
  includeReceivables?: boolean;
  includeProjections?: boolean;
}
