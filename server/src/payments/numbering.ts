import type { IsoDate } from '../dates.js';

/**
 * Ledger numbers (M4 brief decision 6, MUT-478 D1): `PREFIX-YYYY-NNNN`,
 * gap-free per organization and year. The year is the one in a calendar date
 * the client already expressed in the organization timezone (`receivedOn` for
 * a payment, `postingDate` for a receivable); the sequence comes from the
 * store's counter row inside the posting transaction.
 */
export const PAYMENT_NUMBER_PREFIX = 'PAY';
export const RECEIVABLE_NUMBER_PREFIX = 'CHG';

export function ledgerYear(date: IsoDate): number {
  const year = Number(date.slice(0, 4));
  if (!Number.isInteger(year) || year < 1900) throw new RangeError(`not a calendar date: ${date}`);
  return year;
}

export function ledgerNumber(prefix: string, year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError('sequence must be a positive integer');
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

export const paymentYear = ledgerYear;

export function paymentNumber(year: number, sequence: number): string {
  return ledgerNumber(PAYMENT_NUMBER_PREFIX, year, sequence);
}

export function receivableNumber(year: number, sequence: number): string {
  return ledgerNumber(RECEIVABLE_NUMBER_PREFIX, year, sequence);
}

/** The memory store's counter key for receivable numbers; payments use `${organizationId}:${year}`. */
export function receivableCounterKey(organizationId: string, year: number): string {
  return `${organizationId}:${RECEIVABLE_NUMBER_PREFIX}:${year}`;
}

/**
 * The backfill for receivables that predate numbering (MUT-478): within each
 * organization and year of `postingDate`, by (postingDate, postedAt, id), the
 * order the SQL migration's ROW_NUMBER() uses, so a device's records and a
 * hosted profile number their history alike. Returns id → number and the
 * counter each organization-year ends on, keyed as `receivableCounterKey`.
 */
export function backfillReceivableNumbers(receivables: ReadonlyArray<{ id: string; organizationId: string; postingDate: IsoDate; postedAt: Date }>): { numbers: Map<string, string>; counters: Map<string, number> } {
  const sorted = [...receivables].sort(
    (a, b) => a.organizationId.localeCompare(b.organizationId) || a.postingDate.localeCompare(b.postingDate) || a.postedAt.getTime() - b.postedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const numbers = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const r of sorted) {
    const year = ledgerYear(r.postingDate);
    const key = receivableCounterKey(r.organizationId, year);
    const seq = (counters.get(key) ?? 0) + 1;
    counters.set(key, seq);
    numbers.set(r.id, receivableNumber(year, seq));
  }
  return { numbers, counters };
}
