import { describe, expect, it } from 'vitest';
import type { CreateInstallmentInput, InstallmentRecord, LedgerStore, Organization, ReduceAgreementInput } from '../ports.js';

/**
 * MUT-480 storage contract: lowering a fixed fee in one write, and the posting guard (E1) that keeps a lazy post from
 * billing an amount a reduction changed since it was read.
 */
export function describeLedgerStoreMut480Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 28, 10, 0, 0, ms));
  const org = (store: LedgerStore): Promise<Organization> => store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const inst = (position: number, amount: bigint, trigger: 'MANUAL' | 'IMMEDIATE' = 'MANUAL'): CreateInstallmentInput => ({ position, label: `I${position}`, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: trigger, triggerDate: null, paymentTerms: null, dueDateOverride: null });

  /** A ₪3,000 fixed fee in three ₪1,000 lines; the first is posted. */
  async function threeLines(store: LedgerStore) {
    const o = await org(store);
    const c = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null }, at(0));
    const p = await store.projects.create({ organizationId: o.id, customerId: c.id, name: 'Sale', currency: 'ILS' }, at(1));
    const { agreement, installments } = await store.agreements.create({ organizationId: o.id, projectId: p.id, customerId: c.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 300_000n, netMinor: 300_000n, vatMinor: 0n, grossMinor: 300_000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments: [inst(1, 100_000n), inst(2, 100_000n), inst(3, 100_000n)] }, at(2));
    const posted = (await store.agreements.postInstallment(o.id, installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-31', at: at(3) }))!;
    return { o, c, agreement, posted, installments: await store.agreements.listInstallments(o.id, agreement.id) };
  }

  const lowered = (i: InstallmentRecord, amount: bigint) => ({ id: i.id, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, expectedVersion: i.version });
  const credit = { reason: 'Goodwill', reasonCode: 'GOODWILL' as const, effectiveDate: '2026-10-28', requestId: null };
  const supplement = (amountMinor: bigint, appliedGrossMinor: bigint, creditedMinor: bigint) => ({ amountMinor, description: null, effectiveDate: '2026-10-28', distribution: 'REDUCTION' as const, requestId: null, reasonCode: 'GOODWILL', appliedGrossMinor, creditedMinor });

  describe(`${name} LedgerStore MUT-480 contract`, () => {
    it('reduce lowers and voids unbilled lines, credits the posted one, and records a REDUCTION row', async () => {
      const store = await makeStore();
      const { o, agreement, posted, installments } = await threeLines(store);
      const [first, second, third] = installments;
      const input: ReduceAgreementInput = {
        expectedVersion: agreement.version,
        installmentUpdates: [lowered(second!, 40_000n)],
        voids: [{ id: third!.id, expectedVersion: third!.version }],
        receivables: [{ id: posted.receivable.id, version: posted.receivable.version }],
        credits: [{ receivableId: posted.receivable.id, amountMinor: 25_000n, netMinor: 25_000n, vatMinor: 0n }],
        credit,
        supplement: supplement(-160_000n, 185_000n, 25_000n),
        totals: { amountMinor: 140_000n, netMinor: 140_000n, vatMinor: 0n, grossMinor: 140_000n },
      };
      const result = await store.agreements.reduce(o.id, agreement.id, input, at(4));
      if (result.kind !== 'updated') throw new Error(`expected updated, got ${result.kind}`);
      expect(result.record.agreement).toMatchObject({ version: agreement.version + 1, amountMinor: 140_000n, grossMinor: 140_000n });
      const byId = new Map(result.record.installments.map((i) => [i.id, i]));
      expect(byId.get(first!.id)).toMatchObject({ grossMinor: 100_000n, voidedAt: null });
      expect(byId.get(second!.id)).toMatchObject({ amountMinor: 40_000n, grossMinor: 40_000n, version: second!.version + 1 });
      expect(byId.get(third!.id)!.voidedAt).toEqual(at(4));
      expect(result.record.credits).toEqual([expect.objectContaining({ receivableId: posted.receivable.id, amountMinor: 25_000n, reason: 'Goodwill', reasonCode: 'GOODWILL', effectiveDate: '2026-10-28' })]);
      expect(await store.receivables.getById(o.id, posted.receivable.id)).toMatchObject({ creditedMinor: 25_000n, status: 'OPEN', version: posted.receivable.version + 1 });
      expect(result.record.supplement).toMatchObject({ distribution: 'REDUCTION', amountMinor: -160_000n, resultingAmountMinor: 140_000n, reasonCode: 'GOODWILL', appliedGrossMinor: 185_000n, creditedMinor: 25_000n });
      expect(await store.agreements.listSupplements(o.id, agreement.id)).toHaveLength(1);
      expect(await store.receivables.listCredits(o.id, posted.receivable.id)).toEqual([expect.objectContaining({ reasonCode: 'GOODWILL' })]);
    });

    it('a credit that settles a receivable moves it to SETTLED', async () => {
      const store = await makeStore();
      const { o, agreement, posted } = await threeLines(store);
      const result = await store.agreements.reduce(o.id, agreement.id, { expectedVersion: agreement.version, installmentUpdates: [], voids: [], receivables: [{ id: posted.receivable.id, version: posted.receivable.version }], credits: [{ receivableId: posted.receivable.id, amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 0n }], credit, supplement: supplement(0n, 100_000n, 100_000n), totals: { amountMinor: 300_000n, netMinor: 300_000n, vatMinor: 0n, grossMinor: 300_000n } }, at(4));
      expect(result.kind).toBe('updated');
      expect(await store.receivables.getById(o.id, posted.receivable.id)).toMatchObject({ creditedMinor: 100_000n, status: 'SETTLED' });
    });

    it('is stale, writing nothing, when anything it read has moved', async () => {
      const store = await makeStore();
      const { o, agreement, posted, installments } = await threeLines(store);
      const [, second, third] = installments;
      const good: ReduceAgreementInput = { expectedVersion: agreement.version, installmentUpdates: [lowered(second!, 40_000n)], voids: [{ id: third!.id, expectedVersion: third!.version }], receivables: [{ id: posted.receivable.id, version: posted.receivable.version }], credits: [], credit, supplement: supplement(-160_000n, 160_000n, 0n), totals: { amountMinor: 140_000n, netMinor: 140_000n, vatMinor: 0n, grossMinor: 140_000n } };
      // The lowered line is fine but the voided one changed: the lowering must roll back too.
      expect(await store.agreements.reduce(o.id, agreement.id, { ...good, voids: [{ id: third!.id, expectedVersion: third!.version + 1 }] }, at(4))).toMatchObject({ kind: 'stale' });
      expect(await store.agreements.reduce(o.id, agreement.id, { ...good, expectedVersion: agreement.version + 1 }, at(4))).toMatchObject({ kind: 'stale' });
      // A credit on the posted receivable since the read moves its version (O-F4), even though nothing credits it here.
      await store.receivables.credit(o.id, posted.receivable.id, { amountMinor: 1n, netMinor: 1n, vatMinor: 0n, reason: 'x', effectiveDate: '2026-10-28', requestId: null }, at(5));
      expect(await store.agreements.reduce(o.id, agreement.id, good, at(6))).toMatchObject({ kind: 'stale' });
      // Nothing was written by any of them.
      expect(await store.agreements.getById(o.id, agreement.id)).toMatchObject({ version: agreement.version, amountMinor: 300_000n });
      expect((await store.agreements.listInstallments(o.id, agreement.id)).map((i) => [i.grossMinor, i.voidedAt, i.version])).toEqual(installments.map((i) => [i.grossMinor, null, i.version]));
      expect(await store.agreements.listSupplements(o.id, agreement.id)).toEqual([]);
    });

    it('is stale on a line posted since the read, and not_found for another organization', async () => {
      const store = await makeStore();
      const { o, agreement, installments } = await threeLines(store);
      const third = installments[2]!;
      await store.agreements.postInstallment(o.id, third.id, { postingDate: '2026-10-28', dueDate: '2026-10-31', at: at(4) });
      const input: ReduceAgreementInput = { expectedVersion: agreement.version, installmentUpdates: [], voids: [{ id: third.id, expectedVersion: third.version }], receivables: [], credits: [], credit, supplement: supplement(-100_000n, 100_000n, 0n), totals: { amountMinor: 200_000n, netMinor: 200_000n, vatMinor: 0n, grossMinor: 200_000n } };
      expect(await store.agreements.reduce(o.id, agreement.id, input, at(5))).toMatchObject({ kind: 'stale' });
      expect(await store.agreements.reduce((await org(store)).id, agreement.id, input, at(5))).toEqual({ kind: 'not_found' });
    });

    it('E1: a post that read a line before a reduction lowered it posts nothing, and the next post bills the lowered amount', async () => {
      const store = await makeStore();
      const { o, agreement, installments } = await threeLines(store);
      const read = installments[1]!;
      const done = await store.agreements.reduce(o.id, agreement.id, { expectedVersion: agreement.version, installmentUpdates: [lowered(read, 60_000n)], voids: [], receivables: [], credits: [], credit, supplement: supplement(-40_000n, 40_000n, 0n), totals: { amountMinor: 260_000n, netMinor: 260_000n, vatMinor: 0n, grossMinor: 260_000n } }, at(4));
      expect(done.kind).toBe('updated');
      expect(await store.agreements.postInstallment(o.id, read.id, { postingDate: '2026-10-28', dueDate: '2026-10-31', at: at(5), expectedVersion: read.version })).toBeNull();
      expect((await store.agreements.getInstallment(o.id, read.id))!.receivableId).toBeNull();
      const next = await store.agreements.postInstallment(o.id, read.id, { postingDate: '2026-10-28', dueDate: '2026-10-31', at: at(6) });
      expect(next).toMatchObject({ created: true, receivable: { grossMinor: 60_000n } });
    });

    it('E1 under concurrency: a post racing a reduction never bills an amount the line no longer has', async () => {
      const store = await makeStore();
      const { o, agreement, installments } = await threeLines(store);
      const line = installments[1]!;
      await Promise.allSettled([
        store.agreements.reduce(o.id, agreement.id, { expectedVersion: agreement.version, installmentUpdates: [lowered(line, 60_000n)], voids: [], receivables: [], credits: [], credit, supplement: supplement(-40_000n, 40_000n, 0n), totals: { amountMinor: 260_000n, netMinor: 260_000n, vatMinor: 0n, grossMinor: 260_000n } }, at(4)),
        store.agreements.postInstallment(o.id, line.id, { postingDate: '2026-10-28', dueDate: '2026-10-31', at: at(5), expectedVersion: line.version }),
      ]);
      const after = (await store.agreements.getInstallment(o.id, line.id))!;
      if (after.receivableId) expect((await store.receivables.getById(o.id, after.receivableId))!.grossMinor).toBe(after.grossMinor);
      // Whichever won, the agreement total and the line agree.
      const total = (await store.agreements.getById(o.id, agreement.id))!.grossMinor;
      expect(total).toBe(after.grossMinor === 60_000n ? 260_000n : 300_000n);
    });

    it('a reduction racing a payment on the same receivable never over-settles it', async () => {
      const store = await makeStore();
      const { o, c, agreement, posted } = await threeLines(store);
      const results = await Promise.allSettled([
        store.agreements.reduce(o.id, agreement.id, { expectedVersion: agreement.version, installmentUpdates: [], voids: [], receivables: [{ id: posted.receivable.id, version: posted.receivable.version }], credits: [{ receivableId: posted.receivable.id, amountMinor: 60_000n, netMinor: 60_000n, vatMinor: 0n }], credit, supplement: supplement(0n, 60_000n, 60_000n), totals: { amountMinor: 300_000n, netMinor: 300_000n, vatMinor: 0n, grossMinor: 300_000n } }, at(4)),
        store.payments.create({ organizationId: o.id, customerId: c.id, projectId: null, currency: 'ILS', amountMinor: 70_000n, receivedOn: '2026-10-28', method: 'BANK', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: posted.receivable.id, amountMinor: 70_000n }] }, at(5)),
      ]);
      const r = (await store.receivables.getById(o.id, posted.receivable.id))!;
      expect(r.paidMinor + r.creditedMinor <= r.grossMinor).toBe(true);
      // Not both: the later one sees the other's version (the reduce) or the capacity (the payment) and refuses.
      const reduced = results[0].status === 'fulfilled' && results[0].value.kind === 'updated';
      const paid = results[1].status === 'fulfilled';
      expect(reduced && paid).toBe(false);
    });
  });
}
