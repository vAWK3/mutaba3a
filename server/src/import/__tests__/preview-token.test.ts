import { describe, expect, it } from 'vitest';
import { previewToken, verifyPreviewToken } from '../preview-token.js';
import type { ImportRow } from '../plan.js';

const rows: ImportRow[] = [
  { entityType: 'CUSTOMER', externalId: 'c1', name: 'Acme' },
  { entityType: 'PROJECT', externalId: 'p1', name: 'Case', currency: 'ILS', customerExternalId: 'c1' },
];

describe('import preview token', () => {
  it('is stable for the same organization, provider and rows', () => {
    expect(previewToken('org-a', 'MALAFAT', rows)).toBe(previewToken('org-a', 'MALAFAT', rows));
    expect(previewToken('org-a', 'MALAFAT', rows)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when rows change, are reordered, or belong to another organization', () => {
    const base = previewToken('org-a', 'MALAFAT', rows);
    expect(previewToken('org-b', 'MALAFAT', rows)).not.toBe(base);
    expect(previewToken('org-a', 'MALAFAT', [rows[1]!, rows[0]!])).not.toBe(base);
    expect(previewToken('org-a', 'MALAFAT', [{ ...rows[0]!, name: 'Acme Ltd' }, rows[1]!])).not.toBe(base);
  });

  it('ignores optional fields that are absent vs undefined, so JSON clients round-trip', () => {
    const a = previewToken('org-a', 'MALAFAT', [{ entityType: 'CUSTOMER', externalId: 'c1', name: 'Acme' }]);
    const b = previewToken('org-a', 'MALAFAT', [{ entityType: 'CUSTOMER', externalId: 'c1', name: 'Acme', email: undefined }]);
    expect(a).toBe(b);
  });

  it('verifies with a constant-time comparison and rejects length mismatches', () => {
    const token = previewToken('org-a', 'MALAFAT', rows);
    expect(verifyPreviewToken(token, 'org-a', 'MALAFAT', rows)).toBe(true);
    expect(verifyPreviewToken(token.slice(0, 10), 'org-a', 'MALAFAT', rows)).toBe(false);
    expect(verifyPreviewToken(token, 'org-b', 'MALAFAT', rows)).toBe(false);
  });
});
