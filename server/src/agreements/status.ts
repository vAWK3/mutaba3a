import { compareIsoDates, type IsoDate } from '../dates.js';

/**
 * Display status of a payable item (installment or retainer charge), computed
 * on the server in the organization's timezone (brief §2.2). Never stored.
 */
export const ITEM_STATUSES = ['PENDING', 'DUE', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface ItemStatusInput {
  voided: boolean;
  posted: boolean;
  dueDate: IsoDate;
  grossMinor: bigint;
  paidMinor: bigint;
  /** Credits (M4) count towards settlement but are not payments: a credited, unpaid item is DUE, not PARTIALLY_PAID. */
  creditedMinor?: bigint;
  today: IsoDate;
}

export function itemStatus(i: ItemStatusInput): ItemStatus {
  if (i.voided) return 'VOID';
  if (!i.posted) return 'PENDING';
  if (i.paidMinor + (i.creditedMinor ?? 0n) >= i.grossMinor) return 'PAID';
  if (compareIsoDates(i.dueDate, i.today) < 0) return 'OVERDUE';
  if (i.paidMinor > 0n) return 'PARTIALLY_PAID';
  return 'DUE';
}
