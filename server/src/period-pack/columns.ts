import type { UserLocale } from '../repositories/ports.js';

/**
 * MUT-314 (ADR-248): every word a period download writes, in English and Arabic (the downloader's language, 13235):
 * sheet names, column headers and widths, the Summary's labels, the index's columns, and the few coded values a
 * reader sees (VAT treatment, payment method, source). The one place a column list lives (red flag 8).
 */
export type Lang = UserLocale;
type Words = Readonly<Record<Lang, string>>;

export interface Column {
  key: string;
  label: Words;
  width: number;
}

const col = (key: string, en: string, ar: string, width: number): Column => ({ key, label: { en, ar }, width });

export const SHEET_NAMES = {
  expenses: { en: 'Expenses', ar: 'المصروفات' },
  income: { en: 'Income', ar: 'الدخل' },
  summary: { en: 'Summary', ar: 'الملخص' },
} as const satisfies Record<string, Words>;

export const EXPENSE_COLUMNS: readonly Column[] = [
  col('ref', 'Ref', 'رقم القيد', 9),
  col('date', 'Date', 'التاريخ', 12),
  col('vendor', 'Vendor', 'المورّد', 24),
  col('description', 'Description', 'الوصف', 30),
  col('category', 'Category', 'الفئة', 18),
  col('client', 'Client', 'العميل', 22),
  col('project', 'Project', 'المشروع', 22),
  col('currency', 'Currency', 'العملة', 9),
  col('amount', 'Amount', 'المبلغ', 14),
  col('net', 'Net', 'الصافي', 14),
  col('vat', 'VAT', 'الضريبة', 12),
  col('vatRate', 'VAT rate %', 'نسبة الضريبة %', 11),
  col('vatTreatment', 'VAT treatment', 'المعاملة الضريبية', 18),
  col('notes', 'Notes', 'ملاحظات', 30),
  col('receipts', 'Receipts', 'الإيصالات', 10),
  col('receiptFiles', 'Receipt files', 'ملفات الإيصالات', 30),
  col('loggedBy', 'Logged by', 'سجّله', 20),
  col('loggedAt', 'Logged at', 'وقت التسجيل', 17),
  col('id', 'Id', 'المعرّف', 38),
];

export const INCOME_COLUMNS: readonly Column[] = [
  col('ref', 'Ref', 'رقم القيد', 9),
  col('date', 'Date received', 'تاريخ الاستلام', 13),
  col('client', 'Client', 'العميل', 22),
  col('project', 'Project', 'المشروع', 22),
  col('currency', 'Currency', 'العملة', 9),
  col('amount', 'Amount', 'المبلغ', 14),
  col('method', 'Method', 'طريقة الدفع', 14),
  col('reference', 'Reference', 'المرجع', 18),
  col('receiptNumber', 'Receipt number', 'رقم الإيصال', 16),
  col('notes', 'Notes', 'ملاحظات', 30),
  col('source', 'Source', 'المصدر', 11),
  col('loggedBy', 'Logged by', 'سجّله', 20),
  col('loggedAt', 'Logged at', 'وقت التسجيل', 17),
  col('id', 'Id', 'المعرّف', 38),
];

export const SUMMARY_LABELS = {
  profile: { en: 'Profile', ar: 'الملف' },
  from: { en: 'From', ar: 'من' },
  to: { en: 'To', ar: 'إلى' },
  generatedAt: { en: 'Generated at', ar: 'أُنشئ في' },
  firstRecord: { en: 'First record', ar: 'أول قيد' },
} as const satisfies Record<string, Words>;

/** The Summary's per-currency table: never summed across currencies (ADR-004). */
export const SUMMARY_COLUMNS: readonly Column[] = [
  col('currency', 'Currency', 'العملة', 14),
  col('expenses', 'Expenses', 'المصروفات', 11),
  col('gross', 'Expenses gross', 'إجمالي المصروفات', 16),
  col('net', 'Expenses net', 'صافي المصروفات', 16),
  col('vat', 'Expenses VAT', 'ضريبة المصروفات', 16),
  col('income', 'Income', 'الدخل', 11),
  col('incomeTotal', 'Income total', 'إجمالي الدخل', 16),
];

/** The receipts zip's index.csv (D8): one line per receipt file. */
export const INDEX_COLUMNS: readonly Column[] = [
  col('file', 'File', 'الملف', 0),
  col('ref', 'Ref', 'رقم القيد', 0),
  col('date', 'Date', 'التاريخ', 0),
  col('vendor', 'Vendor', 'المورّد', 0),
  col('currency', 'Currency', 'العملة', 0),
  col('amount', 'Amount', 'المبلغ', 0),
  col('status', 'Status', 'الحالة', 0),
  col('rowId', 'Row id', 'معرّف القيد', 0),
];

export const VAT_TREATMENT_LABELS: Readonly<Record<string, Words>> = {
  STANDARD_RATED: { en: 'Standard rated', ar: 'خاضع للنسبة الأساسية' },
  ZERO_RATED: { en: 'Zero rated', ar: 'نسبة صفرية' },
  EXEMPT: { en: 'Exempt', ar: 'معفى' },
  OUT_OF_SCOPE: { en: 'Out of scope', ar: 'خارج نطاق الضريبة' },
};

export const PAYMENT_METHOD_LABELS: Readonly<Record<string, Words>> = {
  CASH: { en: 'Cash', ar: 'نقدًا' },
  BANK: { en: 'Bank', ar: 'تحويل بنكي' },
};

export const SOURCE_LABELS = {
  CAPTURE: { en: 'MTB3A', ar: 'متابعة' },
  INTEGRATION: { en: 'Malafat', ar: 'ملفات' },
} as const satisfies Record<string, Words>;

export const headersOf = (columns: readonly Column[], lang: Lang): string[] => columns.map((c) => c.label[lang]);
