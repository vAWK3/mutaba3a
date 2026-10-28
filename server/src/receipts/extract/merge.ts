import type { ReceiptSuggestion } from '../../repositories/ports.js';

/** Every field a `ReceiptSuggestion` can carry, besides its reader version. */
export const SUGGESTION_FIELDS = ['date', 'totalMinor', 'currency', 'vatMinor', 'vatRateBasisPoints', 'vendorName', 'registrationNo', 'phone', 'email'] as const;
export type SuggestionField = (typeof SUGGESTION_FIELDS)[number];

/**
 * MUT-441 AC3 and R7, the one merge rule for every writer (the server's reader, and a client's approve, file or PATCH):
 * a field already in the stored suggestion is never changed; the incoming suggestion only fills absent ones. The
 * reader version is the one that added the latest field: the incoming one when it added any, else the stored one.
 * `added` names the fields that were filled, so a reader that added nothing can record that (SKIPPED). Pure.
 */
export function fillAbsent(stored: ReceiptSuggestion | null, incoming: ReceiptSuggestion): { merged: ReceiptSuggestion; added: SuggestionField[] } {
  const base: ReceiptSuggestion = stored ?? { readerVersion: incoming.readerVersion };
  const merged: Record<string, unknown> = { readerVersion: base.readerVersion };
  const added: SuggestionField[] = [];
  for (const field of SUGGESTION_FIELDS) {
    if (base[field] !== undefined) merged[field] = base[field];
    else if (incoming[field] !== undefined) {
      merged[field] = incoming[field];
      added.push(field);
    }
  }
  if (added.length > 0) merged.readerVersion = incoming.readerVersion;
  return { merged: merged as unknown as ReceiptSuggestion, added };
}
