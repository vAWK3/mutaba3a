import { BP_SCALE, assertRateBasisPoints, roundHalfUpDiv, type VatTreatment } from '../vat.js';

/**
 * Credits against a posted receivable (M4 brief decision 5). The credit is a
 * gross magnitude in the receivable's currency; its VAT share is carved out at
 * the receivable's frozen rate and treatment, so `net + vat = credit` always
 * and the posted gross / net / vat are never touched.
 */
export interface CreditSplit {
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
}

export type CreditErrorReason = 'AMOUNT_INVALID' | 'RECEIVABLE_NOT_OPEN' | 'CREDIT_EXCEEDS_OUTSTANDING';

export function splitCredit(input: { amountMinor: bigint; treatment: VatTreatment; rateBasisPoints: number }): CreditSplit {
  assertRateBasisPoints(input.rateBasisPoints);
  if (input.amountMinor <= 0n) throw new RangeError('credit must be positive');
  if (input.treatment !== 'STANDARD_RATED' || input.rateBasisPoints === 0) {
    return { amountMinor: input.amountMinor, netMinor: input.amountMinor, vatMinor: 0n };
  }
  const netMinor = roundHalfUpDiv(input.amountMinor * BP_SCALE, BP_SCALE + BigInt(input.rateBasisPoints));
  return { amountMinor: input.amountMinor, netMinor, vatMinor: input.amountMinor - netMinor };
}

/** The one rule: a credit never exceeds what is still outstanding (what was paid is not refunded by a credit). */
export function checkCredit(input: { amountMinor: bigint; outstandingMinor: bigint; status: 'OPEN' | 'SETTLED' }): { ok: true } | { ok: false; reason: CreditErrorReason; outstandingMinor?: bigint } {
  if (input.amountMinor <= 0n) return { ok: false, reason: 'AMOUNT_INVALID' };
  if (input.status !== 'OPEN' || input.outstandingMinor <= 0n) return { ok: false, reason: 'RECEIVABLE_NOT_OPEN' };
  if (input.amountMinor > input.outstandingMinor) return { ok: false, reason: 'CREDIT_EXCEEDS_OUTSTANDING', outstandingMinor: input.outstandingMinor };
  return { ok: true };
}
