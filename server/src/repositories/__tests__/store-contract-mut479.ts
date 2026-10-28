import { describe, expect, it } from 'vitest';
import type { CreateAgreementInput, CreateFeeProposalInput, JsonObject, LedgerStore, Organization } from '../ports.js';
import { StateConflict } from '../memory.js';

/**
 * MUT-479 storage contract: a fee proposal stores its draft agreement (JSON, read back as written and never shared
 * with the caller) and its agreement type; a retainer created with `approveProposal` approves it in the same
 * transaction, and two approvals racing make one agreement.
 */
export function describeLedgerStoreMut479Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 28, 12, 0, 0, ms));
  const DRAFT: JsonObject = { schemaVersion: 1, kind: 'RETAINER', monthlyAmount: '1500.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2026-11', billingDay: 1, paymentTerms: 'EOM', description: 'Monthly advice' };

  async function firm(store: LedgerStore) {
    const o: Organization = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const customer = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: null }, at(0));
    const project = await store.projects.create({ organizationId: o.id, customerId: customer.id, name: 'Advice', currency: 'ILS', vatTreatment: null }, at(0));
    const propose = (over: Partial<CreateFeeProposalInput> = {}) =>
      store.feeProposals.create({ organizationId: o.id, projectId: project.id, customerId: customer.id, currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', proposedAmountMinor: 150_000n, proposedOn: '2026-10-28', note: null, requestId: null, agreementType: 'RECURRING', draft: DRAFT, ...over }, at(1));
    const retainer = (proposalId: string): CreateAgreementInput => ({
      organizationId: o.id,
      projectId: project.id,
      customerId: customer.id,
      type: 'RECURRING',
      currency: 'ILS',
      pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'STANDARD_RATED',
      vatRateBasisPoints: 1800,
      amountMinor: 150_000n,
      netMinor: 150_000n,
      vatMinor: 27_000n,
      grossMinor: 177_000n,
      agreementDate: '2026-10-28',
      description: null,
      paymentTerms: 'EOM',
      startMonth: '2026-11',
      billingDay: 1,
      endMonth: null,
      installments: [],
      approveProposal: { id: proposalId, agreedAmountMinor: 150_000n, approvedOn: '2026-10-28', note: null },
    });
    return { o, propose, retainer };
  }

  describe(`${name} LedgerStore MUT-479 contract`, () => {
    it('stores the draft and the agreement type, and reads them back through get, list and the open lookup', async () => {
      const store = await makeStore();
      const { o, propose } = await firm(store);
      const p = await propose();
      expect(p).toMatchObject({ agreementType: 'RECURRING', draft: DRAFT });
      expect(await store.feeProposals.getById(o.id, p.id)).toMatchObject({ agreementType: 'RECURRING', draft: DRAFT });
      expect((await store.feeProposals.list(o.id, {}, { limit: 10, cursor: null })).items[0]).toMatchObject({ draft: DRAFT });
      expect(await store.feeProposals.findOpenByProject(o.id, p.projectId)).toMatchObject({ draft: DRAFT });
    });

    it('a proposal without a draft reads back null, with the type it was given', async () => {
      const store = await makeStore();
      const { o, propose } = await firm(store);
      const p = await propose({ agreementType: 'CONTINGENCY', draft: null, commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED', proposedAmountMinor: 0n });
      expect(await store.feeProposals.getById(o.id, p.id)).toMatchObject({ agreementType: 'CONTINGENCY', draft: null, commissionRateBasisPoints: 2000 });
    });

    it('never hands out the stored draft itself: changing what was read changes nothing stored', async () => {
      const store = await makeStore();
      const { o, propose } = await firm(store);
      const p = await propose();
      (p.draft as JsonObject).monthlyAmount = '1.00';
      const read = await store.feeProposals.getById(o.id, p.id);
      (read!.draft as JsonObject).monthlyAmount = '2.00';
      expect((await store.feeProposals.getById(o.id, p.id))!.draft).toEqual(DRAFT);
    });

    it('a retainer created with approveProposal approves the proposal in the same write', async () => {
      const store = await makeStore();
      const { o, propose, retainer } = await firm(store);
      const p = await propose();
      const created = await store.agreements.create(retainer(p.id), at(2));
      expect(created.agreement).toMatchObject({ type: 'RECURRING', startMonth: '2026-11' });
      expect(await store.feeProposals.getById(o.id, p.id)).toMatchObject({ status: 'APPROVED', agreementId: created.agreement.id, agreedAmountMinor: 150_000n, version: 2, draft: DRAFT });
    });

    it('two approvals racing make one agreement; the other is refused whole with StateConflict', async () => {
      const store = await makeStore();
      const { o, propose, retainer } = await firm(store);
      const p = await propose();
      const results = await Promise.allSettled([store.agreements.create(retainer(p.id), at(2)), store.agreements.create(retainer(p.id), at(3))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(StateConflict);
      expect((await store.agreements.list(o.id, { projectId: p.projectId }, { limit: 10, cursor: null })).items).toHaveLength(1);
    });
  });
}
