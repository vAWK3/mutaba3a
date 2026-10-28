import { MAX_AMOUNT_MINOR } from '../../money.js';

/** MUT-441: money on a row, in minor units. Pure. */

/** What is not money on a receipt row: dates, times, percentages, phone numbers, long digit runs (ids, card numbers). */
const NOT_MONEY = [
  /(?<!\d)\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}(?!\d)/g,
  /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g,
  /(?<![\d.])\d{1,3}(?:\.\d{1,2})?\s*%|%\s*\d{1,3}(?:\.\d{1,2})?(?![\d.])/g,
  /(?:\+|00)\d{3}[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}|(?<!\d)0\d{1,2}[\s-]\d{3}[\s-]?\d{4}(?!\d)/g,
  /\d{7,}/g,
];

const AMOUNT = /(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?|\d+\.\d{1,3}|\d{1,6})(?!\d|[.,]\d)/g;

export interface Amount {
  minor: bigint;
  /** Printed with a decimal point. A bare integer is money only on a labelled row. */
  decimal: boolean;
}

/**
 * The amount `raw` (digits, `,` thousands, `.` decimals) in minor units of a currency with `exponent` digits. With no
 * currency known (`exponent` null) two decimals are assumed, and three are refused rather than guessed (JOD prints
 * three). Null for more decimals than the currency has, zero, or past the API's bound.
 */
export function toMinor(raw: string, exponent: number | null): bigint | null {
  const [whole = '', frac = ''] = raw.replace(/,/g, '').split('.');
  const digits = exponent ?? 2;
  if (frac.length > digits) return null;
  const minor = BigInt(whole || '0') * 10n ** BigInt(digits) + BigInt(frac.padEnd(digits, '0') || '0');
  return minor > 0n && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

/** Every amount printed on the row, left to right. */
export function amountsIn(text: string, exponent: number | null): Amount[] {
  const cleaned = NOT_MONEY.reduce((t, pattern) => t.replace(pattern, ' '), text);
  const out: Amount[] = [];
  for (const match of cleaned.matchAll(AMOUNT)) {
    const raw = match[1] ?? '';
    const minor = toMinor(raw, exponent);
    if (minor !== null) out.push({ minor, decimal: raw.includes('.') });
  }
  return out;
}

/** How many decimals each amount on the row is printed with (0 for a bare integer), left to right. */
export function decimalPlacesIn(text: string): number[] {
  const cleaned = NOT_MONEY.reduce((t, pattern) => t.replace(pattern, ' '), text);
  return [...cleaned.matchAll(AMOUNT)].map((match) => (match[1] ?? '').split('.')[1]?.length ?? 0);
}

/** The money on a row: amounts printed with decimals; bare integers only when `allowIntegers` and nothing has decimals. */
export function moneyIn(text: string, exponent: number | null, allowIntegers: boolean): bigint[] {
  const amounts = amountsIn(text, exponent);
  const decimals = amounts.filter((a) => a.decimal);
  if (decimals.length > 0) return decimals.map((a) => a.minor);
  return allowIntegers ? amounts.map((a) => a.minor) : [];
}
