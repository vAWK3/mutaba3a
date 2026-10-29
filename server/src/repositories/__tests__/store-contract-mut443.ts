import { describe, expect, it } from 'vitest';
import type { CorrectPaymentInput, CreateAgreementInput, CreateInstallmentInput, CreatePaymentInput, LedgerStore, Organization, ReceivableRecord } from '../ports.js';
import { InsufficientCapacity, StateConflict } from '../memory.js';

/**
 * MUT-443 storage contract: `payments.correct` reverses a POSTED payment and records its replacement in one write, or
 * writes nothing (no reversal, no payment, no number); a reversed or other-version original is a StateConflict; two
 * corrections racing make one replacement; the replacement may re-pay what the original paid.
 */
export function describeLedgerStoreMut443Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 28, 12, 0, 0, ms));

  const inst = (position: number, amount: bigint): CreateInstallmentInput => ({
    position,
    label: `I${position}`,
    amountMinor: amount,
    netMinor: amount,
    vatMinor: 0n,
    grossMinor: amount,
    vatTreatment: 'EXEMPT',
    rateBasisPoints: 0,
    triggerType: 'IMMEDIATE',
    triggerDate: null,
    paymentTerms: null,
    dueDateOverride: null,
  });

  /** A firm with one customer, one project and a posted receivable per amount (exempt, gross = amount). */
  async function firm(store: LedgerStore, amounts: bigint[]) {
    const o: Organization = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const c = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at(0));
    const p = await store.projects.create({ organizationId: o.id, customerId: c.id, name: 'Case', currency: 'ILS' }, at(1));
    const total = amounts.reduce((s, a) => s + a, 0n);
    const agreement: CreateAgreementInput = { organizationId: o.id, projectId: p.id, customerId: c.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: total, netMinor: total, vatMinor: 0n, grossMinor: total, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments: amounts.map((a, i) => inst(i + 1, a)) };
    const { installments } = await store.agreements.create(agreement, at(2));
    const receivables: ReceivableRecord[] = [];
    for (const [i, installment] of installments.entries()) {
      const posted = await store.agreements.postInstallment(o.id, installment.id, { postingDate: '2026-10-01', dueDate: `2026-10-${String(20 + i).padStart(2, '0')}`, at: at(3 + i) });
      receivables.push(posted!.receivable);
    }
    const payment = (amountMinor: bigint, allocations: Array<{ receivableId: string; amountMinor: bigint }>, over: Partial<CreatePaymentInput> = {}): CreatePaymentInput => ({
      organizationId: o.id,
      customerId: c.id,
      projectId: null,
      currency: 'ILS',
      amountMinor,
      receivedOn: '2026-10-27',
      method: 'BANK',
      reference: 'TR-1',
      receiptNumber: '3001',
      notes: null,
      replacesPaymentId: null,
      requestId: 'req-1',
      createdByUserId: null,
      origin: 'INTEGRATION',
      captureSource: null,
      allocations,
      ...over,
    });
    const correction = (expectedVersion: number, amountMinor: bigint, allocations: Array<{ receivableId: string; amountMinor: bigint }>, over: Partial<CreatePaymentInput> = {}): CorrectPaymentInput => {
      const { replacesPaymentId: _ignored, ...replacement } = payment(amountMinor, allocations, { receivedOn: '2026-10-28', ...over });
      void _ignored;
      return { expectedVersion, reason: 'ENTERED_BY_MISTAKE', reasonCode: 'ENTERED_BY_MISTAKE', replacement };
    };
    const receivable = async (id: string) => (await store.receivables.getById(o.id, id))!;
    return { o, c, p, receivables, payment, correction, receivable };
  }

  /** Expects the promise to reject with a StateConflict carrying `reason`. */
  async function conflict(promise: Promise<unknown>, reason: string): Promise<void> {
    const err = await promise.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(StateConflict);
    expect((err as StateConflict).reason).toBe(reason);
  }

  describe(`${name} LedgerStore MUT-443 contract`, () => {
    it('correct reverses the original and records its replacement in one write, linked by replacesPaymentId', async () => {
      const store = await makeStore();
      const { o, receivables: [charge], payment, correction, receivable } = await firm(store, [100_000n]);
      const { payment: original } = await store.payments.create(payment(100_000n, [{ receivableId: charge!.id, amountMinor: 100_000n }]), at(10));
      expect((await receivable(charge!.id)).status).toBe('SETTLED');

      const result = await store.payments.correct(o.id, original.id, correction(original.version, 60_000n, [{ receivableId: charge!.id, amountMinor: 60_000n }]), at(20));

      expect(result!.reversed).toMatchObject({ id: original.id, status: 'REVERSED', reversalReason: 'ENTERED_BY_MISTAKE', reversalReasonCode: 'ENTERED_BY_MISTAKE', allocatedMinor: 0n, version: original.version + 1 });
      expect(result!.reversed.reversedAt!.getTime()).toBe(at(20).getTime());
      expect(result!.payment).toMatchObject({ status: 'POSTED', replacesPaymentId: original.id, amountMinor: 60_000n, allocatedMinor: 60_000n, receivedOn: '2026-10-28', receiptNumber: '3001', reversalReasonCode: null, number: 'PAY-2026-0002' });
      // R8: one millisecond after the reversal, so its statement line sorts after the reversal's.
      expect(result!.payment.createdAt.getTime()).toBe(at(20).getTime() + 1);
      expect(result!.allocations.map((a) => [a.receivableId, a.amountMinor])).toEqual([[charge!.id, 60_000n]]);
      expect(await receivable(charge!.id)).toMatchObject({ paidMinor: 60_000n, status: 'OPEN' });
      expect((await store.payments.findReplacedBy(o.id, original.id))!.id).toBe(result!.payment.id);
      expect(await store.payments.getById(o.id, original.id)).toMatchObject({ status: 'REVERSED', reversalReasonCode: 'ENTERED_BY_MISTAKE' });
    });

    it('a capacity failure writes nothing: the original stays POSTED with its allocations and version, and no number is used', async () => {
      const store = await makeStore();
      const { o, receivables: [a, b], payment, correction, receivable } = await firm(store, [100_000n, 50_000n]);
      const { payment: original } = await store.payments.create(payment(100_000n, [{ receivableId: a!.id, amountMinor: 100_000n }]), at(10));
      const before = await receivable(a!.id);

      // `a` frees 100,000 once released; `b` has only 50,000 outstanding.
      const err = await store.payments.correct(o.id, original.id, correction(original.version, 160_000n, [{ receivableId: a!.id, amountMinor: 100_000n }, { receivableId: b!.id, amountMinor: 60_000n }]), at(20)).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(InsufficientCapacity);

      expect(await store.payments.getById(o.id, original.id)).toMatchObject({ status: 'POSTED', version: original.version, allocatedMinor: 100_000n, reversedAt: null, reversalReason: null, reversalReasonCode: null });
      expect((await store.payments.listAllocations(o.id, original.id)).map((x) => x.amountMinor)).toEqual([100_000n]);
      expect(await receivable(a!.id)).toMatchObject({ paidMinor: 100_000n, status: 'SETTLED', version: before.version });
      expect((await receivable(b!.id)).paidMinor).toBe(0n);
      expect((await store.payments.list(o.id, {}, { limit: 50, cursor: null })).items).toHaveLength(1);
      // The year's counter did not move: the next payment takes the number the failed correction would have.
      expect((await store.payments.create(payment(1_000n, []), at(30))).payment.number).toBe('PAY-2026-0002');
    });

    it('a REVERSED original is StateConflict PAYMENT_NOT_POSTED; another version is PREVIEW_STALE; neither writes', async () => {
      const store = await makeStore();
      const { o, receivables: [charge], payment, correction, receivable } = await firm(store, [100_000n]);
      const { payment: kept } = await store.payments.create(payment(40_000n, [{ receivableId: charge!.id, amountMinor: 40_000n }]), at(10));
      await conflict(store.payments.correct(o.id, kept.id, correction(kept.version + 1, 30_000n, []), at(20)), 'PREVIEW_STALE');
      expect(await store.payments.getById(o.id, kept.id)).toMatchObject({ status: 'POSTED', version: kept.version });
      expect((await receivable(charge!.id)).paidMinor).toBe(40_000n);

      const reversed = (await store.payments.reverse(o.id, kept.id, 'Bounced', at(30)))!.payment;
      await conflict(store.payments.correct(o.id, kept.id, correction(reversed.version, 30_000n, []), at(40)), 'PAYMENT_NOT_POSTED');
      expect(await store.payments.findReplacedBy(o.id, kept.id)).toBeNull();
      expect((await store.payments.list(o.id, {}, { limit: 50, cursor: null })).items).toHaveLength(1);

      const other = await store.organizations.create({ name: 'Other', slug: `other-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      expect(await store.payments.correct(other.id, kept.id, correction(reversed.version, 30_000n, []), at(50))).toBeNull();
    });

    it('two corrections racing make exactly one replacement', async () => {
      const store = await makeStore();
      const { o, receivables: [charge], payment, correction } = await firm(store, [100_000n]);
      const { payment: original } = await store.payments.create(payment(100_000n, [{ receivableId: charge!.id, amountMinor: 100_000n }]), at(10));
      const results = await Promise.allSettled([
        store.payments.correct(o.id, original.id, correction(original.version, 60_000n, [{ receivableId: charge!.id, amountMinor: 60_000n }]), at(20)),
        store.payments.correct(o.id, original.id, correction(original.version, 70_000n, [{ receivableId: charge!.id, amountMinor: 70_000n }]), at(21)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(StateConflict);
      const replacements = (await store.payments.list(o.id, { status: 'POSTED' }, { limit: 50, cursor: null })).items;
      expect(replacements.map((p) => p.replacesPaymentId)).toEqual([original.id]);
    });

    it('a replacement dated in another year takes that year\'s next number; the original keeps its own (review 4)', async () => {
      const store = await makeStore();
      const { o, receivables: [charge], payment, correction } = await firm(store, [100_000n]);
      const { payment: original } = await store.payments.create(payment(100_000n, [{ receivableId: charge!.id, amountMinor: 100_000n }], { receivedOn: '2025-12-30' }), at(10));
      expect(original.number).toBe('PAY-2025-0001');
      const result = (await store.payments.correct(o.id, original.id, correction(original.version, 100_000n, [{ receivableId: charge!.id, amountMinor: 100_000n }], { receivedOn: '2026-01-02' }), at(20)))!;
      expect(result.payment.number).toBe('PAY-2026-0001');
      expect(result.reversed.number).toBe('PAY-2025-0001');
      const { payment: next } = await store.payments.create(payment(1_000n, [], { receivedOn: '2025-12-31' }), at(30));
      expect(next.number).toBe('PAY-2025-0002');
    });

    it('the replacement may re-pay what the original paid, the same amount included', async () => {
      const store = await makeStore();
      const { o, receivables: [charge], payment, correction, receivable } = await firm(store, [100_000n]);
      const { payment: original } = await store.payments.create(payment(100_000n, [{ receivableId: charge!.id, amountMinor: 100_000n }]), at(10));
      const result = await store.payments.correct(o.id, original.id, correction(original.version, 100_000n, [{ receivableId: charge!.id, amountMinor: 100_000n }], { method: 'CASH' }), at(20));
      expect(result!.payment).toMatchObject({ method: 'CASH', allocatedMinor: 100_000n });
      expect(await receivable(charge!.id)).toMatchObject({ paidMinor: 100_000n, status: 'SETTLED' });
    });

    it('re-pays a receivable another payment settled since, up to what the reversal releases', async () => {
      const store = await makeStore();
      const { o, receivables: [charge], payment, correction, receivable } = await firm(store, [100_000n]);
      const { payment: original } = await store.payments.create(payment(60_000n, [{ receivableId: charge!.id, amountMinor: 60_000n }]), at(10));
      await store.payments.create(payment(40_000n, [{ receivableId: charge!.id, amountMinor: 40_000n }]), at(11));
      expect((await receivable(charge!.id)).status).toBe('SETTLED');
      const tooMuch = await store.payments.correct(o.id, original.id, correction(original.version, 60_001n, [{ receivableId: charge!.id, amountMinor: 60_001n }]), at(20)).then(() => null, (e: unknown) => e);
      expect(tooMuch).toBeInstanceOf(InsufficientCapacity);
      const result = await store.payments.correct(o.id, original.id, correction(original.version, 60_000n, [{ receivableId: charge!.id, amountMinor: 60_000n }]), at(21));
      expect(result!.payment.allocatedMinor).toBe(60_000n);
      expect(await receivable(charge!.id)).toMatchObject({ paidMinor: 100_000n, status: 'SETTLED' });
    });

    it('a correction releasing and paying overlapping receivables runs alongside a create on them (R1, no deadlock)', async () => {
      const store = await makeStore();
      const { o, receivables: [a, b, c], payment, correction, receivable } = await firm(store, [100_000n, 100_000n, 100_000n]);
      const { payment: original } = await store.payments.create(payment(100_000n, [{ receivableId: a!.id, amountMinor: 50_000n }, { receivableId: b!.id, amountMinor: 50_000n }]), at(10));
      const results = await Promise.allSettled([
        store.payments.correct(o.id, original.id, correction(original.version, 100_000n, [{ receivableId: c!.id, amountMinor: 40_000n }, { receivableId: b!.id, amountMinor: 30_000n }, { receivableId: a!.id, amountMinor: 30_000n }]), at(20)),
        store.payments.create(payment(30_000n, [{ receivableId: c!.id, amountMinor: 10_000n }, { receivableId: a!.id, amountMinor: 20_000n }], { receiptNumber: null }), at(21)),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((await receivable(a!.id)).paidMinor).toBe(50_000n);
      expect((await receivable(b!.id)).paidMinor).toBe(30_000n);
      expect((await receivable(c!.id)).paidMinor).toBe(50_000n);
    });
  });
}
