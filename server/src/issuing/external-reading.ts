import { readReceipt } from '../receipts/extract/extract.js';
import type { OcrResult } from '../receipts/ocr-client.js';

/**
 * MUT-647: what an invoice issued elsewhere says, for the person to confirm: its number, date and total. The date and
 * the total come from the receipts reader (ADR-199), which knows both; the number is read here, from the words that
 * stand before it on an Israeli invoice in Hebrew, Arabic or English. Anything not read is null: the person types it.
 * Pure: no I/O, nothing logged.
 */
export interface ExternalInvoiceReading {
  number: string | null;
  documentDate: string | null;
  /** The total in the invoice's currency, as a decimal string with two places. */
  amount: string | null;
}

const NUMBER_PATTERNS: readonly RegExp[] = [
  // חשבונית מס 3381 · חשבונית מס קבלה מס' 3381 · חשבונית מספר: 3381
  /חשבונית(?:\s+מס)?(?:\s+קבלה)?(?:\s+(?:מס['׳]?|מספר))?\s*[:#.]?\s*(\d[\d-]{0,19})/u,
  // מס' חשבונית 3381
  /מס['׳]?\s+חשבונית\s*[:#.]?\s*(\d[\d-]{0,19})/u,
  // فاتورة ضريبية رقم 3381 · فاتورة رقم: 3381
  /فاتورة(?:\s+ضريبية)?(?:\s+و?إيصال)?(?:\s+رقم)?\s*[:#.]?\s*(\d[\d-]{0,19})/u,
  // Tax invoice no. 3381 · Invoice #3381 · Invoice number: 3381
  /invoice(?:[\s-]+receipt)?\s*(?:no\.?|number|num\.?|#)\s*[:#.]?\s*(\d[\d-]{0,19})/iu,
  /tax\s+invoice\s+(\d[\d-]{0,19})/iu,
];

function textOf(result: OcrResult): string {
  const fromLines = result.lines.map((l) => l.text).join('\n');
  return [result.pdfText ?? '', fromLines].join('\n');
}

/** The first invoice number the text names, or null. */
export function readInvoiceNumber(text: string): string | null {
  for (const pattern of NUMBER_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].replace(/-+$/, '');
  }
  return null;
}

const asDecimal = (minor: string): string => {
  const value = BigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

export function readExternalInvoice(result: OcrResult, options: { readerVersion: string }): ExternalInvoiceReading {
  // No upload-day window: an invoice issued elsewhere may be months old (a business moving its history in).
  const { suggestion } = readReceipt({ lines: result.lines, pdfText: result.pdfText ?? null, qr: result.qr ?? [] }, { readerVersion: options.readerVersion });
  return {
    number: readInvoiceNumber(textOf(result)),
    documentDate: suggestion.date?.value ?? null,
    amount: suggestion.totalMinor ? asDecimal(suggestion.totalMinor.value) : null,
  };
}
