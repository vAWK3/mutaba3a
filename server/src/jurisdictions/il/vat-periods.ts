import { addDays, daysInMonth, type IsoDate } from '../../dates.js';
import type { DealerType } from '../../issuing/types.js';
import { VAT_PERIOD_KINDS, type FilingPeriodKind, type VatPeriod, type VatPeriodKind } from '../../vat-periods/types.js';

/**
 * MUT-782 (ADR-343): the periods an Israeli client files VAT for, as pure functions of a day. No clock, no store.
 * A period's key names it for good (`2026-M10` October, `2026-B5` September and October, `2026-Y`), so a record
 * written for it never moves when the client's period kind changes later.
 */

export { VAT_PERIOD_KINDS };
export type { FilingPeriodKind, VatPeriod, VatPeriodKind };

/** What each business type files, until the accountant says otherwise (Basel, 2026-11-28). */
const DEFAULT_KIND: Readonly<Record<DealerType, VatPeriodKind>> = {
  LICENSED: 'BIMONTHLY',
  EXEMPT: 'YEARLY',
  COMPANY: 'MONTHLY',
  NONPROFIT: 'NONE',
};

/**
 * The day of the month after a period by which VAT is due. 15 is the statutory day; online filers have until the 23rd,
 * but the earlier day never makes anyone late. A yearly period states no day (see `vatFilingDueDate`).
 */
export const IL_VAT_FILING_DUE_DAY = 15;

const MONTHS_PER_YEAR = 12;
const MONTHS_PER_BIMONTHLY_PERIOD = 2;

export function defaultVatPeriodKind(dealer: DealerType): VatPeriodKind {
  return DEFAULT_KIND[dealer];
}

/** The accountant's choice, else the dealer type's default, else NONE (a profile with no issuer details has no default). */
export function effectiveVatPeriodKind(chosen: VatPeriodKind | null, dealer: DealerType | null): VatPeriodKind {
  if (chosen !== null) return chosen;
  return dealer === null ? 'NONE' : defaultVatPeriodKind(dealer);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function build(kind: FilingPeriodKind, year: number, firstMonth: number, lastMonth: number): VatPeriod {
  const key = kind === 'MONTHLY' ? `${year}-M${firstMonth}` : kind === 'BIMONTHLY' ? `${year}-B${(lastMonth / MONTHS_PER_BIMONTHLY_PERIOD).toString()}` : `${year}-Y`;
  return { key, kind, year, firstMonth, lastMonth, startDate: `${year}-${pad(firstMonth)}-01`, endDate: `${year}-${pad(lastMonth)}-${pad(daysInMonth(year, lastMonth))}` };
}

/** The latest period of `kind` whose last day is before `today` (a period is announced from the day after it ends). */
export function latestEndedVatPeriod(kind: VatPeriodKind, today: IsoDate): VatPeriod | null {
  if (kind === 'NONE') return null;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (kind === 'YEARLY') return build('YEARLY', year - 1, 1, MONTHS_PER_YEAR);
  let lastMonth = month - 1;
  if (kind === 'BIMONTHLY' && lastMonth % MONTHS_PER_BIMONTHLY_PERIOD !== 0) lastMonth -= 1;
  const lastYear = lastMonth <= 0 ? year - 1 : year;
  if (lastMonth <= 0) lastMonth += MONTHS_PER_YEAR;
  return build(kind, lastYear, kind === 'MONTHLY' ? lastMonth : lastMonth - 1, lastMonth);
}

const KEY_RE = /^(\d{4})-(?:M([1-9]|1[0-2])|B([1-6])|(Y))$/;

/** Reads a stored key back into its period; null for anything `latestEndedVatPeriod` would not have made. */
export function vatPeriodFromKey(key: string): VatPeriod | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  if (m[2] !== undefined) return build('MONTHLY', year, Number(m[2]), Number(m[2]));
  if (m[3] !== undefined) return build('BIMONTHLY', year, Number(m[3]) * MONTHS_PER_BIMONTHLY_PERIOD - 1, Number(m[3]) * MONTHS_PER_BIMONTHLY_PERIOD);
  return build('YEARLY', year, 1, MONTHS_PER_YEAR);
}

/**
 * The day filing is due, or null when none is stated: a yearly period's date has not been confirmed (MUT-782 open
 * item), so no mail names one.
 */
export function vatFilingDueDate(period: VatPeriod): IsoDate | null {
  if (period.kind === 'YEARLY') return null;
  return addDays(period.endDate, IL_VAT_FILING_DUE_DAY);
}
