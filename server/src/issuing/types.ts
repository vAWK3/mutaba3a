/**
 * MUT-568 (ADR-260): the issuing core's vocabulary. MUT-741 (ADR-287): the vocabulary is country-neutral; what a type
 * is called by a tax authority (its code), whether it carries VAT and whether it is a tax document are the issuer's
 * jurisdiction pack's rules (`pack.documentTypes`).
 */
export const ISSUED_DOC_TYPES = ['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT', 'PAYMENT_REQUEST'] as const;
export type IssuedDocType = (typeof ISSUED_DOC_TYPES)[number];

/**
 * The order lists and files put document types in: ascending by the Israeli code (300, 305, 320, 330, 400), kept as a
 * core sort so no listing order depends on a country. `jurisdictions/__tests__/il-pack.contract.test.ts` fails if it
 * drifts from the Israel pack's codes.
 */
export const DOC_TYPE_RANK: Readonly<Record<IssuedDocType, number>> = { PAYMENT_REQUEST: 0, TAX_INVOICE: 1, TAX_INVOICE_RECEIPT: 2, CREDIT_NOTE: 3, RECEIPT: 4 };

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

export const MAX_LINES = 200;
export const MAX_DESCRIPTION_LENGTH = 300;
