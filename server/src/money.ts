/**
 * Money representation for the ledger (plan MUT-5 "decimal-safe arithmetic",
 * §11 "decimal-safe monetary serialization", G4/G5).
 *
 * Internally an amount is a `bigint` of minor units plus a currency; on the
 * wire it is a decimal string ("10000.00") plus a currency. There is no code
 * path that holds a monetary value in a JavaScript `number`.
 *
 * This is the Mutaba3a discipline (ADR-009, minor units) made explicit: the
 * desktop hard-codes `/100`; the service carries the exponent per currency so
 * a zero-decimal currency can be added without touching arithmetic.
 */
/**
 * New codes are appended, so existing positions (rates order, the OpenAPI enum) never move. MUT-280 added the Gulf
 * five and MUT-388 (ADR-166) took them out again: the hosted API offers only what the ECB prices, plus JOD.
 */
export const SUPPORTED_CURRENCIES = ['ILS', 'USD', 'EUR', 'JOD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const EXPONENT: Record<Currency, number> = { ILS: 2, USD: 2, EUR: 2, JOD: 3 };

/**
 * MUT-388 (ADR-166): codes this API supported once and no longer accepts. Display only: `formatMoney` reads them so a
 * row written while one was supported comes back with its real amount (a blank one fails every phone build's whole
 * Recent page). Never a reason to accept one: `parseMoney`, `isSupportedCurrency` and the schemas use EXPONENT only.
 */
const RETIRED_EXPONENT: Readonly<Record<string, number>> = { AED: 2, SAR: 2, QAR: 2, BHD: 3, OMR: 3 };

export function isSupportedCurrency(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function currencyExponent(currency: Currency): number {
  return EXPONENT[currency];
}

export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * The largest amount the API accepts, in minor units, either sign (MUT-126):
 * 9,999,999,999,999.99 in a 2-decimal currency, 999,999,999,999.999 in a 3-decimal one. Amounts are stored in Postgres
 * BIGINT columns (max ~9.2e18); without a bound an oversized amount passed
 * validation and failed inside the write as a 500. The headroom below BIGINT
 * also keeps sums of many amounts in range.
 */
export const MAX_AMOUNT_MINOR = 10n ** 15n - 1n;

/**
 * Parse a canonical decimal string. Accepts "10000", "10000.5", "10000.50",
 * "-3000.00". Rejects locale separators, exponents, whitespace and more
 * fractional digits than the currency carries — the client must not have
 * rounded, and the server must not round silently.
 */
export function parseMoney(text: string, currency: Currency): Money {
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new MoneyParseError(`"${text}" is not a canonical decimal amount`);
  const exponent = currencyExponent(currency);
  // MUT-388: a stored row can still carry a code this server no longer supports (the Gulf five). Its `as Currency`
  // cast hides that, and an undefined exponent would silently rescale the amount.
  if (exponent === undefined) throw new MoneyParseError(`${currency} is not a supported currency`);
  const sign = m[1] ? -1n : 1n;
  const whole = m[2] ?? '0';
  const frac = m[3] ?? '';
  if (frac.length > exponent) {
    throw new MoneyParseError(`"${text}" has more than ${exponent} fractional digits for ${currency}`);
  }
  const scaled = BigInt(whole + frac.padEnd(exponent, '0'));
  if (scaled > MAX_AMOUNT_MINOR) {
    throw new MoneyParseError(`"${text}" is above the largest amount accepted (${formatMoney({ minor: MAX_AMOUNT_MINOR, currency })})`);
  }
  return { minor: sign * scaled, currency };
}

export function formatMoney(money: Money): string {
  const exponent = currencyExponent(money.currency) ?? RETIRED_EXPONENT[money.currency] ?? 2;
  const negative = money.minor < 0n;
  const abs = (negative ? -money.minor : money.minor).toString().padStart(exponent + 1, '0');
  const whole = abs.slice(0, abs.length - exponent);
  const frac = abs.slice(abs.length - exponent);
  return `${negative ? '-' : ''}${whole}${exponent > 0 ? '.' + frac : ''}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyParseError(`cannot combine ${a.currency} with ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export function isPositive(money: Money): boolean {
  return money.minor > 0n;
}

export function zero(currency: Currency): Money {
  return { minor: 0n, currency };
}
