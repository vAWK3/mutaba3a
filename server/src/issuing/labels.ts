import type { IssuedDocType } from './types.js';

/** The languages a document is printed in (Arabic first, ADR-077). */
export const DOCUMENT_LANGUAGES = ['ar', 'he', 'en'] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

/** A document type's name in the document's language: its ledger rows' title ("חשבונית מס 1042") and, later, the PDF's. */
export const DOC_TYPE_TITLES: Readonly<Record<DocumentLanguage, Readonly<Record<IssuedDocType, string>>>> = {
  he: { TAX_INVOICE: 'חשבונית מס', TAX_INVOICE_RECEIPT: 'חשבונית מס קבלה', RECEIPT: 'קבלה', CREDIT_NOTE: 'חשבונית זיכוי', PAYMENT_REQUEST: 'דרישת תשלום' },
  ar: { TAX_INVOICE: 'فاتورة ضريبية', TAX_INVOICE_RECEIPT: 'فاتورة ضريبية وإيصال', RECEIPT: 'إيصال', CREDIT_NOTE: 'إشعار دائن', PAYMENT_REQUEST: 'طلب دفع' },
  en: { TAX_INVOICE: 'Tax invoice', TAX_INVOICE_RECEIPT: 'Tax invoice-receipt', RECEIPT: 'Receipt', CREDIT_NOTE: 'Credit note', PAYMENT_REQUEST: 'Payment request' },
};

/** MUT-662 (D16): the framed notice under a payment request's title. */
export const PAYMENT_REQUEST_NOTICE: Readonly<Record<DocumentLanguage, string>> = {
  he: 'חשבון עסקה · אינו חשבונית מס',
  ar: 'طلب دفع · ليس فاتورة ضريبية',
  en: 'Payment request · not a tax invoice',
};

/** MUT-662: printed on a cancelled payment request's later copies. */
export const CANCELLED_MARK: Readonly<Record<DocumentLanguage, string>> = { he: 'בוטל', ar: 'ملغى', en: 'Cancelled' };

/**
 * MUT-662: how a number is shown on screens and PDFs. A payment request reads PR-0007 and its cancellation CX-0002 in
 * every language; the stored number (and the uniform file) stays the plain int. Other types print their number as is.
 */
export function documentNumberLabel(docType: IssuedDocType | 'CANCELLATION', number: number): string {
  if (docType === 'PAYMENT_REQUEST') return `PR-${String(number).padStart(4, '0')}`;
  if (docType === 'CANCELLATION') return `CX-${String(number).padStart(4, '0')}`;
  return String(number);
}

/** MUT-660: the one line Issue all prints when the entry has no title of its own. */
export const DEFAULT_LINE_DESCRIPTION: Readonly<Record<DocumentLanguage, string>> = {
  he: 'שירותים מקצועיים',
  ar: 'خدمات مهنية',
  en: 'Professional services',
};
