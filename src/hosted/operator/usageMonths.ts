/** MUT-735 (ADR-281): how many months Operator › Usage offers. */
export const USAGE_MONTHS_SHOWN = 12;

/** This month in Jerusalem (where usage is counted, MUT-704) and the ones before it, newest first, as YYYY-MM. */
export function usageMonths(now: Date, count = USAGE_MONTHS_SHOWN): string[] {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const index = y * 12 + (m - 1) - i;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}
