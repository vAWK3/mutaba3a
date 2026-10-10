import { describe, expect, it } from 'vitest';
import { StateConflict, UniqueViolation } from '../memory.js';
import type { CreateAgreementInput, CreateInstallmentInput, LedgerStore, Organization } from '../ports.js';

/**
 * Milestone 8 storage contract (M8 brief §6, decisions D5 / D15 / D16 / D20):
 * fee proposals with three states, the approve transition riding the agreement
 * creation, and `listUnpostedDue` healing unposted IMMEDIATE installments.
 * Replaces the M7 contract (CLIENT_APPROVED / AGREED / CONVERTED are gone).
 */
export function describeLedgerStoreM8Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 10, 10, 0, 0, ms));
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
    proposedOn: '2026-10-10',
    note: null,
    requestId: 'req',
  });

  const installment = (over: Partial<CreateInstallmentInput> = {}): CreateInstallmentInput => ({
    position: 1,
    label: 'All',
    amountMinor: 900_000n,
    netMinor: 900_000n,
    vatMinor: 0n,
    grossMinor: 900_000n,
    vatTreatment: 'EXEMPT',
    rateBasisPoints: 0,
    triggerType: 'MANUAL',
    triggerDate: null,
    paymentTerms: null,
    dueDateOverride: null,
    ...over,
  });

  const approval = (id: string, over: Partial<NonNullable<CreateAgreementInput['approveProposal']>> = {}) => ({ id, agreedAmountMinor: 900_000n, approvedOn: '2026-10-10', note: null, ...over });

  function agreementInput(o: Organization, p: { id: string; customerId: string }, approveProposal: CreateAgreementInput['approveProposal'], installments: CreateInstallmentInput[] = [installment()]): CreateAgreementInput {
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
      agreementDate: '2026-10-10',
      description: null,
      paymentTerms: 'EOM',
      startMonth: null,
      billingDay: null,
      endMonth: null,
      installments,
      approveProposal: approveProposal ?? null,
    };
  }

  describe(`${name} LedgerStore M8 contract`, () => {
    it('creates a PROPOSED proposal, refuses a second open one, lists with open=true meaning PROPOSED only, organization-scoped', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      const p = await project(store, a);
      const created = await store.feeProposals.create(input(a, p), at(1));
      expect(created).toMatchObject({ status: 'PROPOSED', agreedAmountMinor: null, clientApprovedOn: null, agreementId: null, version: 1 });
      expect(Object.keys(created)).not.toContain('agreedOn');
      await expect(store.feeProposals.create(input(a, p, 5n), at(2))).rejects.toBeInstanceOf(UniqueViolation);
      expect((await store.feeProposals.findOpenByProject(a.id, p.id))?.id).toBe(created.id);
      expect(await store.feeProposals.getById(b.id, created.id)).toBeNull();
      expect((await store.feeProposals.list(a.id, { open: true }, { limit: 10, cursor: null })).items.map((x) => x.id)).toEqual([created.id]);
      await store.feeProposals.transition(a.id, created.id, ['PROPOSED'], { status: 'WITHDRAWN', withdrawnAt: at(3), withdrawnReason: 'typo' }, at(3));
      expect((await store.feeProposals.list(a.id, { open: true }, { limit: 10, cursor: null })).items).toEqual([]);
      expect((await store.feeProposals.list(a.id, { open: false }, { limit: 10, cursor: null })).items.map((x) => x.id)).toEqual([created.id]);
      // the project is free again
      const second = await store.feeProposals.create(input(a, p, 2_000_000n), at(4));
      expect(second.status).toBe('PROPOSED');
    });

    it('transition is conditional on PROPOSED and bumps the version; APPROVED and WITHDRAWN are terminal', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const p = await project(store, a);
      const created = await store.feeProposals.create(input(a, p), at(1));
      const wrong = await store.feeProposals.transition(a.id, created.id, ['APPROVED'], { status: 'WITHDRAWN' }, at(2));
      expect(wrong.kind).toBe('wrong_status');
      const withdrawn = await store.feeProposals.transition(a.id, created.id, ['PROPOSED'], { status: 'WITHDRAWN', withdrawnAt: at(2), withdrawnReason: null }, at(2));
      expect(withdrawn).toMatchObject({ kind: 'updated', record: { status: 'WITHDRAWN', version: 2, updatedAt: at(2) } });
      expect((await store.feeProposals.transition(a.id, created.id, ['PROPOSED'], { status: 'WITHDRAWN' }, at(3))).kind).toBe('wrong_status');
      expect(await store.feeProposals.transition(a.id, '00000000-0000-4000-8000-000000000000', ['PROPOSED'], { status: 'WITHDRAWN' }, at(4))).toEqual({ kind: 'not_found' });
      const other = await org(store, 'B');
      expect(await store.feeProposals.transition(other.id, created.id, ['PROPOSED'], { status: 'WITHDRAWN' }, at(4))).toEqual({ kind: 'not_found' });
    });

    it('agreement creation with feeProposalId approves a PROPOSED proposal atomically (amount, date, link) and refuses any other state or project', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const p = await project(store, a);
      const proposed = await store.feeProposals.create(input(a, p), at(1));
      const { agreement } = await store.agreements.create(agreementInput(a, p, approval(proposed.id, { note: 'By phone' })), at(2));
      const approved = await store.feeProposals.getById(a.id, proposed.id);
      expect(approved).toMatchObject({ status: 'APPROVED', agreementId: agreement.id, agreedAmountMinor: 900_000n, clientApprovedOn: '2026-10-10', clientApprovalNote: 'By phone', version: 2 });
      expect(await store.feeProposals.findOpenByProject(a.id, p.id)).toBeNull();
      // an approved proposal cannot be approved again; nothing is created on refusal
      await expect(store.agreements.create(agreementInput(a, p, approval(proposed.id)), at(3))).rejects.toBeInstanceOf(StateConflict);
      expect((await store.agreements.list(a.id, { projectId: p.id }, { limit: 10, cursor: null })).items).toHaveLength(1);
      // a proposal of another project is refused; a withdrawn one is refused
      const p2 = await project(store, a);
      const other = await store.feeProposals.create(input(a, p2), at(4));
      await expect(store.agreements.create(agreementInput(a, p, approval(other.id)), at(5))).rejects.toBeInstanceOf(StateConflict);
      await store.feeProposals.transition(a.id, other.id, ['PROPOSED'], { status: 'WITHDRAWN', withdrawnAt: at(6) }, at(6));
      await expect(store.agreements.create(agreementInput(a, p2, approval(other.id)), at(7))).rejects.toBeInstanceOf(StateConflict);
      expect((await store.agreements.list(a.id, { projectId: p2.id }, { limit: 10, cursor: null })).items).toEqual([]);
      // without a proposal, creation is untouched
      const plain = await store.agreements.create(agreementInput(a, p2, null), at(8));
      expect(plain.agreement.projectId).toBe(p2.id);
    });

    it('listUnpostedDue returns due DATE installments and unposted IMMEDIATE ones on ACTIVE agreements, never MANUAL, posted, voided or future-dated (D16)', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const p = await project(store, a);
      const { agreement, installments } = await store.agreements.create(
        agreementInput(a, p, null, [
          installment({ position: 1, label: 'Now', amountMinor: 300_000n, netMinor: 300_000n, grossMinor: 300_000n, triggerType: 'IMMEDIATE', dueDateOverride: '2026-10-20' }),
          installment({ position: 2, label: 'Due', amountMinor: 300_000n, netMinor: 300_000n, grossMinor: 300_000n, triggerType: 'DATE', triggerDate: '2026-10-05' }),
          installment({ position: 3, label: 'Later', amountMinor: 150_000n, netMinor: 150_000n, grossMinor: 150_000n, triggerType: 'DATE', triggerDate: '2026-12-01' }),
          installment({ position: 4, label: 'Manual', amountMinor: 150_000n, netMinor: 150_000n, grossMinor: 150_000n, triggerType: 'MANUAL' }),
        ]),
        at(1),
      );
      const byLabel = Object.fromEntries(installments.map((i) => [i.label, i]));
      const due = await store.agreements.listUnpostedDue(a.id, '2026-10-10');
      expect(due.map((i) => i.label).sort()).toEqual(['Due', 'Now']);
      // once the IMMEDIATE one is posted it drops out
      await store.agreements.postInstallment(a.id, byLabel['Now']!.id, { postingDate: '2026-10-10', dueDate: '2026-10-20', at: at(2) });
      expect((await store.agreements.listUnpostedDue(a.id, '2026-10-10')).map((i) => i.label)).toEqual(['Due']);
      // another organization sees nothing
      const b = await org(store, 'B');
      expect(await store.agreements.listUnpostedDue(b.id, '2026-10-10')).toEqual([]);
      expect(agreement.status).toBe('ACTIVE');
    });
  });
}
