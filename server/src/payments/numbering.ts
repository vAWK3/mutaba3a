import type { IsoDate } from '../dates.js';

/**
 * Payment numbers (M4 brief decision 6): `PAY-YYYY-NNNN`, gap-free per
 * organization and year. The year is the one in `receivedOn`, a calendar date
 * the client already expressed in the organization timezone; the sequence
 * comes from the store's counter row inside the posting transaction.
 */
export const PAYMENT_NUMBER_PREFIX = 'PAY';

export function paymentYear(receivedOn: IsoDate): number {
  const year = Number(receivedOn.slice(0, 4));
  if (!Number.isInteger(year) || year < 1900) throw new RangeError(`not a calendar date: ${receivedOn}`);
  return year;
}

export function paymentNumber(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError('sequence must be a positive integer');
  return `${PAYMENT_NUMBER_PREFIX}-${year}-${String(sequence).padStart(4, '0')}`;
}
