import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Proof that a commit carries what was previewed (PATTERNS.md "preview
 * token"): sha256 over canonical JSON of the parts. Parts include everything
 * the preview's outcome depended on — for agreements that is the body *and*
 * the VAT rate, so a rate change between preview and create is PREVIEW_STALE.
 * Never stored; verified by recomputation in constant time.
 */
export function previewToken(parts: readonly unknown[]): string {
  return createHash('sha256').update(canonical(parts)).digest('hex');
}

export function verifyPreviewToken(token: string, parts: readonly unknown[]): boolean {
  const expected = Buffer.from(previewToken(parts), 'utf8');
  const presented = Buffer.from(token, 'utf8');
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'bigint') return `${v.toString()}n`;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}
