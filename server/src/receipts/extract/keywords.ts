import { foldForMatch } from './normalize.js';

/**
 * MUT-441: the labels receipts print, in Hebrew, Arabic and English. Matched on folded text (`foldForMatch`), as whole
 * words: a keyword never matches inside a longer word (`total` not in `subtotal`, `ע"מ` not in `בע"מ`).
 */
export type KeywordSet = readonly RegExp[];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function keywords(...words: string[]): KeywordSet {
  return words.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(foldForMatch(w))}(?![\\p{L}])`, 'u'));
}

export function hasKeyword(folded: string, set: KeywordSet): boolean {
  return set.some((pattern) => pattern.test(folded));
}

export const TOTAL = keywords(
  'סה"כ', 'סהכ', 'סך הכל', 'סך הכול', 'לתשלום', 'המחיר', 'סכום לתשלום',
  'المجموع', 'الإجمالي', 'اجمالي', 'المبلغ الإجمالي', 'المبلغ المستحق', 'المطلوب', 'المجموع الكلي',
  'total', 'amount due', 'grand total', 'balance due', 'total due', 'to pay',
);

/** The amount before VAT. */
export const SUBTOTAL = keywords(
  'סכום ביניים', 'לפני מע"מ', 'ללא מע"מ', 'המחיר לפני מע"מ',
  'المجموع الفرعي', 'قبل الضريبة', 'غير شامل',
  'subtotal', 'sub total', 'sub-total', 'before vat', 'before tax', 'excl', 'excluding',
);

/** Lines that name a part of the total or a count, never the total itself. */
export const NOT_TOTAL = [...SUBTOTAL, ...keywords('פריטים', 'כמות', 'عدد الأصناف', 'الكمية', 'total items', 'items', 'qty', 'quantity')];

/** A VAT line that is really the total including VAT. */
export const INCLUSIVE = keywords('כולל', 'כולל מע"מ', 'شامل', 'شامل الضريبة', 'incl', 'including', 'inc. vat');

export const VAT = keywords('מע"מ', 'מעמ', 'ضريبة القيمة المضافة', 'الضريبة', 'ضريبة', 'ض.ق.م', 'vat', 'tax');

export const CASH = keywords('מזומן', 'שולם', 'نقدا', 'نقدي', 'المدفوع', 'مدفوع', 'cash', 'tendered', 'paid');

export const CHANGE = keywords('עודף', 'الباقي', 'المتبقي', 'الفكة', 'باقي', 'change');

export const DATE_LABEL = keywords('תאריך', 'التاريخ', 'تاريخ', 'date');

export const REGISTRATION = keywords(
  'ח.פ', 'ח"פ', 'חפ', 'ע.מ', 'ע"מ', 'עוסק מורשה', 'עוסק פטור', "מס' עוסק", 'מספר עוסק', 'מס עוסק', 'ח.צ', 'ע.ר',
  'مشتغل مرخص', 'المشتغل', 'رقم مشتغل', 'رقم الشركة', 'مشتغل',
  'vat no', 'vat reg', 'reg no', 'reg. no', 'company no', 'business no', 'tax id', 'osek',
);

export const PHONE = keywords('טל', "טל'", 'טלפון', 'נייד', 'פלאפון', 'هاتف', 'تلفون', 'جوال', 'ت', 'tel', 'phone', 'mobile', 'mob');

/** A receipt's title or boilerplate, never its vendor. */
export const NOT_VENDOR = keywords(
  'חשבונית', 'חשבונית מס', 'קבלה', 'מקור', 'העתק', 'נאמן למקור', 'ברוכים', 'תודה',
  'فاتورة', 'ايصال', 'إيصال', 'سند', 'ضريبية', 'اهلا', 'شكرا',
  'receipt', 'invoice', 'tax invoice', 'welcome', 'thank', 'copy', 'original', 'www', 'http',
);

/** A company form in a name: the vendor line is surer when it carries one. */
export const COMPANY = keywords('בע"מ', 'חברת', 'ltd', 'inc', 'llc', 'gmbh', 'co.', 'شركة', 'ش.م', 'ذ.م.م', 'م.خ.م');
