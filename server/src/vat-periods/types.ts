import type { IsoDate } from '../dates.js';

/**
 * MUT-782 (ADR-343): the jurisdiction-neutral shape of a VAT period, so the core (store, routes, the daily sweep) names
 * the types without importing a country pack (`jurisdictions/__tests__/boundary.test.ts`). The rules that make a period
 * (what ends when, what is due) are the pack's: `pack.vat.periods`.
 */
export const VAT_PERIOD_KINDS = ['MONTHLY', 'BIMONTHLY', 'YEARLY', 'NONE'] as const;
export type VatPeriodKind = (typeof VAT_PERIOD_KINDS)[number];
export type FilingPeriodKind = Exclude<VatPeriodKind, 'NONE'>;

export interface VatPeriod {
  /** Names the period for good: `2026-M10` (October), `2026-B5` (September and October), `2026-Y`. */
  readonly key: string;
  readonly kind: FilingPeriodKind;
  readonly year: number;
  readonly firstMonth: number;
  readonly lastMonth: number;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
}
