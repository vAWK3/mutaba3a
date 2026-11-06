import { validationError } from '../agreements/compose.js';
import type { ProfileType } from '../repositories/ports.js';
import type { VatTreatment } from '../vat.js';

/**
 * MUT-557 (ADR-246): the Israeli allocation number (מספר הקצאה) a tax invoice above the threshold must carry for its
 * buyer to claim back the VAT. The one place the rule lives: the expense flag, the receipt review's hint and the
 * reader's completeness rule all ask here, and MUT-572 (requesting numbers when issuing) will too.
 */

/** The threshold before VAT, in agorot, from each date on (by the invoice's date). Before the first, none is required. */
export const ALLOCATION_THRESHOLDS: readonly { from: string; minNetMinor: bigint }[] = [
  { from: '2024-05-05', minNetMinor: 2_500_000n },
  { from: '2025-01-01', minNetMinor: 2_000_000n },
  { from: '2026-01-01', minNetMinor: 1_000_000n },
  { from: '2026-06-01', minNetMinor: 500_000n },
];

export const ALLOCATION_NUMBER_DIGITS = 9;

/** The threshold in force on `date` (YYYY-MM-DD), or null before the first one. */
export function thresholdOn(date: string): bigint | null {
  let threshold: bigint | null = null;
  for (const step of ALLOCATION_THRESHOLDS) if (date >= step.from) threshold = step.minNetMinor;
  return threshold;
}

/** An ILS invoice with VAT whose net is at or above the threshold on its date (R1: exactly at it counts). */
export function aboveAllocationThreshold(invoice: { currency: string; occurredOn: string; netMinor: bigint | null; vatMinor: bigint | null }): boolean {
  if (invoice.currency !== 'ILS' || invoice.netMinor === null || invoice.vatMinor === null || invoice.vatMinor <= 0n) return false;
  const threshold = thresholdOn(invoice.occurredOn);
  return threshold !== null && invoice.netMinor >= threshold;
}

/** D4 + A4: a Business profile's expense with its VAT recorded (treatment, net and VAT) that needs a number. */
export function allocationNumberRequired(expense: {
  profileType: ProfileType;
  currency: string;
  occurredOn: string;
  vatTreatment: VatTreatment | null;
  netMinor: bigint | null;
  vatMinor: bigint | null;
}): boolean {
  return expense.profileType === 'BUSINESS' && expense.vatTreatment !== null && aboveAllocationThreshold(expense);
}

/** Spaces and dashes out, then exactly nine ASCII digits; null when it isn't one. */
export function readAllocationDigits(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return new RegExp(`^[0-9]{${ALLOCATION_NUMBER_DIGITS}}$`).test(digits) ? digits : null;
}

/** D1: what a write stores, or 422 ALLOCATION_NUMBER_INVALID. No check digit: the Tax Authority publishes none. */
export function normalizeAllocationNumber(raw: string): string {
  const digits = readAllocationDigits(raw);
  if (digits === null) throw validationError('ALLOCATION_NUMBER_INVALID', `An allocation number is ${ALLOCATION_NUMBER_DIGITS} digits`, { field: 'allocationNumber' });
  return digits;
}

/** The MUT-557 migration's CHECK, for the memory store (the portal's local mode has no Postgres). */
export function assertAllocationNumberColumn(value: string | null): void {
  if (value !== null && readAllocationDigits(value) !== value) throw new Error('violates check constraint "expenses_allocation_number_digits"');
}
