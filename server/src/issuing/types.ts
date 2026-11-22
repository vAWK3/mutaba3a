/**
 * MUT-568 (ADR-260): the issuing core's vocabulary. Codes are the Tax Authority's: the uniform file (מבנה אחיד 1.31)
 * and the allocation API use the same numbers.
 */
export const DOC_TYPE_CODES = {
  TAX_INVOICE: 305,
  TAX_INVOICE_RECEIPT: 320,
  CREDIT_NOTE: 330,
  RECEIPT: 400,
  /** MUT-662: חשבון עסקה. Not a tax document: never allocated, never in VAT or the tax-document totals. */
  PAYMENT_REQUEST: 300,
} as const;

export type IssuedDocType = keyof typeof DOC_TYPE_CODES;
export const ISSUED_DOC_TYPES = Object.keys(DOC_TYPE_CODES) as IssuedDocType[];

/** LICENSED = עוסק מורשה, EXEMPT = עוסק פטור (issues receipts only), COMPANY = חברה, NONPROFIT = עמותה. */
export const DEALER_TYPES = ['LICENSED', 'EXEMPT', 'COMPANY', 'NONPROFIT'] as const;
export type DealerType = (typeof DEALER_TYPES)[number];

/** MUT-640: the document styles (layouts in pdf/styles). Kept here so the API schema doesn't load the PDF code. */
export const DOCUMENT_STYLES = ['PROFESSIONAL', 'MODERN', 'MINIMAL'] as const;
export type DocumentStyle = (typeof DOCUMENT_STYLES)[number];

/** MUT-640: the only print colours. */
export const INK_COLOURS = ['BLACK', 'BLUE'] as const;

/** Goods or service, per line: the allocation API's item category starts with it. */
export const LINE_KINDS = ['GOODS', 'SERVICE'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** D4: shekels only in v1; a foreign-currency invoice needs the representative rate and ILS VAT (follow-up). */
export const ISSUING_CURRENCIES = ['ILS'] as const;

export const MAX_LINES = 200;
export const MAX_DESCRIPTION_LENGTH = 300;

/** Tax invoices and their credit notes carry VAT; receipts record money received and carry none. */
export const VAT_BEARING: ReadonlySet<IssuedDocType> = new Set(['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE', 'PAYMENT_REQUEST']);

/**
 * MUT-662: the tax documents (VAT and tax totals count only these). A payment request shows VAT so the invoice-receipts
 * that follow match it, but it is not one of them.
 */
export const TAX_DOCUMENTS: ReadonlySet<IssuedDocType> = new Set(['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE']);
