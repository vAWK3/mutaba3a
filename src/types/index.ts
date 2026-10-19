// Currency types
export type Currency = 'USD' | 'ILS' | 'EUR' | 'JOD' | 'AED' | 'SAR' | 'QAR' | 'BHD' | 'OMR';

// Currency mode for reports (BOTH shows separate totals per currency)
export type CurrencyMode = 'USD' | 'ILS' | 'BOTH';

// Period preset for reports
export type PeriodPreset = 'month' | 'quarter' | 'year' | 'custom';

// Report types
export type ReportType = 'summary' | 'by-project' | 'by-client' | 'expenses-by-project' | 'unpaid-aging';

// Transaction types
export type TxKind = 'income' | 'expense' | 'conversion';
export type TxStatus = 'paid' | 'unpaid';

// Payment status (computed from receivedAmountMinor vs amountMinor)
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

// Client entity
export interface Client {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  /** Business profile this client belongs to */
  profileId?: string;
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
  /** Business profile this project belongs to */
  profileId?: string;
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
  /** Destination side of a `kind: 'conversion'` row; unset for income/expense */
  toCurrency?: Currency;
  /** Destination amount in minor units; unset for income/expense */
  toAmountMinor?: number;
  occurredAt: string;
  dueDate?: string;
  paidAt?: string;
  notes?: string;
  /** Amount received so far (for partial payments on income) */
  receivedAmountMinor?: number;
  /** Business profile this transaction belongs to */
  profileId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  archivedAt?: string;         // ISO timestamp when archived
  needsReview?: boolean;       // Set during migration v17 for records needing user confirmation
}

