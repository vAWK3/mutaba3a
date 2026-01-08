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
