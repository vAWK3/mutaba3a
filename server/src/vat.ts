/**
 * VAT on a payable item (brief rev. 2 §A): the firm's effective-dated rate,
 * a pricing basis, and a treatment resolved per item. Integer arithmetic on
 * minor units and basis points; rounding is half-up and symmetric.
 */
export const VAT_TREATMENTS = ['STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

export const PRICING_BASES = ['VAT_EXCLUSIVE', 'VAT_INCLUSIVE'] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];

export const BP_SCALE = 10000n;
export const MAX_RATE_BASIS_POINTS = 10000;

export interface VatInput {
  /** The contractual amount in the pricing basis, minor units. May be negative (supplements). */
  amountMinor: bigint;
  pricingBasis: PricingBasis;
  treatment: VatTreatment;
  /** The standard rate in basis points (1800 = 18 %). Ignored unless STANDARD_RATED. */
  rateBasisPoints: number;
}

export interface VatResult {
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  /** The rate actually applied: the standard rate, or 0 for the other treatments. Frozen on the record. */
  rateBasisPoints: number;
}

export function assertRateBasisPoints(rate: number): void {
  if (!Number.isInteger(rate) || rate < 0 || rate > MAX_RATE_BASIS_POINTS) {
    throw new RangeError(`VAT rate must be an integer between 0 and ${MAX_RATE_BASIS_POINTS} basis points`);
  }
}

/** n / d rounded half up, symmetric for negative n. d must be positive. */
export function roundHalfUpDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  if (n >= 0n) return (n + d / 2n) / d;
  return -((-n + d / 2n) / d);
}

export function computeVat(input: VatInput): VatResult {
  assertRateBasisPoints(input.rateBasisPoints);
  if (input.treatment !== 'STANDARD_RATED') {
    return { netMinor: input.amountMinor, vatMinor: 0n, grossMinor: input.amountMinor, rateBasisPoints: 0 };
  }
  const rate = BigInt(input.rateBasisPoints);
  if (input.pricingBasis === 'VAT_EXCLUSIVE') {
    const netMinor = input.amountMinor;
    const vatMinor = roundHalfUpDiv(netMinor * rate, BP_SCALE);
    return { netMinor, vatMinor, grossMinor: netMinor + vatMinor, rateBasisPoints: input.rateBasisPoints };
  }
  const grossMinor = input.amountMinor;
  const netMinor = roundHalfUpDiv(grossMinor * BP_SCALE, BP_SCALE + rate);
  return { netMinor, vatMinor: grossMinor - netMinor, grossMinor, rateBasisPoints: input.rateBasisPoints };
}
