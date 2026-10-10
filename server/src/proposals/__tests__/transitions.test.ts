import { describe, expect, it } from 'vitest';
import type { FeeProposalRecord, FeeProposalStatus } from '../../repositories/ports.js';
import { allowedFrom, canTransition, currentProposal, FEE_PROPOSAL_STATUSES, isOpenProposal, OPEN_PROPOSAL_STATUSES } from '../transitions.js';

function proposal(over: Partial<FeeProposalRecord> = {}): FeeProposalRecord {
  return {
    id: over.id ?? 'p1',
    organizationId: 'o',
    projectId: 'proj',
    customerId: 'c',
    currency: 'ILS',
    status: 'PROPOSED',
    pricingBasis: 'VAT_EXCLUSIVE',
    proposedAmountMinor: 1_000_000n,
    proposedOn: '2026-10-09',
    note: null,
    clientApprovedOn: null,
    clientApprovalNote: null,
    agreedAmountMinor: null,
    withdrawnAt: null,
    withdrawnReason: null,
    agreementId: null,
    requestId: null,
    version: 1,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
    ...over,
  };
}

describe('fee proposal transitions (M8)', () => {
  it('has three states and exactly one open one', () => {
    expect(FEE_PROPOSAL_STATUSES).toEqual(['PROPOSED', 'APPROVED', 'WITHDRAWN']);
    expect(OPEN_PROPOSAL_STATUSES).toEqual(['PROPOSED']);
    for (const s of FEE_PROPOSAL_STATUSES) expect(isOpenProposal(s)).toBe(s === 'PROPOSED');
  });

  it('approve and withdraw only from PROPOSED; nothing moves out of APPROVED or WITHDRAWN', () => {
    const table: Record<FeeProposalStatus, { approve: boolean; withdraw: boolean }> = {
      PROPOSED: { approve: true, withdraw: true },
      APPROVED: { approve: false, withdraw: false },
      WITHDRAWN: { approve: false, withdraw: false },
    };
    for (const [from, verbs] of Object.entries(table) as Array<[FeeProposalStatus, (typeof table)[FeeProposalStatus]]>) {
      for (const [verb, allowed] of Object.entries(verbs) as Array<['approve' | 'withdraw', boolean]>) {
        expect(canTransition(from, verb), `${verb} from ${from}`).toBe(allowed);
        expect(allowedFrom(verb).includes(from)).toBe(allowed);
      }
    }
  });

  it('currentProposal: the open one wins; else the latest approved; withdrawn ones never', () => {
    const withdrawn = proposal({ id: 'w', status: 'WITHDRAWN' });
    const approvedOld = proposal({ id: 'a1', status: 'APPROVED', updatedAt: new Date('2026-10-01T00:00:00Z') });
    const approvedNew = proposal({ id: 'a2', status: 'APPROVED', updatedAt: new Date('2026-10-05T00:00:00Z') });
    const open = proposal({ id: 'o', status: 'PROPOSED' });
    expect(currentProposal([])).toBeNull();
    expect(currentProposal([withdrawn])).toBeNull();
    expect(currentProposal([withdrawn, approvedOld, approvedNew])?.id).toBe('a2');
    expect(currentProposal([approvedNew, withdrawn, open])?.id).toBe('o');
  });
});
