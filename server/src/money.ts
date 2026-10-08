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
export const SUPPORTED_CURRENCIES = ['ILS', 'USD', 'EUR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const EXPONENT: Record<Currency, number> = { ILS: 2, USD: 2, EUR: 2 };

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
 * Parse a canonical decimal string. Accepts "10000", "10000.5", "10000.50",
 * "-3000.00". Rejects locale separators, exponents, whitespace and more
 * fractional digits than the currency carries — the client must not have
 * rounded, and the server must not round silently.
 */
export function parseMoney(text: string, currency: Currency): Money {
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new MoneyParseError(`"${text}" is not a canonical decimal amount`);
  const exponent = currencyExponent(currency);
  const sign = m[1] ? -1n : 1n;
  const whole = m[2] ?? '0';
  const frac = m[3] ?? '';
  if (frac.length > exponent) {
    throw new MoneyParseError(`"${text}" has more than ${exponent} fractional digits for ${currency}`);
  }
  const scaled = whole + frac.padEnd(exponent, '0');
  return { minor: sign * BigInt(scaled), currency };
}

export function formatMoney(money: Money): string {
  const exponent = currencyExponent(money.currency);
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
