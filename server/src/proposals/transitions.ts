import type { FeeProposalRecord, FeeProposalStatus } from '../repositories/ports.js';

/**
 * The fee-proposal state machine (M8 brief §6, decisions D4 / D5). Pure: the
 * routes and the stores both read these tables so a refused transition reads
 * the same in a 409 as it does in a store contract test.
 *
 *   PROPOSED ──approve (creates the agreement, same transaction)──► APPROVED
 *      │
 *      └──withdraw──────────────────────────────────────────────► WITHDRAWN
 *
 * APPROVED and WITHDRAWN are terminal. "Open" = PROPOSED, and one open
 * proposal per project is the store's rule.
 */
export const FEE_PROPOSAL_STATUSES = ['PROPOSED', 'APPROVED', 'WITHDRAWN'] as const;

export const OPEN_PROPOSAL_STATUSES: readonly FeeProposalStatus[] = ['PROPOSED'];

export type ProposalVerb = 'approve' | 'withdraw';

const ALLOWED_FROM: Record<ProposalVerb, readonly FeeProposalStatus[]> = {
  approve: ['PROPOSED'],
  withdraw: ['PROPOSED'],
};

export function isOpenProposal(status: FeeProposalStatus): boolean {
  return OPEN_PROPOSAL_STATUSES.includes(status);
}

export function allowedFrom(verb: ProposalVerb): readonly FeeProposalStatus[] {
  return ALLOWED_FROM[verb];
}

export function canTransition(from: FeeProposalStatus, verb: ProposalVerb): boolean {
  return ALLOWED_FROM[verb].includes(from);
}

/**
 * What the project summary shows (M7 brief §2, M8 statuses): the open
 * proposal if any, else the most recently approved one, else null. Withdrawn
 * ones are history only.
 */
export function currentProposal(records: readonly FeeProposalRecord[]): FeeProposalRecord | null {
  const open = records.find((r) => isOpenProposal(r.status));
  if (open) return open;
  let latest: FeeProposalRecord | null = null;
  for (const r of records) {
    if (r.status !== 'APPROVED') continue;
    if (!latest || r.updatedAt.getTime() > latest.updatedAt.getTime() || (r.updatedAt.getTime() === latest.updatedAt.getTime() && r.id > latest.id)) latest = r;
  }
  return latest;
}
