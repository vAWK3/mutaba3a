import { describe, expect, it } from 'vitest';
import type { CreateAgreementInput, CreateInstallmentInput, LedgerStore, Organization } from '../ports.js';

/** Milestone 3 storage contract: VAT rates, agreements, installments, posting, supplements, charges, receivables. */
export function describeLedgerStoreM3Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function project(store: LedgerStore, organizationId: string) {
    const c = await store.customers.create({ organizationId, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: 'OUT_OF_SCOPE' }, at(0));
    const p = await store.projects.create({ organizationId, customerId: c.id, name: 'Case', currency: 'ILS' }, at(1));
    return { c, p };
  }

  const inst = (position: number, amount: bigint, trigger: CreateInstallmentInput['triggerType'] = 'IMMEDIATE', triggerDate: string | null = null): CreateInstallmentInput => ({
    position,
    label: `I${position}`,
    amountMinor: amount,
    netMinor: amount,
    vatMinor: (amount * 18n) / 100n,
    grossMinor: amount + (amount * 18n) / 100n,
    vatTreatment: 'STANDARD_RATED',
    rateBasisPoints: 1800,
    triggerType: trigger,
    triggerDate,
    paymentTerms: null,
    dueDateOverride: null,
  });

  function agreementInput(organizationId: string, projectId: string, customerId: string, installments: CreateInstallmentInput[]): CreateAgreementInput {
    const amount = installments.reduce((a, i) => a + i.amountMinor, 0n);
    return {
      organizationId,
      projectId,
      customerId,
      type: 'FIXED',
      currency: 'ILS',
      pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'STANDARD_RATED',
      vatRateBasisPoints: 1800,
      amountMinor: amount,
      netMinor: amount,
      vatMinor: (amount * 18n) / 100n,
      grossMinor: amount + (amount * 18n) / 100n,
      agreementDate: '2026-10-08',
      description: null,
      paymentTerms: 'EOM',
      startMonth: null,
      billingDay: null,
      endMonth: null,
      installments,
    };
  }

  describe(`${name} LedgerStore M3 contract`, () => {
    it('stores effective-dated VAT rates per organization, append-only, and resolves the rate on a date', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      expect((await store.vatRates.upsert(a.id, 1700, '2024-01-01', at(0))).outcome).toBe('created');
      expect((await store.vatRates.upsert(a.id, 1800, '2025-01-01', at(1))).outcome).toBe('created');
      expect((await store.vatRates.upsert(a.id, 1800, '2025-01-01', at(2))).outcome).toBe('unchanged');
      expect((await store.vatRates.upsert(a.id, 1750, '2025-01-01', at(3))).outcome).toBe('conflict');
      expect((await store.vatRates.list(a.id)).map((r) => r.effectiveFrom)).toEqual(['2025-01-01', '2024-01-01']);
      expect((await store.vatRates.effectiveOn(a.id, '2024-06-30'))?.rateBasisPoints).toBe(1700);
      expect((await store.vatRates.effectiveOn(a.id, '2025-01-01'))?.rateBasisPoints).toBe(1800);
      expect(await store.vatRates.effectiveOn(a.id, '2023-12-31')).toBeNull();
      expect(await store.vatRates.effectiveOn(b.id, '2026-01-01')).toBeNull();
    });

    it('creates an agreement with its installments atomically and round-trips BigInt amounts', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p } = await project(store, a.id);
      const big = 9_007_199_254_740_993n; // > 2^53
      const { agreement, installments } = await store.agreements.create(agreementInput(a.id, p.id, c.id, [inst(1, big), inst(2, 100n, 'DATE', '2026-11-01')]), at(2));
      expect(agreement).toMatchObject({ status: 'ACTIVE', version: 1, amountMinor: big + 100n });
      expect(installments.map((i) => [i.position, i.amountMinor, i.receivableId])).toEqual([
        [1, big, null],
        [2, 100n, null],
      ]);
      expect(await store.projects.hasPostedActivity(a.id, p.id)).toBe(true);
      expect(await store.agreements.getById(a.id, agreement.id)).toMatchObject({ id: agreement.id });
      const other = await org(store, 'B');
      expect(await store.agreements.getById(other.id, agreement.id)).toBeNull();
      // a duplicate position rolls the whole agreement back
      await expect(store.agreements.create(agreementInput(a.id, p.id, c.id, [inst(1, 1n), inst(1, 1n)]), at(3))).rejects.toBeDefined();
      expect((await store.agreements.list(a.id, {}, { limit: 10, cursor: null })).items).toHaveLength(1);
    });

    it('posts an installment once: the receivable is created, the second post returns it unchanged', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p } = await project(store, a.id);
      const { installments } = await store.agreements.create(agreementInput(a.id, p.id, c.id, [inst(1, 1000n)]), at(0));
      const first = await store.agreements.postInstallment(a.id, installments[0]!.id, { postingDate: '2026-10-08', dueDate: '2026-10-31', at: at(1) });
      expect(first?.created).toBe(true);
      expect(first?.receivable).toMatchObject({ origin: 'INSTALLMENT', originId: installments[0]!.id, grossMinor: 1180n, paidMinor: 0n, status: 'OPEN', dueDate: '2026-10-31', customerId: c.id, projectId: p.id });
      expect(first?.installment).toMatchObject({ receivableId: first?.receivable.id, postingDate: '2026-10-08', version: 2 });
      const second = await store.agreements.postInstallment(a.id, installments[0]!.id, { postingDate: '2026-10-09', dueDate: '2026-11-30', at: at(2) });
      expect(second?.created).toBe(false);
      expect(second?.receivable.id).toBe(first?.receivable.id);
      expect((await store.receivables.list(a.id, {}, { limit: 10, cursor: null })).items).toHaveLength(1);
      expect(await store.agreements.postInstallment(a.id, '00000000-0000-4000-8000-000000000000', { postingDate: '2026-10-08', dueDate: '2026-10-31', at: at(3) })).toBeNull();
    });

    it('lists DATE installments that are due and unposted on ACTIVE agreements only', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p } = await project(store, a.id);
      const { agreement, installments } = await store.agreements.create(
        agreementInput(a.id, p.id, c.id, [inst(1, 100n, 'DATE', '2026-10-01'), inst(2, 100n, 'DATE', '2026-12-01'), inst(3, 100n, 'MANUAL')]),
        at(0),
      );
      expect((await store.agreements.listUnpostedDue(a.id, '2026-10-08')).map((i) => i.position)).toEqual([1]);
      await store.agreements.postInstallment(a.id, installments[0]!.id, { postingDate: '2026-10-08', dueDate: '2026-10-31', at: at(1) });
      expect(await store.agreements.listUnpostedDue(a.id, '2026-10-08')).toEqual([]);
      expect((await store.agreements.listUnpostedDue(a.id, '2026-12-01')).map((i) => i.position)).toEqual([2]);
      await store.agreements.cancel(a.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, at(2));
      expect(await store.agreements.listUnpostedDue(a.id, '2026-12-01')).toEqual([]);
    });

    it('applies a supplement atomically with a version check; cancel voids unposted installments and is idempotent', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p } = await project(store, a.id);
      const { agreement, installments } = await store.agreements.create(agreementInput(a.id, p.id, c.id, [inst(1, 500n), inst(2, 500n, 'MANUAL')]), at(0));
      const stale = await store.agreements.applySupplement(a.id, agreement.id, { supplement: { amountMinor: 100n, description: null, effectiveDate: '2026-10-08', distribution: 'LAST_UNPOSTED', requestId: null }, installmentUpdates: [], newInstallments: [], totals: { amountMinor: 1100n, netMinor: 1100n, vatMinor: 198n, grossMinor: 1298n }, expectedVersion: 7 }, at(1));
      expect(stale.kind).toBe('stale');
      const ok = await store.agreements.applySupplement(
        a.id,
        agreement.id,
        {
          supplement: { amountMinor: 100n, description: 'extra', effectiveDate: '2026-10-08', distribution: 'LAST_UNPOSTED', requestId: 'req-1' },
          installmentUpdates: [{ id: installments[1]!.id, amountMinor: 600n, netMinor: 600n, vatMinor: 108n, grossMinor: 708n }],
          newInstallments: [inst(3, 1n)],
          totals: { amountMinor: 1101n, netMinor: 1101n, vatMinor: 198n, grossMinor: 1299n },
          expectedVersion: 1,
        },
        at(2),
      );
      expect(ok.kind).toBe('updated');
      if (ok.kind !== 'updated') return;
      expect(ok.record.agreement).toMatchObject({ amountMinor: 1101n, version: 2 });
      expect(ok.record.supplement).toMatchObject({ amountMinor: 100n, resultingAmountMinor: 1101n, requestId: 'req-1' });
      expect(ok.record.installments.map((i) => [i.position, i.amountMinor])).toEqual([
        [1, 500n],
        [2, 600n],
        [3, 1n],
      ]);
      expect(await store.agreements.listSupplements(a.id, agreement.id)).toHaveLength(1);

      await store.agreements.postInstallment(a.id, installments[0]!.id, { postingDate: '2026-10-08', dueDate: '2026-10-31', at: at(3) });
      const cancelled = await store.agreements.cancel(a.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, at(4));
      expect(cancelled).toMatchObject({ status: 'CANCELLED', version: 3 });
      const after = await store.agreements.listInstallments(a.id, agreement.id);
      expect(after.map((i) => [i.position, i.voidedAt !== null])).toEqual([
        [1, false],
        [2, true],
        [3, true],
      ]);
      const again = await store.agreements.cancel(a.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, at(5));
      expect(again?.version).toBe(3);
    });

    it('creates posted retainer charges unique per (agreement, month) and lists retainers that may still charge', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p } = await project(store, a.id);
      const { agreement } = await store.agreements.create({ ...agreementInput(a.id, p.id, c.id, []), type: 'RECURRING', startMonth: '2026-08', billingDay: 1 }, at(0));
      const charge = { organizationId: a.id, agreementId: agreement.id, customerId: c.id, projectId: p.id, currency: 'ILS', serviceMonth: '2026-08', chargeDate: '2026-08-01', amountMinor: 1000n, netMinor: 1000n, vatMinor: 180n, grossMinor: 1180n, vatTreatment: 'STANDARD_RATED' as const, rateBasisPoints: 1800, dueDate: '2026-08-31' };
      const first = await store.agreements.createPostedCharge(charge, at(1));
      expect(first.created).toBe(true);
      expect(first.receivable).toMatchObject({ origin: 'RETAINER_CHARGE', originId: first.charge.id, grossMinor: 1180n, dueDate: '2026-08-31' });
      const dup = await store.agreements.createPostedCharge(charge, at(2));
      expect(dup.created).toBe(false);
      expect(dup.charge.id).toBe(first.charge.id);
      expect((await store.agreements.listCharges(a.id, agreement.id)).map((x) => x.serviceMonth)).toEqual(['2026-08']);
      expect((await store.receivables.list(a.id, { projectId: p.id }, { limit: 10, cursor: null })).items).toHaveLength(1);
      expect((await store.agreements.listRetainers(a.id)).map((r) => r.id)).toEqual([agreement.id]);
      await store.agreements.cancel(a.id, agreement.id, { cancelEffectiveMonth: '2026-12', finalMonth: 'FULL' }, at(3));
      expect((await store.agreements.listRetainers(a.id)).map((r) => r.id)).toEqual([agreement.id]);
      const fixed = await store.agreements.create(agreementInput(a.id, p.id, c.id, [inst(1, 1n)]), at(4));
      await store.agreements.cancel(a.id, fixed.agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, at(5));
      expect((await store.agreements.listRetainers(a.id)).map((r) => r.id)).toEqual([agreement.id]);
    });

    it('filters receivables by customer, project, currency and due range; counts outstanding per project', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p } = await project(store, a.id);
      const { installments } = await store.agreements.create(agreementInput(a.id, p.id, c.id, [inst(1, 100n), inst(2, 200n), inst(3, 300n)]), at(0));
      await store.agreements.postInstallment(a.id, installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-31', at: at(1) });
      await store.agreements.postInstallment(a.id, installments[1]!.id, { postingDate: '2026-10-01', dueDate: '2026-11-30', at: at(2) });
      const list = (f: Parameters<typeof store.receivables.list>[1]) => store.receivables.list(a.id, f, { limit: 10, cursor: null }).then((r) => r.items.map((x) => x.grossMinor));
      expect(await list({})).toEqual([118n, 236n]);
      expect(await list({ customerId: c.id, projectId: p.id, currency: 'ILS' })).toEqual([118n, 236n]);
      expect(await list({ currency: 'USD' })).toEqual([]);
      expect(await list({ dueBefore: '2026-10-31' })).toEqual([118n]);
      expect(await list({ dueAfter: '2026-11-01' })).toEqual([236n]);
      expect(await store.receivables.countOutstandingByProject(a.id, p.id)).toBe(2);
      const other = await org(store, 'B');
      expect(await store.receivables.countOutstandingByProject(other.id, p.id)).toBe(0);
      const one = (await store.receivables.list(a.id, {}, { limit: 1, cursor: null })).items[0]!;
      expect(await store.receivables.getById(a.id, one.id)).toMatchObject({ id: one.id });
      expect(await store.receivables.getById(other.id, one.id)).toBeNull();
    });
  });
}
