import { describe, expect, it } from 'vitest';
import type { CreateAgreementInput, CreateInstallmentInput, LedgerStore, OutcomeWriteInput, Organization } from '../ports.js';

/**
 * MUT-100 storage contract: contingency terms on agreements, the commission
 * installment, and the three writes that move a contingency agreement —
 * `updateContingencyTerms`, `recordOutcome` and `correctOutcome` — each one
 * all-or-nothing under the agreement's version. `correctOutcome` re-checks,
 * inside its own transaction, that the replaced commission is still unpaid and
 * uncredited, and answers `has_payments` (writing nothing) when it is not.
 */
export function describeLedgerStoreMut100Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function project(store: LedgerStore, o: Organization) {
    const customer = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: null }, at(0));
    return store.projects.create({ organizationId: o.id, customerId: customer.id, name: 'Lawsuit', currency: 'ILS', vatTreatment: null }, at(0));
  }

  const upfront = (over: Partial<CreateInstallmentInput> = {}): CreateInstallmentInput => ({
    position: 1,
    label: 'Upfront',
    amountMinor: 150_000n,
    netMinor: 150_000n,
    vatMinor: 27_000n,
    grossMinor: 177_000n,
    vatTreatment: 'STANDARD_RATED',
    rateBasisPoints: 1800,
    triggerType: 'IMMEDIATE',
    triggerDate: null,
    paymentTerms: null,
    dueDateOverride: null,
    ...over,
  });

  const commission = (over: Partial<CreateInstallmentInput> = {}): CreateInstallmentInput => ({
    ...upfront({ position: 2, label: 'Commission', amountMinor: 2_000_000n, netMinor: 2_000_000n, vatMinor: 360_000n, grossMinor: 2_360_000n, triggerType: 'DATE', triggerDate: '2026-10-12' }),
    isCommission: true,
    ...over,
  });

  function agreementInput(o: Organization, p: { id: string; customerId: string }, installments: CreateInstallmentInput[] = [upfront()]): CreateAgreementInput {
    return {
      organizationId: o.id,
      projectId: p.id,
      customerId: p.customerId,
      type: 'CONTINGENCY',
      currency: 'ILS',
      pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'STANDARD_RATED',
      vatRateBasisPoints: 1800,
      amountMinor: 150_000n,
      netMinor: 150_000n,
      vatMinor: 27_000n,
      grossMinor: 177_000n,
      agreementDate: '2026-10-01',
      description: null,
      paymentTerms: 'EOM',
      startMonth: null,
      billingDay: null,
      endMonth: null,
      commissionRateBasisPoints: 2000,
      upfrontTreatment: 'SEPARATE',
      installments,
    };
  }

  const totalsWithCommission = { amountMinor: 2_150_000n, netMinor: 2_150_000n, vatMinor: 387_000n, grossMinor: 2_537_000n };

  const awarded = (expectedVersion: number, over: Partial<OutcomeWriteInput> = {}): OutcomeWriteInput => ({
    outcome: 'AWARDED',
    outcomeDate: '2026-10-12',
    awardedAmountMinor: 10_000_000n,
    outcomeNote: 'Judgment',
    commissionRateBasisPoints: 2000,
    upfrontTreatment: 'SEPARATE',
    commissionInstallment: commission(),
    totals: totalsWithCommission,
    upfrontReceivables: [],
    expectedVersion,
    ...over,
  });

  async function contingency(store: LedgerStore) {
    const o = await org(store);
    const p = await project(store, o);
    const created = await store.agreements.create(agreementInput(o, p), at(1));
    return { o, p, ...created };
  }

  async function recorded(store: LedgerStore) {
    const c = await contingency(store);
    const result = await store.agreements.recordOutcome(c.o.id, c.agreement.id, awarded(c.agreement.version), at(2));
    if (result.kind !== 'updated') throw new Error(`recordOutcome: ${result.kind}`);
    const line = result.record.installments.find((i) => i.isCommission)!;
    const posted = await store.agreements.postInstallment(c.o.id, line.id, { postingDate: '2026-10-12', dueDate: '2026-10-31', at: at(3) });
    return { ...c, agreement: result.record.agreement, line, receivable: posted!.receivable };
  }

  describe(`${name} LedgerStore MUT-100 contract`, () => {
    it('persists contingency terms on create; outcome fields start empty; installments default to not-commission', async () => {
      const store = await makeStore();
      const { o, agreement, installments } = await contingency(store);
      expect(agreement).toMatchObject({ type: 'CONTINGENCY', commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', outcome: null, outcomeDate: null, awardedAmountMinor: null, outcomeNote: null, outcomeRecordedAt: null });
      expect(installments.map((i) => i.isCommission)).toEqual([false]);
      expect(await store.agreements.getById(o.id, agreement.id)).toMatchObject({ commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' });
    });

    it('a FIXED agreement carries no terms', async () => {
      const store = await makeStore();
      const o = await org(store);
      const p = await project(store, o);
      const { commissionRateBasisPoints, upfrontTreatment, ...rest } = agreementInput(o, p);
      void commissionRateBasisPoints;
      void upfrontTreatment;
      const { agreement } = await store.agreements.create({ ...rest, type: 'FIXED' }, at(1));
      expect(agreement).toMatchObject({ type: 'FIXED', commissionRateBasisPoints: null, upfrontTreatment: null, outcome: null });
    });

    it('updateContingencyTerms changes the terms under the version and is stale on a wrong one', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      const stale = await store.agreements.updateContingencyTerms(o.id, agreement.id, agreement.version + 1, { commissionRateBasisPoints: 2500 }, at(2));
      expect(stale.kind).toBe('stale');
      const updated = await store.agreements.updateContingencyTerms(o.id, agreement.id, agreement.version, { commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED' }, at(2));
      expect(updated.kind).toBe('updated');
      if (updated.kind !== 'updated') return;
      expect(updated.record).toMatchObject({ commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED', version: agreement.version + 1 });
      expect((await store.agreements.updateContingencyTerms(o.id, '00000000-0000-4000-8000-000000000000', 1, { commissionRateBasisPoints: 1 }, at(2))).kind).toBe('not_found');
    });

    it('recordOutcome writes the outcome, the commission installment, the totals and the version in one step', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      const result = await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version), at(2));
      expect(result.kind).toBe('updated');
      if (result.kind !== 'updated') return;
      expect(result.record.agreement).toMatchObject({ outcome: 'AWARDED', outcomeDate: '2026-10-12', awardedAmountMinor: 10_000_000n, outcomeNote: 'Judgment', outcomeRecordedAt: at(2), grossMinor: 2_537_000n, version: agreement.version + 1 });
      const line = result.record.installments.find((i) => i.isCommission);
      expect(line).toMatchObject({ position: 2, label: 'Commission', grossMinor: 2_360_000n, triggerType: 'DATE', triggerDate: '2026-10-12', receivableId: null });
      // A crash before posting heals through the lazy path, dated on the outcome date.
      const due = await store.agreements.listUnpostedDue(o.id, '2026-10-13');
      expect(due.map((i) => i.id)).toContain(line!.id);
      expect(due.find((i) => i.id === line!.id)?.isCommission).toBe(true);
    });

    it('recordOutcome with nothing to bill writes the outcome alone', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      const result = await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version, { outcome: 'NO_RECOVERY', awardedAmountMinor: null, commissionInstallment: null, totals: { amountMinor: 150_000n, netMinor: 150_000n, vatMinor: 27_000n, grossMinor: 177_000n } }), at(2));
      expect(result.kind).toBe('updated');
      if (result.kind !== 'updated') return;
      expect(result.record.agreement).toMatchObject({ outcome: 'NO_RECOVERY', awardedAmountMinor: null, grossMinor: 177_000n });
      expect(result.record.installments).toHaveLength(1);
    });

    it('recordOutcome is stale on a wrong version and once an outcome exists, writing nothing', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      expect((await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version + 1), at(2))).kind).toBe('stale');
      expect(await store.agreements.listInstallments(o.id, agreement.id)).toHaveLength(1);
      const first = await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version), at(2));
      expect(first.kind).toBe('updated');
      if (first.kind !== 'updated') return;
      // Same (now current) version, but an outcome is already there.
      const second = await store.agreements.recordOutcome(o.id, agreement.id, awarded(first.record.agreement.version), at(3));
      expect(second.kind).toBe('stale');
      expect(await store.agreements.listInstallments(o.id, agreement.id)).toHaveLength(2);
    });

    it('correctOutcome credits the old commission in full, voids it, and writes the new outcome, terms and line', async () => {
      const store = await makeStore();
      const { o, agreement, line, receivable } = await recorded(store);
      const result = await store.agreements.correctOutcome(
        o.id,
        agreement.id,
        {
          ...awarded(agreement.version, { awardedAmountMinor: 12_000_000n, commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED', commissionInstallment: commission({ position: 3, amountMinor: 2_850_000n, netMinor: 2_850_000n, vatMinor: 513_000n, grossMinor: 3_363_000n }), totals: { amountMinor: 3_000_000n, netMinor: 3_000_000n, vatMinor: 540_000n, grossMinor: 3_540_000n } }),
          replaceInstallmentId: line.id,
          replaceReceivableId: receivable.id,
          credit: { reason: 'Award amended on appeal', effectiveDate: '2026-10-13', requestId: 'req' },
        },
        at(4),
      );
      expect(result.kind).toBe('updated');
      if (result.kind !== 'updated') return;
      expect(result.record.agreement).toMatchObject({ awardedAmountMinor: 12_000_000n, commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED', grossMinor: 3_540_000n, version: agreement.version + 1, outcomeRecordedAt: at(4) });
      expect(result.record.credit).toMatchObject({ receivableId: receivable.id, amountMinor: 2_360_000n, netMinor: 2_000_000n, vatMinor: 360_000n, reason: 'Award amended on appeal', effectiveDate: '2026-10-13' });
      const old = result.record.installments.find((i) => i.id === line.id)!;
      expect(old.voidedAt).toEqual(at(4));
      expect(result.record.installments.filter((i) => i.isCommission && !i.voidedAt).map((i) => i.grossMinor)).toEqual([3_363_000n]);
      expect(await store.receivables.getById(o.id, receivable.id)).toMatchObject({ creditedMinor: 2_360_000n, status: 'SETTLED' });
    });

    it('correctOutcome from an outcome that billed nothing writes no credit', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      const first = await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version, { outcome: 'NO_RECOVERY', awardedAmountMinor: null, commissionInstallment: null, totals: { amountMinor: 150_000n, netMinor: 150_000n, vatMinor: 27_000n, grossMinor: 177_000n } }), at(2));
      if (first.kind !== 'updated') throw new Error(first.kind);
      const result = await store.agreements.correctOutcome(o.id, agreement.id, { ...awarded(first.record.agreement.version), replaceInstallmentId: null, replaceReceivableId: null, credit: { reason: 'Settled after all', effectiveDate: '2026-10-13', requestId: null } }, at(3));
      expect(result.kind).toBe('updated');
      if (result.kind !== 'updated') return;
      expect(result.record.credit).toBeNull();
      expect(result.record.agreement).toMatchObject({ outcome: 'AWARDED', awardedAmountMinor: 10_000_000n });
    });

    it('correctOutcome is all-or-nothing: stale on a wrong version, has_payments when the commission gained a payment, nothing written', async () => {
      const store = await makeStore();
      const { o, p, agreement, line, receivable } = await recorded(store);
      const input = { ...awarded(agreement.version, { commissionInstallment: commission({ position: 3 }) }), replaceInstallmentId: line.id, replaceReceivableId: receivable.id, credit: { reason: 'Fix', effectiveDate: '2026-10-13', requestId: null } };

      expect((await store.agreements.correctOutcome(o.id, agreement.id, { ...input, expectedVersion: agreement.version + 1 }, at(4))).kind).toBe('stale');

      // A payment allocated after the preview: the in-transaction guard refuses.
      await store.payments.create({ organizationId: o.id, customerId: p.customerId, projectId: p.id, currency: 'ILS', amountMinor: 100_000n, receivedOn: '2026-10-13', method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: receivable.id, amountMinor: 100_000n }] }, at(4));
      const refused = await store.agreements.correctOutcome(o.id, agreement.id, input, at(5));
      expect(refused).toEqual({ kind: 'has_payments', receivableId: receivable.id });

      const after = await store.agreements.getById(o.id, agreement.id);
      expect(after).toMatchObject({ version: agreement.version, awardedAmountMinor: 10_000_000n });
      expect(await store.receivables.listCredits(o.id, receivable.id)).toEqual([]);
      const lines = await store.agreements.listInstallments(o.id, agreement.id);
      expect(lines.map((i) => [i.position, i.voidedAt])).toEqual([[1, null], [2, null]]);
    });

    it('updateContingencyTerms is stale once an outcome exists, even at the current version', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      const first = await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version), at(2));
      if (first.kind !== 'updated') throw new Error(first.kind);
      expect((await store.agreements.updateContingencyTerms(o.id, agreement.id, first.record.agreement.version, { commissionRateBasisPoints: 2500 }, at(3))).kind).toBe('stale');
      expect(await store.agreements.getById(o.id, agreement.id)).toMatchObject({ commissionRateBasisPoints: 2000, version: first.record.agreement.version });
    });

    it('postInstallment never posts a voided line', async () => {
      const store = await makeStore();
      const o = await org(store);
      const p = await project(store, o);
      const { agreement, installments } = await store.agreements.create(agreementInput(o, p, [upfront({ triggerType: 'MANUAL' })]), at(1));
      await store.agreements.cancel(o.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, at(2));
      expect(await store.agreements.postInstallment(o.id, installments[0]!.id, { postingDate: '2026-10-13', dueDate: '2026-10-31', at: at(3) })).toBeNull();
      expect((await store.agreements.getInstallment(o.id, installments[0]!.id))?.receivableId).toBeNull();
      expect((await store.receivables.list(o.id, { projectId: p.id }, { limit: 10, cursor: null })).items).toEqual([]);
    });

    it('cancel leaves an agreement with a recorded outcome ACTIVE and its lines alone', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      const first = await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version), at(2));
      if (first.kind !== 'updated') throw new Error(first.kind);
      const after = await store.agreements.cancel(o.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, at(3));
      expect(after).toMatchObject({ status: 'ACTIVE', outcome: 'AWARDED', version: first.record.agreement.version });
      expect((await store.agreements.listInstallments(o.id, agreement.id)).map((i) => i.voidedAt)).toEqual([null, null]);
    });

    it('recordOutcome and correctOutcome are stale when an upfront receivable moved after the figures were computed (D2)', async () => {
      const store = await makeStore();
      const { o, agreement, installments } = await contingency(store);
      const posted = await store.agreements.postInstallment(o.id, installments[0]!.id, { postingDate: '2026-10-13', dueDate: '2026-10-31', at: at(2) });
      const seen = [{ id: posted!.receivable.id, version: posted!.receivable.version }];
      await store.receivables.credit(o.id, posted!.receivable.id, { amountMinor: 11_800n, netMinor: 10_000n, vatMinor: 1_800n, reason: 'Goodwill', effectiveDate: '2026-10-13', requestId: null }, at(3));
      expect((await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version, { upfrontReceivables: seen }), at(4))).kind).toBe('stale');
      expect(await store.agreements.getById(o.id, agreement.id)).toMatchObject({ outcome: null, version: agreement.version });
      expect(await store.agreements.listInstallments(o.id, agreement.id)).toHaveLength(1);

      const fresh = (await store.receivables.getById(o.id, posted!.receivable.id))!;
      const first = await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version, { upfrontReceivables: [{ id: fresh.id, version: fresh.version }] }), at(5));
      expect(first.kind).toBe('updated');
      if (first.kind !== 'updated') return;
      await store.receivables.credit(o.id, fresh.id, { amountMinor: 100n, netMinor: 85n, vatMinor: 15n, reason: 'More', effectiveDate: '2026-10-13', requestId: null }, at(6));
      const line = first.record.installments.find((i) => i.isCommission)!;
      const correction = await store.agreements.correctOutcome(o.id, agreement.id, { ...awarded(first.record.agreement.version, { upfrontReceivables: [{ id: fresh.id, version: fresh.version }], commissionInstallment: commission({ position: 3 }) }), replaceInstallmentId: line.id, replaceReceivableId: null, credit: { reason: 'Fix', effectiveDate: '2026-10-13', requestId: null } }, at(7));
      expect(correction.kind).toBe('stale');
      expect((await store.agreements.listInstallments(o.id, agreement.id)).find((i) => i.id === line.id)?.voidedAt).toBeNull();
    });

    it('correctOutcome is refused when the commission was credited (not paid), writing nothing', async () => {
      const store = await makeStore();
      const { o, agreement, line, receivable } = await recorded(store);
      await store.receivables.credit(o.id, receivable.id, { amountMinor: 10_000n, netMinor: 8_475n, vatMinor: 1_525n, reason: 'Goodwill', effectiveDate: '2026-10-13', requestId: null }, at(4));
      const refused = await store.agreements.correctOutcome(o.id, agreement.id, { ...awarded(agreement.version, { commissionInstallment: commission({ position: 3 }) }), replaceInstallmentId: line.id, replaceReceivableId: receivable.id, credit: { reason: 'Fix', effectiveDate: '2026-10-13', requestId: null } }, at(5));
      expect(refused).toEqual({ kind: 'has_payments', receivableId: receivable.id });
      expect(await store.receivables.listCredits(o.id, receivable.id)).toHaveLength(1);
    });

    it('correctOutcome is stale, never a throw, when the line it replaces is already voided', async () => {
      const store = await makeStore();
      const { o, agreement, line, receivable } = await recorded(store);
      const input = { ...awarded(agreement.version, { commissionInstallment: commission({ position: 3 }) }), replaceInstallmentId: line.id, replaceReceivableId: receivable.id, credit: { reason: 'Fix', effectiveDate: '2026-10-13', requestId: null } };
      expect((await store.agreements.correctOutcome(o.id, agreement.id, input, at(4))).kind).toBe('updated');
      const after = (await store.agreements.getById(o.id, agreement.id))!;
      const again = await store.agreements.correctOutcome(o.id, agreement.id, { ...input, expectedVersion: after.version, commissionInstallment: commission({ position: 4 }) }, at(5));
      expect(again.kind).toBe('stale');
    });

    it('correctOutcome is stale when the replaced line posted after the bill was composed (the preview said no credit)', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      const first = await store.agreements.recordOutcome(o.id, agreement.id, awarded(agreement.version), at(2));
      if (first.kind !== 'updated') throw new Error(first.kind);
      const line = first.record.installments.find((i) => i.isCommission)!;
      const posted = await store.agreements.postInstallment(o.id, line.id, { postingDate: '2026-10-12', dueDate: '2026-10-31', at: at(3) });
      const result = await store.agreements.correctOutcome(o.id, agreement.id, { ...awarded(first.record.agreement.version, { commissionInstallment: commission({ position: 3 }) }), replaceInstallmentId: line.id, replaceReceivableId: null, credit: { reason: 'Fix', effectiveDate: '2026-10-13', requestId: null } }, at(4));
      expect(result.kind).toBe('stale');
      expect(await store.receivables.listCredits(o.id, posted!.receivable.id)).toEqual([]);
    });

    it('two corrections racing on one version: one wins, the other is stale, one credit', async () => {
      const store = await makeStore();
      const { o, agreement, line, receivable } = await recorded(store);
      const input = (position: number) => ({ ...awarded(agreement.version, { commissionInstallment: commission({ position }) }), replaceInstallmentId: line.id, replaceReceivableId: receivable.id, credit: { reason: 'Fix', effectiveDate: '2026-10-13', requestId: null } });
      const results = await Promise.allSettled([store.agreements.correctOutcome(o.id, agreement.id, input(3), at(4)), store.agreements.correctOutcome(o.id, agreement.id, input(4), at(5))]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      const kinds = results.map((r) => (r as PromiseFulfilledResult<{ kind: string }>).value.kind).sort();
      expect(kinds).toEqual(['stale', 'updated']);
      expect(await store.receivables.listCredits(o.id, receivable.id)).toHaveLength(1);
      expect((await store.agreements.listInstallments(o.id, agreement.id)).filter((i) => i.isCommission && !i.voidedAt)).toHaveLength(1);
    });

    it('correctOutcome is stale when no outcome has been recorded', async () => {
      const store = await makeStore();
      const { o, agreement } = await contingency(store);
      const result = await store.agreements.correctOutcome(o.id, agreement.id, { ...awarded(agreement.version), replaceInstallmentId: null, replaceReceivableId: null, credit: { reason: 'x', effectiveDate: '2026-10-13', requestId: null } }, at(2));
      expect(result.kind).toBe('stale');
    });
  });
}
