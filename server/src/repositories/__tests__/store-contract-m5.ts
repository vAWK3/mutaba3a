import { describe, expect, it } from 'vitest';
import type { AppendVersionInput, CreateAgreementInput, LedgerStore, Organization } from '../ports.js';
import { UniqueViolation } from '../memory.js';

/** Milestone 5 storage contract: retainer versions, charge versions, cancellation date + PRORATE, organization listing. */
export function describeLedgerStoreM5Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function retainer(store: LedgerStore, organizationId: string) {
    const c = await store.customers.create({ organizationId, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: null }, at(0));
    const p = await store.projects.create({ organizationId, customerId: c.id, name: 'Case', currency: 'ILS' }, at(1));
    const input: CreateAgreementInput = { organizationId, projectId: p.id, customerId: c.id, type: 'RECURRING', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1800, amountMinor: 200000n, netMinor: 200000n, vatMinor: 36000n, grossMinor: 236000n, agreementDate: '2026-10-08', description: null, paymentTerms: 'EOM_30', startMonth: '2026-10', billingDay: 1, endMonth: null, installments: [] };
    const { agreement } = await store.agreements.create(input, at(2));
    return { c, p, agreement };
  }

  const versionInput = (organizationId: string, agreementId: string, version: number, expectedAgreementVersion: number, over: Partial<AppendVersionInput> = {}): AppendVersionInput => ({
    organizationId,
    agreementId,
    version,
    effectiveMonth: '2027-01',
    monthlyAmountMinor: 250000n,
    netMinor: 250000n,
    vatMinor: 45000n,
    grossMinor: 295000n,
    pricingBasis: 'VAT_EXCLUSIVE',
    vatTreatment: 'STANDARD_RATED',
    rateBasisPoints: 1800,
    billingDay: 1,
    paymentTerms: 'EOM_30',
    endMonth: null,
    reason: 'annual review',
    requestId: 'req-1',
    expectedAgreementVersion,
    ...over,
  });

  describe(`${name} LedgerStore M5 contract`, () => {
    it('appends versions with an optimistic check on the agreement, unique per (agreement, version), listed in order, organization-scoped', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { agreement } = await retainer(store, a.id);
      expect(await store.agreements.listVersions(a.id, agreement.id)).toEqual([]);
      const first = await store.agreements.appendVersion(versionInput(a.id, agreement.id, 2, agreement.version), at(10));
      expect(first.kind).toBe('updated');
      if (first.kind !== 'updated') return;
      expect(first.record.version).toMatchObject({ version: 2, effectiveMonth: '2027-01', monthlyAmountMinor: 250000n, grossMinor: 295000n, reason: 'annual review', createdAt: at(10) });
      expect(first.record.agreement.version).toBe(agreement.version + 1);
      expect(first.record.agreement.amountMinor).toBe(200000n); // the row keeps the original terms
      const stale = await store.agreements.appendVersion(versionInput(a.id, agreement.id, 3, agreement.version, { effectiveMonth: '2027-04' }), at(11));
      expect(stale.kind).toBe('stale');
      await expect(store.agreements.appendVersion(versionInput(a.id, agreement.id, 2, first.record.agreement.version, { effectiveMonth: '2027-04' }), at(12))).rejects.toBeInstanceOf(UniqueViolation);
      const third = await store.agreements.appendVersion(versionInput(a.id, agreement.id, 3, first.record.agreement.version, { effectiveMonth: '2027-04', monthlyAmountMinor: 300000n }), at(13));
      expect(third.kind).toBe('updated');
      expect((await store.agreements.listVersions(a.id, agreement.id)).map((v) => [v.version, v.effectiveMonth, v.monthlyAmountMinor])).toEqual([
        [2, '2027-01', 250000n],
        [3, '2027-04', 300000n],
      ]);
      const other = await org(store, 'B');
      expect(await store.agreements.listVersions(other.id, agreement.id)).toEqual([]);
      expect((await store.agreements.appendVersion(versionInput(other.id, agreement.id, 4, 1), at(14))).kind).toBe('not_found');
      expect((await store.agreements.appendVersion(versionInput(a.id, '00000000-0000-4000-8000-000000000000', 2, 1), at(15))).kind).toBe('not_found');
    });

    it('stores the charge’s terms version and the cancellation date with PRORATE', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p, agreement } = await retainer(store, a.id);
      const base = { organizationId: a.id, agreementId: agreement.id, customerId: c.id, projectId: p.id, currency: 'ILS', amountMinor: 200000n, netMinor: 200000n, vatMinor: 36000n, grossMinor: 236000n, vatTreatment: 'STANDARD_RATED' as const, rateBasisPoints: 1800 };
      const v1 = await store.agreements.createPostedCharge({ ...base, serviceMonth: '2026-10', chargeDate: '2026-10-01', dueDate: '2026-11-30' }, at(3));
      const v2 = await store.agreements.createPostedCharge({ ...base, serviceMonth: '2026-11', chargeDate: '2026-11-01', dueDate: '2026-12-31', version: 2 }, at(4));
      expect(v1.charge.version).toBe(1);
      expect(v2.charge.version).toBe(2);
      expect((await store.agreements.listCharges(a.id, agreement.id)).map((ch) => ch.version)).toEqual([1, 2]);
      const cancelled = await store.agreements.cancel(a.id, agreement.id, { cancelEffectiveMonth: '2026-11', cancelEffectiveDate: '2026-11-18', finalMonth: 'PRORATE' }, at(5));
      expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelEffectiveMonth: '2026-11', cancelEffectiveDate: '2026-11-18', finalMonth: 'PRORATE' });
      expect((await store.agreements.getById(a.id, agreement.id))!.cancelEffectiveDate).toBe('2026-11-18');
      // the M3 form (no date) still works
      const { agreement: second } = await retainer(store, a.id);
      expect(await store.agreements.cancel(a.id, second.id, { cancelEffectiveMonth: '2026-12', finalMonth: 'FULL' }, at(6))).toMatchObject({ cancelEffectiveDate: null, finalMonth: 'FULL' });
    });

    it('lists organizations oldest first', async () => {
      const store = await makeStore();
      const a = await org(store, `Za${unique()}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const b = await org(store, `Zb${unique()}`);
      const ids = (await store.organizations.list()).map((o) => o.id);
      expect(ids.indexOf(a.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    });
  });
}
