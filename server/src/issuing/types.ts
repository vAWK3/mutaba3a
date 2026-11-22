/**
 * MUT-568 (ADR-260): the issuing core's vocabulary. Codes are the Tax Authority's: the uniform file (מבנה אחיד 1.31)
 * and the allocation API use the same numbers.
 */
export const DOC_TYPE_CODES = {
  TAX_INVOICE: 305,
  TAX_INVOICE_RECEIPT: 320,
  CREDIT_NOTE: 330,
  RECEIPT: 400,
} as const;

export type IssuedDocType = keyof typeof DOC_TYPE_CODES;
export const ISSUED_DOC_TYPES = Object.keys(DOC_TYPE_CODES) as IssuedDocType[];

/** LICENSED = עוסק מורשה, EXEMPT = עוסק פטור (issues receipts only), COMPANY = חברה, NONPROFIT = עמותה. */
export const DEALER_TYPES = ['LICENSED', 'EXEMPT', 'COMPANY', 'NONPROFIT'] as const;
export type DealerType = (typeof DEALER_TYPES)[number];

/** Goods or service, per line: the allocation API's item category starts with it. */
export const LINE_KINDS = ['GOODS', 'SERVICE'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** D4: shekels only in v1; a foreign-currency invoice needs the representative rate and ILS VAT (follow-up). */
export const ISSUING_CURRENCIES = ['ILS'] as const;

export const MAX_LINES = 200;
export const MAX_DESCRIPTION_LENGTH = 300;

/** Tax invoices and their credit notes carry VAT; receipts record money received and carry none. */
export const VAT_BEARING: ReadonlySet<IssuedDocType> = new Set(['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE']);
