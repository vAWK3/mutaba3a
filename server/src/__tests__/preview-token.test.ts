import { describe, expect, it } from 'vitest';
import { previewToken, verifyPreviewToken } from '../preview-token.js';

describe('generic preview token', () => {
  it('is stable for equal parts regardless of key order, and handles bigint', () => {
    const a = previewToken(['org', { amount: 100n, basis: 'X' }, 1800]);
    const b = previewToken(['org', { basis: 'X', amount: 100n }, 1800]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any part changes', () => {
    const base = previewToken(['org', { amount: 100n }, 1800]);
    expect(previewToken(['org2', { amount: 100n }, 1800])).not.toBe(base);
    expect(previewToken(['org', { amount: 101n }, 1800])).not.toBe(base);
    expect(previewToken(['org', { amount: 100n }, 1700])).not.toBe(base);
  });

  it('verifies in constant time and rejects length mismatches', () => {
    const t = previewToken(['x']);
    expect(verifyPreviewToken(t, ['x'])).toBe(true);
    expect(verifyPreviewToken(t.slice(1), ['x'])).toBe(false);
    expect(verifyPreviewToken(t, ['y'])).toBe(false);
  });
});
