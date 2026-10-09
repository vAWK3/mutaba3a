import { describe, expect, it } from 'vitest';
import { StateConflict, UniqueViolation } from '../memory.js';
import type { CreateAgreementInput, LedgerStore, Organization } from '../ports.js';

/** Milestone 7 storage contract: fee proposals and their conversion on agreement creation. */
export function describeLedgerStoreM7Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 9, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function project(store: LedgerStore, o: Organization) {
    const customer = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: null }, at(0));
    return store.projects.create({ organizationId: o.id, customerId: customer.id, name: 'Sale', currency: 'ILS', vatTreatment: null }, at(0));
  }

  const input = (o: Organization, p: { id: string; customerId: string }, amount = 1_000_000n) => ({
    organizationId: o.id,
    projectId: p.id,
    customerId: p.customerId,
    currency: 'ILS',
    pricingBasis: 'VAT_EXCLUSIVE' as const,
    proposedAmountMinor: amount,
    proposedOn: '2026-10-09',
    note: null,
    requestId: 'req',
  });

  function agreementInput(o: Organization, p: { id: string; customerId: string }, feeProposalId: string | null): CreateAgreementInput {
    return {
      organizationId: o.id,
      projectId: p.id,
      customerId: p.customerId,
      type: 'FIXED',
      currency: 'ILS',
      pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'EXEMPT',
      vatRateBasisPoints: 0,
      amountMinor: 900_000n,
      netMinor: 900_000n,
      vatMinor: 0n,
      grossMinor: 900_000n,
      agreementDate: '2026-10-09',
      description: null,
      paymentTerms: 'EOM',
      startMonth: null,
      billingDay: null,
      endMonth: null,
      installments: [{ position: 1, label: 'All', amountMinor: 900_000n, netMinor: 900_000n, vatMinor: 0n, grossMinor: 900_000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'MANUAL', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
      feeProposalId,
    };
  }

  describe(`${name} LedgerStore M7 contract`, () => {
    it('creates a PROPOSED proposal, refuses a second open one on the project, lists and filters, organization-scoped', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      const p = await project(store, a);
      const created = await store.feeProposals.create(input(a, p), at(1));
      expect(created).toMatchObject({ status: 'PROPOSED', agreedAmountMinor: null, agreementId: null, version: 1, proposedAmountMinor: 1_000_000n });
      await expect(store.feeProposals.create(input(a, p, 5n), at(2))).rejects.toBeInstanceOf(UniqueViolation);
      expect((await store.feeProposals.findOpenByProject(a.id, p.id))?.id).toBe(created.id);
      expect(await store.feeProposals.getById(b.id, created.id)).toBeNull();
      expect((await store.feeProposals.list(a.id, { projectId: p.id, open: true }, { limit: 10, cursor: null })).items.map((x) => x.id)).toEqual([created.id]);
      expect((await store.feeProposals.list(a.id, { open: false }, { limit: 10, cursor: null })).items).toEqual([]);
      expect((await store.feeProposals.list(a.id, { customerId: p.customerId, status: 'PROPOSED' }, { limit: 10, cursor: null })).items).toHaveLength(1);
      expect((await store.feeProposals.list(b.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
      // a withdrawn one frees the project for a new proposal, and paginates with the shared keyset cursor
      await store.feeProposals.transition(a.id, created.id, ['PROPOSED'], { status: 'WITHDRAWN', withdrawnAt: at(3), withdrawnReason: 'typo' }, at(3));
      const second = await store.feeProposals.create(input(a, p, 2_000_000n), at(4));
      const first = await store.feeProposals.list(a.id, { projectId: p.id }, { limit: 1, cursor: null });
      expect(first.items.map((x) => x.id)).toEqual([created.id]);
      expect(first.nextCursor).not.toBeNull();
      const rest = await store.feeProposals.list(a.id, { projectId: p.id }, { limit: 1, cursor: first.nextCursor });
      expect(rest.items.map((x) => x.id)).toEqual([second.id]);
      expect(rest.nextCursor).toBeNull();
    });

    it('transition is conditional on the current status and bumps the version', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const p = await project(store, a);
      const created = await store.feeProposals.create(input(a, p), at(1));
      const wrong = await store.feeProposals.transition(a.id, created.id, ['CLIENT_APPROVED'], { status: 'AGREED', agreedAmountMinor: 1n }, at(2));
      expect(wrong.kind).toBe('wrong_status');
      const approved = await store.feeProposals.transition(a.id, created.id, ['PROPOSED'], { status: 'CLIENT_APPROVED', clientApprovedOn: '2026-10-10', clientApprovalNote: 'ok', agreedAmountMinor: 1_000_000n }, at(2));
      expect(approved).toMatchObject({ kind: 'updated', record: { status: 'CLIENT_APPROVED', clientApprovedOn: '2026-10-10', clientApprovalNote: 'ok', agreedAmountMinor: 1_000_000n, version: 2, updatedAt: at(2) } });
      const agreed = await store.feeProposals.transition(a.id, created.id, ['PROPOSED', 'CLIENT_APPROVED'], { status: 'AGREED', agreedAmountMinor: 900_000n, agreedOn: '2026-10-11', agreedNote: null }, at(3));
      expect(agreed).toMatchObject({ kind: 'updated', record: { status: 'AGREED', agreedAmountMinor: 900_000n, clientApprovedOn: '2026-10-10', version: 3 } });
      expect(await store.feeProposals.transition(a.id, '00000000-0000-4000-8000-000000000000', ['AGREED'], { status: 'WITHDRAWN' }, at(4))).toEqual({ kind: 'not_found' });
      const other = await org(store, 'B');
      expect(await store.feeProposals.transition(other.id, created.id, ['AGREED'], { status: 'WITHDRAWN' }, at(4))).toEqual({ kind: 'not_found' });
    });

    it('agreement creation with feeProposalId converts an approved or agreed proposal atomically and refuses any other', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const p = await project(store, a);
      const proposed = await store.feeProposals.create(input(a, p), at(1));
      // still PROPOSED: refused, and nothing created
      await expect(store.agreements.create(agreementInput(a, p, proposed.id), at(2))).rejects.toBeInstanceOf(StateConflict);
      expect((await store.agreements.list(a.id, { projectId: p.id }, { limit: 10, cursor: null })).items).toEqual([]);
      expect((await store.feeProposals.getById(a.id, proposed.id))?.status).toBe('PROPOSED');
      await store.feeProposals.transition(a.id, proposed.id, ['PROPOSED'], { status: 'CLIENT_APPROVED', clientApprovedOn: '2026-10-10', agreedAmountMinor: 1_000_000n }, at(3));
      const { agreement } = await store.agreements.create(agreementInput(a, p, proposed.id), at(4));
      const converted = await store.feeProposals.getById(a.id, proposed.id);
      expect(converted).toMatchObject({ status: 'CONVERTED', agreementId: agreement.id, version: 3 });
      expect(await store.feeProposals.findOpenByProject(a.id, p.id)).toBeNull();
      // a converted proposal cannot convert again; a proposal of another project is refused
      await expect(store.agreements.create(agreementInput(a, p, proposed.id), at(5))).rejects.toBeInstanceOf(StateConflict);
      const p2 = await project(store, a);
      const other = await store.feeProposals.create(input(a, p2), at(6));
      await store.feeProposals.transition(a.id, other.id, ['PROPOSED'], { status: 'AGREED', agreedAmountMinor: 5n, agreedOn: '2026-10-11' }, at(7));
      await expect(store.agreements.create(agreementInput(a, p, other.id), at(8))).rejects.toBeInstanceOf(StateConflict);
      // without a proposal, creation is untouched
      const plain = await store.agreements.create(agreementInput(a, p2, null), at(9));
      expect(plain.agreement.projectId).toBe(p2.id);
      expect((await store.feeProposals.getById(a.id, other.id))?.status).toBe('AGREED');
    });
  });
}