// Payment Record entity (individual payment on an income transaction)
export interface PaymentRecord {
  id: string;
  transactionId: string;
  amountMinor: number;       // Payment amount in minor units (cents)
  paidAt: string;            // ISO date -- when this specific payment was made
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;        // Soft delete
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

// Optional product areas that can be switched on in Settings (MUT-12).
// The list of keys lives in src/lib/features/features.ts (FEATURE_KEYS);
// this union is the type-level mirror so the types module stays import-free.
export type FeatureKey =
  | 'expenses'
  | 'insights'
  | 'projects'
  | 'conversions';

// Settings entity
export interface Settings {
  id: string;
  enabledCurrencies: Currency[];
  defaultCurrency: Currency;
  defaultBaseCurrency: Currency;
  /**
   * Optional areas, off unless the user (or the v20 upgrade / an import
   * reconcile) turned them on. Optional on the row so pre-v20 rows and
   * imported backups resolve to defaults; `settingsRepo.get()` always
   * returns a fully resolved map.
   */
  features?: Partial<Record<FeatureKey, boolean>>;
  /** Areas that were auto-enabled and not yet shown to the user; cleared once told. */
  featureNotice?: FeatureKey[];
  /**
   * When the last full backup was made on this device (ISO), shown in
   * Settings › Your data (MUT-88, ADR-072). Set by `backUpNow` once the file
   * was produced, and by a restore to that backup's own timestamp.
   */
  lastBackupAt?: string;
  /**
   * Malafat suggestions in the web app (MUT-190, ADR-078): `off` is the Settings
   * switch, `dismissed` the moments the person retired for good. Optional, so
   * older rows and backups read as "on, nothing dismissed".
   */
  malafatSuggestions?: StoredMalafatSuggestions;
}

/** A contextual Malafat suggestion that can be retired (the Settings row itself can't). */
export type MalafatMoment = 'business-profile' | 'client-threshold' | 'second-business';

export interface StoredMalafatSuggestions {
  off?: boolean;
  dismissed?: MalafatMoment[];
}

/** What `settingsRepo.get()` returns: the row with `features` fully resolved. */
export type ResolvedSettings = Settings & { features: Record<FeatureKey, boolean> };

// Query filters for transactions
/**
 * Which businesses a read covers: one business id, or several for the "All
 * businesses" lens on Home and Clients (MUT-89, ADR-051).
 * - absent (undefined) or an empty string: every record;
 * - a list: records of those businesses only. A record with no business never
 *   matches, and an empty list matches no record (unlike an empty string).
 */
export type ProfileScope = string | readonly string[];

export interface QueryFilters {
  dateFrom?: string;
  dateTo?: string;
  currency?: Currency;
  kind?: TxKind;
  status?: TxStatus | 'overdue';
  clientId?: string;
  projectId?: string;
  /** Filter by business: one id, or several for All businesses (undefined = every record) */
  profileId?: ProfileScope;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: { by: string; dir: 'asc' | 'desc' };
  includeArchived?: boolean;
  /** Only entries with no client, or only those of archived clients (MUT-83) */
  clientScope?: ClientScope;
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
  EUR: OverviewTotals;
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
  paidIncomeMinorEUR?: number;
  unpaidIncomeMinorUSD?: number;
  unpaidIncomeMinorILS?: number;
  unpaidIncomeMinorEUR?: number;
  expensesMinorUSD?: number;
  expensesMinorILS?: number;
  expensesMinorEUR?: number;
}

// Client summary for list view
/** What a client (or everyone) owes in one currency, right now (ADR-033). */
export interface OwedByCurrency {
  currency: Currency;
  owedMinor: number;
  /** The part of owedMinor whose due date has passed (ADR-010) */
  overdueMinor: number;
}

/** A client's most recent payment, in its own currency (MUT-7). */
export interface LastPayment {
  paidAt: string;
  amountMinor: number;
  currency: Currency;
}

export interface ClientSummary {
  id: string;
  name: string;
  activeProjectCount: number;
  paidIncomeMinor: number;
  unpaidIncomeMinor: number;
  /** Owed now per currency; [] when settled. Archived income excluded (ADR-033) */
  owed: OwedByCurrency[];
  /** Whole days the client's oldest overdue item is late; undefined when none is */
  oldestOverdueDays?: number;
  /** Newest payment: records plus income saved as received (ADR-033) */
  lastPayment?: LastPayment;
  /** lastPayment.paidAt */
  lastPaymentAt?: string;
  lastActivityAt?: string;
  // Per-currency report totals (present when list() has no currency filter).
  // Read by the Insights and Reports client tables. Unlike `owed`, unpaid here
  // still counts archived income (TD-030).
  paidIncomeMinorUSD?: number;
  paidIncomeMinorILS?: number;
  paidIncomeMinorEUR?: number;
  unpaidIncomeMinorUSD?: number;
  unpaidIncomeMinorILS?: number;
  unpaidIncomeMinorEUR?: number;
}

/**
 * Entries whose balance belongs to no listed client (MUT-83, ADR-049):
 * 'none' = no client, or its client row is gone; 'archived' = an archived client.
 */
export type ClientScope = 'none' | 'archived';

/** Owed now that belongs to no listed client: one muted row on the clients index (MUT-83). */
export interface OwedBucket {
  owed: OwedByCurrency[];
  /** No client: entries with a balance. Archived clients: clients with a balance. */
  count: number;
}

/** A clients-index row: a client's summary and the businesses it is tagged with */
export interface ClientOwedIndexRow extends ClientSummary {
  /**
   * The businesses of the client's entries in the index's scope, in scope
   * order, or its own business when it has none: the tags "All businesses"
   * shows on the row (MUT-89).
   */
  profileIds: string[];
}

/**
 * The clients index of one business (MUT-83, ADR-049): every figure comes
 * from the entries recorded in that business, the same set Home's Owed now sums.
 */
export interface ClientOwedIndex {
  /** The listed clients; every column counts only this business's entries */
  clients: ClientOwedIndexRow[];
  /** Owed now over every entry in the business: equals Home's (ADR-036 §5) */
  total: OwedByCurrency[];
  noClient: OwedBucket;
  archivedClients: OwedBucket;
  /**
   * All businesses only (MUT-89, O4): No client and Archived clients per
   * business, in the scope's order, so each muted row can open Income in its
   * own business. Present whenever `profileId` is a list; absent for a single
   * id or undefined.
   */
  byProfile?: OwedBusinessBuckets[];
}

/** One business's muted rows on the clients index under All businesses (MUT-89) */
export interface OwedBusinessBuckets {
  profileId: string;
  noClient: OwedBucket;
  archivedClients: OwedBucket;
}

// Filters for client-level payment history (MUT-4)
export interface PaymentByClientFilters {
  dateFrom?: string; // inclusive, compared against paidAt (YYYY-MM-DD or ISO)
  dateTo?: string;   // inclusive
  currency?: Currency;
  limit?: number;
}

// A payment joined to its parent income transaction, for display.
// 'record' rows are PaymentRecords. 'entry' rows stand for money an income
// entry says was received but no record covers -- income saved as Received in
// the income drawer writes none (MUT-3). An entry row's id is `entry:<txId>`.
export type PaymentRowSource = 'record' | 'entry';

export interface PaymentByClientRow {
  id: string;
  transactionId: string;
  transactionTitle?: string;
  amountMinor: number;
  currency: Currency;
  paidAt: string;
  notes?: string;
  source: PaymentRowSource;
}

// A payment on Home's Recent payments (MUT-8): a client payment row plus the
// client it came from (absent for income with no client)
export interface RecentPaymentRow extends PaymentByClientRow {
  clientId?: string;
  clientName?: string;
  /** The business of the entry it paid: Home's tag under All businesses (MUT-89) */
  profileId?: string;
}

// Transaction with resolved names for display
export interface TransactionDisplay extends Transaction {
  clientName?: string;
  projectName?: string;
  categoryName?: string;
  daysOverdue?: number;
  /** Computed payment status (only for income transactions) */
  paymentStatus?: PaymentStatus;
  /** Remaining amount to be paid (only for income transactions) */
  remainingAmountMinor?: number;
}

// ============================================================================
// Business Profile Types
// ============================================================================

// Payment method
export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'credit_card' | 'other';

// Business Profile entity (multi-identity support).
// MUT-145 dropped the invoice-letterhead fields (tax ID, addresses, business
// type, document language). Older rows keep them; nothing reads them.
export interface BusinessProfile {
  id: string;
  name: string;                    // Business name (Arabic)
  nameEn?: string;                 // Business name (English)
  email?: string;                  // Optional contact detail (MUT-145)
  phone?: string;
  logoDataUrl?: string;            // Base64 encoded logo (offline-first)
  primaryColor?: string;           // Profile color hex (badges, avatars)
  defaultCurrency: Currency;       // Default for new income entries
  isDefault: boolean;              // Only one can be default

  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
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
  clientId?: string; // Optional: associate expense with a client
  projectId?: string; // Optional: associate expense with a project
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  occurredAt: string;
  notes?: string;
  recurringRuleId?: string;
  recurringOccurrenceId?: string; // FK to persisted occurrence
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
  vendorId?: string;
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  frequency: ExpenseFrequency;
  dayOfMonth: number;              // 1-28 (avoids end-of-month edge cases)
  monthOfYear?: number;            // 1-12, REQUIRED when frequency='yearly'
  startDate: string;
  endMode: RecurringEndMode;
  endDate?: string;
  projectId?: string;              // Optional: link to project
  scope: 'general' | 'project';    // General or project-scoped expense
  notes?: string;                  // Default notes for occurrences
  reminderDaysBefore: number;      // Days before due to show reminder (default: 0)
  isPaused: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;              // Soft delete support
}

// Recurring Occurrence status (only what needs persistence)
export type RecurringOccurrenceStatus =
  | 'snoozed'           // User deferred, will resurface
  | 'resolved_paid'     // User confirmed → Expense created
  | 'resolved_skipped'; // User skipped, no expense

// Computed display states (NOT persisted)
export type ComputedOccurrenceState =
  | 'projected'   // Future, not yet due
  | 'due'         // Within reminder window or on expected date
  | 'overdue';    // Past expected date, no action taken

// Recurring Occurrence entity (persisted only when user acts)
export interface RecurringOccurrence {
  id: string;
  ruleId: string;                  // FK to RecurringRule
  profileId: string;               // REQUIRED - copied from rule, explicit scoping
  expectedDate: string;            // ISO date (YYYY-MM-DD)
  amountMinorSnapshot: number;     // Amount at time rule was checked
  currencySnapshot: Currency;      // Currency (never changes)
  status: RecurringOccurrenceStatus;

