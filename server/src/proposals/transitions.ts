import type { FeeProposalRecord, FeeProposalStatus } from '../repositories/ports.js';

/**
 * The fee-proposal state machine (M7 brief §3). Pure: the routes and the
 * stores both read these tables so a refused transition reads the same in a
 * 409 as it does in a store contract test.
 *
 *   PROPOSED ──approve──► CLIENT_APPROVED ──agree──► AGREED
 *      │                        │                      │
 *      ├──agree─────────────────┼──────────────────────┘
 *      │                        │                      │
 *      └──withdraw──────────────┴──────────────────────┴──► WITHDRAWN
 *   CLIENT_APPROVED | AGREED ──convert (agreement created)──► CONVERTED
 */
export const FEE_PROPOSAL_STATUSES = ['PROPOSED', 'CLIENT_APPROVED', 'AGREED', 'CONVERTED', 'WITHDRAWN'] as const;

export const OPEN_PROPOSAL_STATUSES: readonly FeeProposalStatus[] = ['PROPOSED', 'CLIENT_APPROVED', 'AGREED'];

export type ProposalVerb = 'approve' | 'agree' | 'withdraw' | 'convert';

const ALLOWED_FROM: Record<ProposalVerb, readonly FeeProposalStatus[]> = {
  approve: ['PROPOSED'],
  agree: ['PROPOSED', 'CLIENT_APPROVED'],
  withdraw: OPEN_PROPOSAL_STATUSES,
  convert: ['CLIENT_APPROVED', 'AGREED'],
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

/** The agreed amount a transition leaves behind: approve = the proposed amount; agree = the explicit figure. */
export function agreedAmountAfter(verb: 'approve' | 'agree', record: Pick<FeeProposalRecord, 'proposedAmountMinor'>, explicitMinor?: bigint): bigint {
  if (verb === 'approve') return record.proposedAmountMinor;
  if (explicitMinor === undefined) throw new Error('agree needs an explicit amount');
  return explicitMinor;
}

/**
 * What the project summary shows (brief §2): the open proposal if any, else
 * the most recently converted one, else null. Withdrawn ones are history only.
 */
export function currentProposal(records: readonly FeeProposalRecord[]): FeeProposalRecord | null {
  const open = records.find((r) => isOpenProposal(r.status));
  if (open) return open;
  let latest: FeeProposalRecord | null = null;
  for (const r of records) {
    if (r.status !== 'CONVERTED') continue;
    if (!latest || r.updatedAt.getTime() > latest.updatedAt.getTime() || (r.updatedAt.getTime() === latest.updatedAt.getTime() && r.id > latest.id)) latest = r;
  }
  return latest;
}
