import type { AccountantGrantRecord } from '../repositories/ports.js';

/**
 * MUT-559 (ADR-245): an owner shares one profile, read-only, with an accountant. The rules of a grant's life live
 * here: the invite token, who may accept it (D4), the views a grant is shown as, and the throttled "last viewed".
 * Access itself is decided in one place, selectProfile (auth/middleware.ts).
 */

/** An invite can be accepted for 14 days. Expiry is computed from `inviteExpiresAt`; no job sweeps it. */
export const ACCOUNTANT_INVITE_TTL_MS = 14 * 86_400_000;

/** Counts toward the per-profile cap and blocks a second invite to the address: ACTIVE, or PENDING and unexpired. */
export function isLiveGrant(grant: Pick<AccountantGrantRecord, 'status' | 'inviteExpiresAt'>, at: Date): boolean {
  return grant.status === 'ACTIVE' || (grant.status === 'PENDING' && grant.inviteExpiresAt > at);
}
