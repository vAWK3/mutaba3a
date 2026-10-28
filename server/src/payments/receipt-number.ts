/**
 * MUT-481 (ADR-223): the number of the legal receipt the firm issued in its invoicing app. A label Mutaba3a stores and
 * shows, never a document it issues; not unique (a correction shares it with the payment it replaces).
 */
export const RECEIPT_NUMBER_MAX = 64;

/** Control characters (C0, DEL, C1); anything else (any script, digits, separators) is allowed. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Invisible marks a copy from an invoicing app can carry: zero-width characters, direction marks and isolates, BOM. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/**
 * D3: invisible marks dropped (so an exact `?receiptNumber=` search still matches), then trimmed; 1–64 characters with
 * no control characters left inside; null means none.
 */
export function normalizeReceiptNumber(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  const value = raw.replace(INVISIBLE, '').trim();
  if (value.length === 0 || value.length > RECEIPT_NUMBER_MAX || CONTROL.test(value)) return { ok: false };
  return { ok: true, value };
}

/**
 * D1: what a new payment carries. Left out on a correction (`replacesPaymentId`), it keeps the replaced payment's
 * number; `null` clears it; a value replaces it. Left out on a plain payment, none.
 */
export function carriedReceiptNumber(input: { given: string | null | undefined; replaced: { receiptNumber: string | null } | null }): { value: string | null; carried: boolean } {
  if (input.given !== undefined) return { value: input.given, carried: false };
  const carried = input.replaced?.receiptNumber ?? null;
  return { value: carried, carried: carried !== null };
}
