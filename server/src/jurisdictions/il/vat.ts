/** MUT-741: moved from issuing/vat-rate.ts. Israel's standard VAT rate in basis points from each date on (by the document's date). */
export const ISRAEL_STANDARD_VAT_RATES: readonly { from: string; rateBasisPoints: number }[] = [
  { from: '2015-10-01', rateBasisPoints: 1700 },
  { from: '2025-01-01', rateBasisPoints: 1800 },
];

export function standardVatRateOn(date: string): number {
  let rate = ISRAEL_STANDARD_VAT_RATES[0]!.rateBasisPoints;
  for (const step of ISRAEL_STANDARD_VAT_RATES) if (date >= step.from) rate = step.rateBasisPoints;
  return rate;
}
