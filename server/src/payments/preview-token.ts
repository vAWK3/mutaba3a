import { previewToken } from '../preview-token.js';

/**
 * The allocation preview token covers the balances, not only the body (M4
 * brief decision 2): it hashes the (id, version) of every receivable the
 * preview could have allocated to, so a payment or credit posted between the
 * review and the confirm changes a version and the token no longer verifies.
 */
export interface ReceivableSnapshot {
  id: string;
  version: number;
}

export function allocationSnapshot(receivables: readonly ReceivableSnapshot[]): Array<[string, number]> {
  return [...receivables].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => [r.id, r.version] as [string, number]);
}

export function paymentPreviewToken(organizationId: string, body: unknown, receivables: readonly ReceivableSnapshot[]): string {
  return previewToken([organizationId, 'payment', body, allocationSnapshot(receivables)]);
}
