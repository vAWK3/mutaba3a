import { PAID_HARD_CAP_PLANS } from '../billing/plans.js';
import type { UsageMeter, UsagePlan } from './kinds.js';
import { monthPlus, USAGE_TIMEZONE } from './month.js';

/**
 * MUT-733 (ADR-292, Basel's decisions on MUT-733 comment 13548): the over-cap gift. Once per account, ever, for whichever
 * monthly meter (documents or scans) is hit first on a paid hard-capped plan; while it runs (until the 1st of the next
 * Asia/Jerusalem month) that meter has no cap; the other keeps its cap and, the gift being used, is a hard cap. Pure.
 */
export interface GiftState {
  usedAt: Date | null;
  meter: UsageMeter | null;
  /** The Jerusalem month (YYYY-MM) the gift was taken in. */
  month: string | null;
}

export const NO_GIFT: GiftState = { usedAt: null, meter: null, month: null };

/** The gift lifts `meter`'s cap in `month` (Q1: only the meter that was hit). */
export function giftCovers(state: GiftState, meter: UsageMeter, month: string): boolean {
  return state.usedAt !== null && state.meter === meter && state.month === month;
}

/** The gift can still be offered: never used, on a paid plan whose caps are hard (never Starter, Freelancer or Firm). */
export function giftAvailable(state: GiftState, plan: UsagePlan, paidHardCaps: boolean): boolean {
  return state.usedAt === null && paidHardCaps && PAID_HARD_CAP_PLANS.has(plan);
}

/** When the gift taken in `month` ends: the first instant of the next Jerusalem month. */
export function giftUntil(month: string): Date {
  const [year, mon] = monthPlus(month, 1).split('-').map(Number) as [number, number];
  const guess = Date.UTC(year, mon - 1, 1);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: USAGE_TIMEZONE, timeZoneName: 'shortOffset' }).formatToParts(new Date(guess)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  const offsetMinutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  return new Date(guess - offsetMinutes * 60_000);
}
