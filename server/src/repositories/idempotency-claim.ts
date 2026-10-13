import type { IdempotencyStatus } from './ports.js';

export type ClaimOutcome = 'new' | 'in_progress' | 'mismatch' | 'replay';

/**
 * The new → in_progress → replay state machine, and the mismatch check
 * (different fingerprint or operation under the same key), shared by every
 * claim() implementation: organization-scoped and user-scoped (MUT-131),
 * memory and Prisma. Factored out rather than written a fourth time.
 */
export function resolveClaim(
  existing: { operation: string; fingerprint: string; status: IdempotencyStatus } | null | undefined,
  operation: string,
  fingerprint: string,
): ClaimOutcome {
  if (!existing) return 'new';
  if (existing.fingerprint !== fingerprint || existing.operation !== operation) return 'mismatch';
  if (existing.status === 'COMPLETED') return 'replay';
  return 'in_progress';
}
