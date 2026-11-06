import { aboveAllocationThreshold } from '../../israel/allocation-number.js';
import type { ReceiptSuggestion } from '../../repositories/ports.js';

/** The fields every receipt is read for: a suggestion holding all of them is complete (`isCompleteSuggestion`). */
export const SUGGESTION_FIELDS = ['date', 'totalMinor', 'currency', 'vatMinor', 'vatRateBasisPoints', 'vendorName', 'registrationNo', 'phone', 'email'] as const;
/**
 * Every field a `ReceiptSuggestion` can carry, besides its reader version. MUT-557 (D3): the allocation number is only
 * on Israeli tax invoices above the threshold, so it is not one every receipt must have.
 */
export const READ_FIELDS = [...SUGGESTION_FIELDS, 'allocationNumber'] as const;
export type SuggestionField = (typeof READ_FIELDS)[number];

/**
 * MUT-441 review: the fields that describe one money reading. `totalMinor` and `vatMinor` are minor units of the
 * currency they were read in (two decimals when no currency was read, see `toMinor`), so they never mix with another
 * reading's currency. `vatRateBasisPoints` does not depend on the currency, but it comes from the same reading as the
 * amounts, so it travels with them for consistency.
 */
export const MONEY_GROUP = ['currency', 'totalMinor', 'vatMinor', 'vatRateBasisPoints'] as const satisfies readonly SuggestionField[];
const isMoneyField = (field: SuggestionField): boolean => (MONEY_GROUP as readonly SuggestionField[]).includes(field);

/**
 * Whether the incoming money group may fill the stored one: when nothing of the group is stored (the incoming group is
 * taken whole), or when both name the same currency (only its absent members fill). A stored amount without a
 * currency, or two different currencies, take nothing.
 */
function moneyGroupFills(base: ReceiptSuggestion, incoming: ReceiptSuggestion): boolean {
  if (MONEY_GROUP.every((field) => base[field] === undefined)) return true;
  return base.currency !== undefined && incoming.currency !== undefined && base.currency.value === incoming.currency.value;
}

/**
 * MUT-441 AC3 and R7, the one merge rule for every writer (the server's reader, and a client's approve, file or PATCH):
 * a field already in the stored suggestion is never changed; the incoming suggestion only fills absent ones, with the
 * money fields filled as one group (`MONEY_GROUP`). The reader version is the one that added the latest field: the
 * incoming one when it added any, else the stored one. `added` names the fields that were filled, so a reader that
 * added nothing can record that (SKIPPED). Pure.
 */
export function fillAbsent(stored: ReceiptSuggestion | null, incoming: ReceiptSuggestion): { merged: ReceiptSuggestion; added: SuggestionField[] } {
  const base: ReceiptSuggestion = stored ?? { readerVersion: incoming.readerVersion };
  const merged: Record<string, unknown> = { readerVersion: base.readerVersion };
  const added: SuggestionField[] = [];
  const moneyFills = moneyGroupFills(base, incoming);
  for (const field of READ_FIELDS) {
    if (base[field] !== undefined) merged[field] = base[field];
    else if (incoming[field] !== undefined && (moneyFills || !isMoneyField(field))) {
      merged[field] = incoming[field];
      added.push(field);
    }
  }
  if (added.length > 0) merged.readerVersion = incoming.readerVersion;
  return { merged: merged as unknown as ReceiptSuggestion, added };
}

/**
 * MUT-441: a suggestion that already carries every field leaves the server nothing to read for. MUT-557 (D3): nor
 * does it while it reads as an ILS tax invoice at or above the allocation threshold without a number: the server
 * reads it once for that (A2: a never-read To-review receipt too; one already read is never picked again).
 */
export function isCompleteSuggestion(suggestion: ReceiptSuggestion | null | undefined): boolean {
  if (!suggestion || !SUGGESTION_FIELDS.every((field) => suggestion[field] !== undefined)) return false;
  return suggestion.allocationNumber !== undefined || !expectsAllocationNumber(suggestion);
}

/** MUT-557: what the suggestion read is an ILS invoice with VAT whose net (total − VAT) is at or above the threshold on its date. */
export function expectsAllocationNumber(suggestion: ReceiptSuggestion): boolean {
  const { currency, date, totalMinor, vatMinor } = suggestion;
  if (!currency || !date || !totalMinor || !vatMinor) return false;
  const vat = BigInt(vatMinor.value);
  return aboveAllocationThreshold({ currency: currency.value, occurredOn: date.value, netMinor: BigInt(totalMinor.value) - vat, vatMinor: vat });
}
