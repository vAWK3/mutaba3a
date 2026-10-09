import { describe, expect, it } from 'vitest';
import type { FeeProposalRecord, FeeProposalStatus } from '../../repositories/ports.js';
import { agreedAmountAfter, allowedFrom, canTransition, currentProposal, FEE_PROPOSAL_STATUSES, isOpenProposal, OPEN_PROPOSAL_STATUSES } from '../transitions.js';

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
    agreedOn: null,
    agreedNote: null,
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

describe('fee proposal transitions', () => {
  it('names the open states', () => {
    expect(OPEN_PROPOSAL_STATUSES).toEqual(['PROPOSED', 'CLIENT_APPROVED', 'AGREED']);
    for (const s of FEE_PROPOSAL_STATUSES) expect(isOpenProposal(s)).toBe(OPEN_PROPOSAL_STATUSES.includes(s));
  });

  it('approve only from PROPOSED; agree from PROPOSED and CLIENT_APPROVED; withdraw from every open state; convert from CLIENT_APPROVED and AGREED', () => {
    const table: Record<FeeProposalStatus, { approve: boolean; agree: boolean; withdraw: boolean; convert: boolean }> = {
      PROPOSED: { approve: true, agree: true, withdraw: true, convert: false },
      CLIENT_APPROVED: { approve: false, agree: true, withdraw: true, convert: true },
      AGREED: { approve: false, agree: false, withdraw: true, convert: true },
      CONVERTED: { approve: false, agree: false, withdraw: false, convert: false },
      WITHDRAWN: { approve: false, agree: false, withdraw: false, convert: false },
    };
    for (const [from, verbs] of Object.entries(table) as Array<[FeeProposalStatus, (typeof table)[FeeProposalStatus]]>) {
      for (const [verb, allowed] of Object.entries(verbs) as Array<['approve' | 'agree' | 'withdraw' | 'convert', boolean]>) {
        expect(canTransition(from, verb), `${verb} from ${from}`).toBe(allowed);
        expect(allowedFrom(verb).includes(from)).toBe(allowed);
      }
    }
  });

  it('approve agrees at the proposed amount; agree takes the explicit figure and needs one', () => {
    const p = proposal();
    expect(agreedAmountAfter('approve', p)).toBe(1_000_000n);
    expect(agreedAmountAfter('agree', p, 900_000n)).toBe(900_000n);
    expect(() => agreedAmountAfter('agree', p)).toThrow();
  });

  it('currentProposal: the open one wins; else the latest converted; withdrawn ones never', () => {
    const withdrawn = proposal({ id: 'w', status: 'WITHDRAWN' });
    const convertedOld = proposal({ id: 'c1', status: 'CONVERTED', updatedAt: new Date('2026-10-01T00:00:00Z') });
    const convertedNew = proposal({ id: 'c2', status: 'CONVERTED', updatedAt: new Date('2026-10-05T00:00:00Z') });
    const open = proposal({ id: 'o', status: 'AGREED' });
    expect(currentProposal([])).toBeNull();
    expect(currentProposal([withdrawn])).toBeNull();
    expect(currentProposal([withdrawn, convertedOld, convertedNew])?.id).toBe('c2');
    expect(currentProposal([convertedNew, withdrawn, open])?.id).toBe('o');
  });
});
