import { validationError } from '../agreements/compose.js';
import { computeVat, MAX_RATE_BASIS_POINTS, type VatTreatment } from '../vat.js';

/**
 * MUT-302 (ADR-231): VAT on an expense. The amount is what was paid, so the split is always taken out of the gross
 * (`VAT_INCLUSIVE`) by `computeVat`, rounded exactly as receivables are. The server is the only writer of net and VAT;
 * a client sends the treatment and rate only. No VAT is four nulls, never a guessed split.
 */

/** What a create, PATCH or receipt approval sends. */
export interface ExpenseVatInput {
  treatment: VatTreatment;
  rateBasisPoints: number;
}

/** The four columns on the row; all null = "No VAT recorded". The gross is the row's `amountMinor`. */
export interface ExpenseVatColumns {
  vatTreatment: VatTreatment | null;
  vatRateBasisPoints: number | null;
  netMinor: bigint | null;
  vatMinor: bigint | null;
}

export const NO_EXPENSE_VAT: Readonly<ExpenseVatColumns> = Object.freeze({ vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null });

/** A standard rate is 1..10000 basis points; 0 % standard is ZERO_RATED. The other treatments ignore the rate sent. */
function assertExpenseVatInput(input: ExpenseVatInput): void {
  if (input.treatment !== 'STANDARD_RATED') return;
  const rate = input.rateBasisPoints;
  if (!Number.isInteger(rate) || rate < 1 || rate > MAX_RATE_BASIS_POINTS) {
    throw validationError('VAT_RATE_INVALID', `A standard VAT rate must be a whole number of basis points from 1 to ${MAX_RATE_BASIS_POINTS}`, { field: 'vat.rateBasisPoints' });
  }
}

/** The columns for a gross and what the request asked; absent or null records no VAT. */
export function expenseVat(amountMinor: bigint, input: ExpenseVatInput | null | undefined): ExpenseVatColumns {
  if (!input) return { ...NO_EXPENSE_VAT };
  assertExpenseVatInput(input);
  const split = computeVat({ amountMinor, pricingBasis: 'VAT_INCLUSIVE', treatment: input.treatment, rateBasisPoints: input.treatment === 'STANDARD_RATED' ? input.rateBasisPoints : 0 });
  return { vatTreatment: input.treatment, vatRateBasisPoints: split.rateBasisPoints, netMinor: split.netMinor, vatMinor: split.vatMinor };
}

/** The row's own treatment and rate, to re-split a new amount (PATCH absent `vat`, D4); null when it has no VAT. */
export function storedExpenseVat(row: ExpenseVatColumns): ExpenseVatInput | null {
  return row.vatTreatment == null ? null : { treatment: row.vatTreatment, rateBasisPoints: row.vatRateBasisPoints ?? 0 };
}

/**
 * The four Postgres CHECKs of the MUT-302 migration, for the memory store (the portal's local mode has no Postgres).
 * Throws with the constraint's name, as Postgres would.
 */
export function assertExpenseVatColumns(row: ExpenseVatColumns & { amountMinor: bigint }): void {
  const set = [row.vatTreatment, row.vatRateBasisPoints, row.netMinor, row.vatMinor].filter((v) => v !== null && v !== undefined).length;
  if (set === 0) return;
  if (set !== 4) throw new Error('violates check constraint "expenses_vat_all_or_none"');
  if (row.netMinor! + row.vatMinor! !== row.amountMinor) throw new Error('violates check constraint "expenses_vat_adds_up"');
  if (row.vatTreatment !== 'STANDARD_RATED' && (row.vatMinor !== 0n || row.vatRateBasisPoints !== 0)) throw new Error('violates check constraint "expenses_vat_zero_unless_standard"');
  if (row.vatTreatment === 'STANDARD_RATED' && (row.vatRateBasisPoints! < 1 || row.vatRateBasisPoints! > MAX_RATE_BASIS_POINTS)) throw new Error('violates check constraint "expenses_vat_standard_rate"');
}
