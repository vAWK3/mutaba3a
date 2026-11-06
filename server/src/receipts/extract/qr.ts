import type { ReceiptSuggestion, SuggestedField } from '../../repositories/ports.js';
import type { SuggestionField } from './merge.js';

/**
 * MUT-557 (D6): what a receipt's QR codes say. Each parser knows one payload format (an e-invoice standard) and returns
 * the fields it carries, or null when the payload is not its format. Fields from a QR are exact (confidence 1) and
 * fill only what the printed text did not give. No parser is registered yet: the Israeli one waits for real invoices
 * that show the allocation number in a QR (the bench had none); ZATCA and JoFotara are MUT-490's.
 */
export type QrFields = Partial<Record<SuggestionField, string | number>>;
export type QrParser = (payload: string) => QrFields | null;

export const QR_PARSERS: readonly QrParser[] = [];

/** The first parser's reading of each payload, the earlier payload winning a field. Pure; nothing it reads is logged. */
export function readQrFields(payloads: readonly string[], parsers: readonly QrParser[] = QR_PARSERS): Partial<ReceiptSuggestion> {
  const fields: Record<string, SuggestedField<string | number>> = {};
  for (const payload of payloads) {
    for (const parser of parsers) {
      const read = parser(payload);
      if (!read) continue;
      for (const [field, value] of Object.entries(read)) if (value !== undefined && !(field in fields)) fields[field] = { value, source: 'qr', confidence: 1 };
      break;
    }
  }
  return fields as Partial<ReceiptSuggestion>;
}
