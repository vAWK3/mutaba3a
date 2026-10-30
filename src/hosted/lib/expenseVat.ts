import { currencyExponent, normalizeNumerals, type Currency } from '../../lib/utils';
import type { components } from '../api/schema';

/**
 * MUT-302 (ADR-231): the VAT row's preview of the split the server will store. Display only: the server computes and
 * writes net and VAT (`computeVat`, VAT_INCLUSIVE, half-up); this port is held to it by the shared case table
 * (`server/src/__tests__/fixtures/expense-vat-cases.json`). String and BigInt work only, as the portal's money lint asks.
 */
export type VatTreatment = components['schemas']['VatTreatment'];

export const VAT_TREATMENTS = ['STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'] as const satisfies readonly VatTreatment[];

const BP_SCALE = 10000n;
const MAX_RATE_BASIS_POINTS = 10000;
const GROUPED_AMOUNT = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/;
const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?%?$/;

/** Digits as a whole number; the inputs here are short, validated digit strings. */
function digitsToInt(digits: string): number {
  let n = 0;
  for (const d of digits) n = n * 10 + (d.charCodeAt(0) - 48);
  return n;
}

/** A typed amount in minor units at the currency's exponent, or null when it can't be read without guessing. */
function amountToMinor(amount: string, exponent: number): bigint | null {
  const match = GROUPED_AMOUNT.exec(normalizeNumerals(amount).trim());
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > exponent) return null;
  return BigInt(whole.replace(/,/g, '') + fraction.padEnd(exponent, '0'));
}

function minorToDecimal(minor: bigint, exponent: number): string {
  if (exponent === 0) return minor.toString();
  const digits = minor.toString().padStart(exponent + 1, '0');
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/**
 * Net and VAT inside a typed gross, as decimal strings in the currency's digits; null when the amount or a standard
 * rate is missing or unreadable. The other treatments take no VAT out.
 */
export function vatPreview(amount: string, currency: Currency, treatment: VatTreatment, rateBasisPoints: number | null): { net: string; vat: string } | null {
  const exponent = currencyExponent(currency);
  const gross = amountToMinor(amount, exponent);
  if (gross === null || gross <= 0n) return null;
  if (treatment !== 'STANDARD_RATED') return { net: minorToDecimal(gross, exponent), vat: minorToDecimal(0n, exponent) };
  if (rateBasisPoints === null || rateBasisPoints < 1 || rateBasisPoints > MAX_RATE_BASIS_POINTS) return null;
  const divisor = BP_SCALE + BigInt(rateBasisPoints);
  const net = (gross * BP_SCALE + divisor / 2n) / divisor;
  return { net: minorToDecimal(net, exponent), vat: minorToDecimal(gross - net, exponent) };
}

/** A typed percent ("17", "17.5", Arabic-Indic digits, an optional "%") as basis points 1..10000; null otherwise. */
export function percentToBasisPoints(text: string): number | null {
  const match = PERCENT.exec(normalizeNumerals(text).trim());
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  const bp = digitsToInt(whole) * 100 + digitsToInt(fraction.padEnd(2, '0'));
  return bp >= 1 && bp <= MAX_RATE_BASIS_POINTS ? bp : null;
}

/** Basis points as the shortest percent text: 1700 → "17", 1750 → "17.5", 1 → "0.01". */
export function basisPointsToPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const fraction = (bp % 100).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}