  // Resolution tracking
  fulfilledExpenseId?: string;     // FK to Expense if resolved_paid
  resolvedAt?: string;             // ISO timestamp when resolved (paid or skipped)
  snoozeUntil?: string;            // ISO date if snoozed

  // Override fields (user can adjust before confirming)
  actualAmountMinor?: number;      // If user edited amount
  actualPaidDate?: string;         // Actual payment date (may differ from expected)
  notes?: string;                  // Per-occurrence notes

  createdAt: string;
  updatedAt: string;
}

// Virtual Occurrence (computed, not persisted)
export interface VirtualOccurrence {
  ruleId: string;
  profileId: string;
  expectedDate: string;
  amountMinor: number;
  currency: Currency;
  computedState: ComputedOccurrenceState;

  // Check if persisted occurrence exists
  persistedOccurrence?: RecurringOccurrence;
}

// Virtual Occurrence with resolved display names
export interface VirtualOccurrenceDisplay extends VirtualOccurrence {
  // Resolved from rule
  ruleTitle: string;
  frequency: ExpenseFrequency;     // "$80 monthly" on the Needs attention row (MUT-87)
  vendor?: string;
  vendorName?: string;
  categoryId?: string;
  categoryName?: string;
  categoryColor?: string;
  projectId?: string;
  projectName?: string;

