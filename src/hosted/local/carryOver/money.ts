/**
 * The carried currencies' fractional digits. Kept here because the local
 * chunk can't import src/lib/utils under its stricter compiler settings; a
 * test holds it equal to `currencyExponent` there.
 */
export const CARRIED_EXPONENT = { ILS: 2, USD: 2, EUR: 2, JOD: 3 } as const satisfies Record<string, number>;

/** Minor units as the API's canonical decimal, exactly, at any size (a bigint never passes through a float). */
export function bigintToDecimal(minor: bigint, currency: string): string {
  const exponent = (CARRIED_EXPONENT as Record<string, number>)[currency];
  if (exponent === undefined) throw new Error(`not a carried currency: ${currency}`);
  const sign = minor < 0n ? '-' : '';
  const digits = (minor < 0n ? -minor : minor).toString().padStart(exponent + 1, '0');
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}
