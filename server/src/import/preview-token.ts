import { createHash, timingSafeEqual } from 'node:crypto';
import type { ImportRow } from './plan.js';

/**
 * Proves that a commit carries exactly the rows the caller previewed
 * (brief §2.2): sha256 over organization, provider and the canonical rows.
 * Never stored; verified by recomputation. It does not freeze the world —
 * commit re-plans against current state — it only stops a client from
 * committing rows it never looked at.
 */
export function previewToken(organizationId: string, provider: string, rows: readonly ImportRow[]): string {
  const canonical = JSON.stringify(rows.map(canonicalRow));
  return createHash('sha256').update(`${organizationId}\n${provider}\n${canonical}`).digest('hex');
}

export function verifyPreviewToken(token: string, organizationId: string, provider: string, rows: readonly ImportRow[]): boolean {
  const expected = Buffer.from(previewToken(organizationId, provider, rows), 'utf8');
  const presented = Buffer.from(token, 'utf8');
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}

function canonicalRow(row: ImportRow): Record<string, string> {
  if (row.entityType === 'CUSTOMER') {
    return compact({ entityType: row.entityType, externalId: row.externalId, name: row.name, email: row.email, phone: row.phone });
  }
  return { entityType: row.entityType, externalId: row.externalId, name: row.name, currency: row.currency, customerExternalId: row.customerExternalId };
}

function compact(record: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) if (v !== undefined) out[k] = v;
  return out;
}