  // Computed
  daysUntilDue: number;           // Negative if overdue
  isOverdue: boolean;
  isUpcoming: boolean;            // Due but not overdue

  // Display helpers
  effectiveAmount: number;        // From rule or override
  effectiveCurrency: Currency;
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
  clientId?: string;
  projectId?: string;
  year?: number;
  month?: number;
  dateFrom?: string;
  dateTo?: string;
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

// Query filters for recurring occurrences
export interface RecurringOccurrenceFilters {
  profileId: string;              // REQUIRED for proper scoping
  ruleId?: string;
  status?: RecurringOccurrenceStatus | RecurringOccurrenceStatus[];
  dateFrom?: string;
  dateTo?: string;
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

// ============================================================================
// Forecast KPI Types (Financial Intelligence)
// ============================================================================

/**
 * Amount broken down by currency. Never silently summed across currencies.
 */
export interface AmountByCurrency {
  USD: number;
  ILS: number;
  EUR: number;
  JOD: number;
}

/**
 * Month actuals for the collapsible row on Home.
 * Only includes realized transactions, no projections.
 */
export interface MonthActuals {
  /** Month in YYYY-MM format */
  month: string;
  /** Total received (paid income) */
  received: AmountByCurrency;
  /** Total unpaid income (receivables) */
  unpaid: AmountByCurrency;
  /** Total expenses */
  expenses: AmountByCurrency;
  /** Net (received - expenses) */
  net: AmountByCurrency;
}

/**
 * Attention item for the Home page feed.
 * Replaces GuidanceItem with clearer semantics.
 */
export interface AttentionItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'collect' | 'reduce' | 'hygiene';
  title: string;
  description: string;
  /** Impact amount in minor units */
  impactMinor: number;
  impactCurrency: Currency;
  /** IDs of related transactions/expenses */
  relatedEntityIds: string[];
  /** Primary action button */
  action?: {
    label: string;
    /** Action type determines routing behavior */
    type: 'openIncomeDrawer' | 'navigateToIncome' | 'navigateToInsights';
    /** Entity ID for drawer actions */
    entityId?: string;
    /** URL params for navigation actions */
    urlParams?: Record<string, string>;
  };
}

