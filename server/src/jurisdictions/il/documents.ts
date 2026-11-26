import type { JurisdictionPack } from '../pack.js';

/**
 * MUT-568 (ADR-260), moved by MUT-741: Israel's document types. Codes are the Tax Authority's: the uniform file (מבנה אחיד
 * 1.31) and the allocation API use the same numbers. A payment request (MUT-662, חשבון עסקה) shows VAT so the
 * invoice-receipts that follow match it, but is not a tax document: never allocated, never in VAT or the tax totals.
 */
export const IL_DOCUMENT_TYPES: JurisdictionPack['documentTypes'] = {
  TAX_INVOICE: { code: 305, vatBearing: true, taxDocument: true },
  TAX_INVOICE_RECEIPT: { code: 320, vatBearing: true, taxDocument: true },
  CREDIT_NOTE: { code: 330, vatBearing: true, taxDocument: true },
  RECEIPT: { code: 400, vatBearing: false, taxDocument: false },
  PAYMENT_REQUEST: { code: 300, vatBearing: true, taxDocument: false },
};

/** The Tax Authority's code for a document type (uniform file, allocation API, retention file names). */
export const IL_DOC_TYPE_CODES = Object.fromEntries(Object.entries(IL_DOCUMENT_TYPES).map(([type, t]) => [type, t.code])) as Record<keyof typeof IL_DOCUMENT_TYPES, number>;
