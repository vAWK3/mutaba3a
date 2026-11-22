import type { IssuedDocType } from './types.js';

/** The languages a document is printed in (Arabic first, ADR-077). */
export const DOCUMENT_LANGUAGES = ['ar', 'he', 'en'] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

/** A document type's name in the document's language: its ledger rows' title ("חשבונית מס 1042") and, later, the PDF's. */
export const DOC_TYPE_TITLES: Readonly<Record<DocumentLanguage, Readonly<Record<IssuedDocType, string>>>> = {
  he: { TAX_INVOICE: 'חשבונית מס', TAX_INVOICE_RECEIPT: 'חשבונית מס קבלה', RECEIPT: 'קבלה', CREDIT_NOTE: 'חשבונית זיכוי' },
  ar: { TAX_INVOICE: 'فاتورة ضريبية', TAX_INVOICE_RECEIPT: 'فاتورة ضريبية وإيصال', RECEIPT: 'إيصال', CREDIT_NOTE: 'إشعار دائن' },
  en: { TAX_INVOICE: 'Tax invoice', TAX_INVOICE_RECEIPT: 'Tax invoice-receipt', RECEIPT: 'Receipt', CREDIT_NOTE: 'Credit note' },
};

/** MUT-660: the one line Issue all prints when the entry has no title of its own. */
export const DEFAULT_LINE_DESCRIPTION: Readonly<Record<DocumentLanguage, string>> = {
  he: 'שירותים מקצועיים',
  ar: 'خدمات مهنية',
  en: 'Professional services',
};
