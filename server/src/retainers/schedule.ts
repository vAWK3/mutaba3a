import { addMonths, clampDay, compareIsoDates, isIsoMonth, monthOf, type IsoDate, type IsoMonth } from '../dates.js';

/**
 * Service months of a recurring retainer and which of them are chargeable at
 * a given date (brief rev. 2 §C). Pure; the store makes charges unique per
 * (agreement, month), so running this twice can never double-charge.
 */
export const MAX_RETAINER_MONTHS = 120;
export const MAX_BILLING_DAY = 28;

export type FinalMonth = 'FULL' | 'WAIVE';

export interface RetainerSpec {
  startMonth: IsoMonth;
  billingDay: number;
  endMonth?: IsoMonth | undefined;
  cancelEffectiveMonth?: IsoMonth | undefined;
  finalMonth?: FinalMonth | undefined;
}

export type RetainerSpecError = { reason: 'BILLING_DAY_INVALID' } | { reason: 'START_MONTH_INVALID' } | { reason: 'END_MONTH_INVALID' } | { reason: 'END_BEFORE_START' };

export function validateRetainerSpec(spec: RetainerSpec): RetainerSpecError | null {
  if (!Number.isInteger(spec.billingDay) || spec.billingDay < 1 || spec.billingDay > MAX_BILLING_DAY) return { reason: 'BILLING_DAY_INVALID' };
  if (!isIsoMonth(spec.startMonth)) return { reason: 'START_MONTH_INVALID' };
  if (spec.endMonth !== undefined) {
    if (!isIsoMonth(spec.endMonth)) return { reason: 'END_MONTH_INVALID' };
    if (spec.endMonth < spec.startMonth) return { reason: 'END_BEFORE_START' };
  }
  return null;
}

export function chargeDate(month: IsoMonth, billingDay: number): IsoDate {
  return clampDay(month, billingDay);
}

/** Months whose charge date is on or before `today`, honouring end month and cancellation. */
export function chargeMonths(spec: RetainerSpec, today: IsoDate): IsoMonth[] {
  const months: IsoMonth[] = [];
  const lastMonth = monthOf(today);
  let month = spec.startMonth;
  for (let i = 0; i < MAX_RETAINER_MONTHS && month <= lastMonth; i += 1, month = addMonths(month, 1)) {
    if (spec.endMonth !== undefined && month > spec.endMonth) break;
    if (spec.cancelEffectiveMonth !== undefined) {
      if (month > spec.cancelEffectiveMonth) break;
      if (month === spec.cancelEffectiveMonth && spec.finalMonth === 'WAIVE') break;
    }
    if (compareIsoDates(chargeDate(month, spec.billingDay), today) > 0) break;
    months.push(month);
  }
  return months;
}
