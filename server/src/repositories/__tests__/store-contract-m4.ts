import { describe, expect, it } from 'vitest';
import type { CreateAgreementInput, CreateInstallmentInput, LedgerStore, Organization, ReceivableRecord } from '../ports.js';
import { InsufficientCapacity } from '../memory.js';

/** Milestone 4 storage contract: payments, allocations, reversals, credits, eligibility, numbering, operations lookup. */
export function describeLedgerStoreM4Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

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

  function agreementInput(organizationId: string, projectId: string, customerId: string, installments: CreateInstallmentInput[], currency = 'ILS'): CreateAgreementInput {
    const amount = installments.reduce((a, i) => a + i.amountMinor, 0n);
    return { organizationId, projectId, customerId, type: 'FIXED', currency, pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, agreementDate: '2026-10-08', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments };
  }

  /** A customer with one project and `amounts.length` posted receivables (gross = amount, exempt), due end of October. */
  async function seed(store: LedgerStore, organizationId: string, amounts: bigint[], currency = 'ILS') {
    const c = await store.customers.create({ organizationId, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at(0));
    const p = await store.projects.create({ organizationId, customerId: c.id, name: 'Case', currency }, at(1));
    const { installments } = await store.agreements.create(agreementInput(organizationId, p.id, c.id, amounts.map((a, i) => inst(i + 1, a)), currency), at(2));
    const receivables: ReceivableRecord[] = [];
    for (const [i, installment] of installments.entries()) {
      const posted = await store.agreements.postInstallment(organizationId, installment.id, { postingDate: '2026-10-01', dueDate: `2026-10-${String(10 + i).padStart(2, '0')}`, at: at(3 + i) });
      receivables.push(posted!.receivable);
    }
    return { c, p, receivables };
  }

  const payment = (organizationId: string, customerId: string, amountMinor: bigint, allocations: Array<{ receivableId: string; amountMinor: bigint }>, over: Record<string, unknown> = {}) => ({
    organizationId,
    customerId,
    currency: 'ILS',
    amountMinor,
    receivedOn: '2026-10-08',
    method: 'BANK' as const,
    reference: 'TRX-1',
    notes: null,
    replacesPaymentId: null,
    requestId: 'req-1',
    allocations,
    ...over,
  });

  describe(`${name} LedgerStore M4 contract`, () => {
    it('creates a payment with its allocations, moves paid_minor and status, and numbers it', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, receivables } = await seed(store, a.id, [100000n, 50000n]);
      const { payment: paid, allocations } = await store.payments.create(payment(a.id, c.id, 120000n, [{ receivableId: receivables[0]!.id, amountMinor: 100000n }, { receivableId: receivables[1]!.id, amountMinor: 10000n }]), at(10));
      expect(paid).toMatchObject({ number: 'PAY-2026-0001', status: 'POSTED', amountMinor: 120000n, allocatedMinor: 110000n, currency: 'ILS', receivedOn: '2026-10-08', method: 'BANK', reference: 'TRX-1' });
      expect(allocations.map((x) => x.amountMinor)).toEqual([100000n, 10000n]);
      const [r0, r1] = await store.receivables.getByIds(a.id, receivables.map((r) => r.id));
      expect(r0).toMatchObject({ paidMinor: 100000n, status: 'SETTLED' });
      expect(r1).toMatchObject({ paidMinor: 10000n, status: 'OPEN' });
      expect(r0!.version).toBeGreaterThan(receivables[0]!.version);
      expect(await store.payments.listAllocations(a.id, paid.id)).toHaveLength(2);
      expect(await store.payments.getById(a.id, paid.id)).toMatchObject({ id: paid.id });
      const other = await org(store, 'B');
      expect(await store.payments.getById(other.id, paid.id)).toBeNull();
      expect(await store.payments.listAllocations(other.id, paid.id)).toEqual([]);
    });

    it('rolls everything back when a receivable cannot absorb its allocation', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, receivables } = await seed(store, a.id, [100000n, 50000n]);
      await expect(store.payments.create(payment(a.id, c.id, 200000n, [{ receivableId: receivables[0]!.id, amountMinor: 100000n }, { receivableId: receivables[1]!.id, amountMinor: 50001n }]), at(10))).rejects.toBeInstanceOf(InsufficientCapacity);
      expect((await store.payments.list(a.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
      const [r0] = await store.receivables.getByIds(a.id, [receivables[0]!.id]);
      expect(r0).toMatchObject({ paidMinor: 0n, status: 'OPEN' });
      // the failed attempt did not consume a number
      const { payment: next } = await store.payments.create(payment(a.id, c.id, 1000n, []), at(11));
      expect(next.number).toBe('PAY-2026-0001');
    });

    it('numbers are gap-free per organization and year, also under concurrency', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      const ca = await seed(store, a.id, []);
      const cb = await seed(store, b.id, []);
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => store.payments.create(payment(a.id, ca.c.id, 100n, [], { receivedOn: i % 2 ? '2026-10-08' : '2027-01-05' }), at(20 + i))));
      const numbers = results.map((r) => r.payment.number).sort();
      expect(numbers).toEqual([...Array.from({ length: 6 }, (_, i) => `PAY-2026-${String(i + 1).padStart(4, '0')}`), ...Array.from({ length: 6 }, (_, i) => `PAY-2027-${String(i + 1).padStart(4, '0')}`)]);
      expect((await store.payments.create(payment(b.id, cb.c.id, 100n, []), at(40))).payment.number).toBe('PAY-2026-0001');
    });

    it('allocates unallocated funds later, within the remainder, only on a POSTED payment', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, receivables } = await seed(store, a.id, [100000n, 50000n]);
      const { payment: paid } = await store.payments.create(payment(a.id, c.id, 120000n, []), at(10));
      const first = await store.payments.allocate(a.id, paid.id, [{ receivableId: receivables[0]!.id, amountMinor: 100000n }], at(11));
      expect(first!.payment.allocatedMinor).toBe(100000n);
      expect(first!.allocations).toHaveLength(1);
      await expect(store.payments.allocate(a.id, paid.id, [{ receivableId: receivables[1]!.id, amountMinor: 20001n }], at(12))).rejects.toBeInstanceOf(InsufficientCapacity);
      const second = await store.payments.allocate(a.id, paid.id, [{ receivableId: receivables[1]!.id, amountMinor: 20000n }], at(13));
      expect(second!.payment.allocatedMinor).toBe(120000n);
      expect(await store.payments.listAllocations(a.id, paid.id)).toHaveLength(2);
      expect(await store.payments.allocate(a.id, '00000000-0000-4000-8000-000000000000', [], at(14))).toBeNull();
      await store.payments.reverse(a.id, paid.id, 'wrong client', at(15));
      await expect(store.payments.allocate(a.id, paid.id, [{ receivableId: receivables[1]!.id, amountMinor: 1n }], at(16))).rejects.toBeInstanceOf(InsufficientCapacity);
    });

    it('reverses: receivables restored and reopened, allocated zeroed, second reverse unchanged; replacedBy lookup', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, receivables } = await seed(store, a.id, [100000n]);
      const { payment: paid } = await store.payments.create(payment(a.id, c.id, 100000n, [{ receivableId: receivables[0]!.id, amountMinor: 100000n }]), at(10));
      expect((await store.receivables.getById(a.id, receivables[0]!.id))!.status).toBe('SETTLED');
      const reversed = await store.payments.reverse(a.id, paid.id, 'duplicate', at(11));
      expect(reversed).toMatchObject({ changed: true, payment: { status: 'REVERSED', allocatedMinor: 0n, reversalReason: 'duplicate', reversedAt: at(11) } });
      expect(reversed!.payment.version).toBeGreaterThan(paid.version);
      expect(await store.receivables.getById(a.id, receivables[0]!.id)).toMatchObject({ paidMinor: 0n, status: 'OPEN' });
      const again = await store.payments.reverse(a.id, paid.id, 'again', at(12));
      expect(again).toMatchObject({ changed: false, payment: { reversalReason: 'duplicate' } });
      // allocation rows stay as history
      expect(await store.payments.listAllocations(a.id, paid.id)).toHaveLength(1);
      expect(await store.payments.findReplacedBy(a.id, paid.id)).toBeNull();
      const { payment: corrected } = await store.payments.create(payment(a.id, c.id, 100000n, [], { replacesPaymentId: paid.id }), at(13));
      expect((await store.payments.findReplacedBy(a.id, paid.id))!.id).toBe(corrected.id);
      expect(await store.payments.reverse(a.id, '00000000-0000-4000-8000-000000000000', 'x', at(14))).toBeNull();
    });

    it('credits: append-only rows, credited_minor and status follow, capacity enforced, newest first', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p, receivables } = await seed(store, a.id, [100000n]);
      const r = receivables[0]!;
      const credit = (amount: bigint, ms: number) => store.receivables.credit(a.id, r.id, { amountMinor: amount, netMinor: amount, vatMinor: 0n, reason: 'scope reduced', effectiveDate: '2026-10-08', requestId: null }, at(ms));
      const first = await credit(30000n, 10);
      expect(first!.receivable).toMatchObject({ creditedMinor: 30000n, status: 'OPEN' });
      expect(first!.credit).toMatchObject({ amountMinor: 30000n, reason: 'scope reduced', receivableId: r.id });
      await store.payments.create(payment(a.id, c.id, 50000n, [{ receivableId: r.id, amountMinor: 50000n }]), at(11));
      await expect(credit(20001n, 12)).rejects.toBeInstanceOf(InsufficientCapacity);
      const last = await credit(20000n, 13);
      expect(last!.receivable).toMatchObject({ creditedMinor: 50000n, paidMinor: 50000n, status: 'SETTLED' });
      expect((await store.receivables.listCredits(a.id, r.id)).map((x) => x.amountMinor)).toEqual([20000n, 30000n]);
      await expect(credit(1n, 14)).rejects.toBeInstanceOf(InsufficientCapacity);
      expect(await store.receivables.countOutstandingByProject(a.id, p.id)).toBe(0);
      expect(await store.receivables.credit(a.id, '00000000-0000-4000-8000-000000000000', { amountMinor: 1n, netMinor: 1n, vatMinor: 0n, reason: 'x', effectiveDate: '2026-10-08', requestId: null }, at(15))).toBeNull();
      void c;
    });

    it('sums equal their rows after a sequence of create / allocate / reverse / credit', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, receivables } = await seed(store, a.id, [100000n, 100000n, 100000n]);
      const ids = receivables.map((r) => r.id);
      const p1 = await store.payments.create(payment(a.id, c.id, 150000n, [{ receivableId: ids[0]!, amountMinor: 100000n }, { receivableId: ids[1]!, amountMinor: 50000n }]), at(10));
      const p2 = await store.payments.create(payment(a.id, c.id, 80000n, [{ receivableId: ids[1]!, amountMinor: 30000n }]), at(11));
      await store.payments.allocate(a.id, p2.payment.id, [{ receivableId: ids[2]!, amountMinor: 50000n }], at(12));
      await store.receivables.credit(a.id, ids[2]!, { amountMinor: 20000n, netMinor: 20000n, vatMinor: 0n, reason: 'r', effectiveDate: '2026-10-08', requestId: null }, at(13));
      await store.payments.reverse(a.id, p1.payment.id, 'oops', at(14));
      const all = await store.receivables.getByIds(a.id, ids);
      const allocations = [...(await store.payments.listAllocations(a.id, p1.payment.id)), ...(await store.payments.listAllocations(a.id, p2.payment.id))];
      const posted = new Set([p2.payment.id]);
      for (const r of all) {
        const paid = allocations.filter((x) => x.receivableId === r.id && posted.has(x.paymentId)).reduce((s, x) => s + x.amountMinor, 0n);
        const credited = (await store.receivables.listCredits(a.id, r.id)).reduce((s, x) => s + x.amountMinor, 0n);
        expect(r.paidMinor).toBe(paid);
        expect(r.creditedMinor).toBe(credited);
        expect(r.status).toBe(r.grossMinor - r.paidMinor - r.creditedMinor > 0n ? 'OPEN' : 'SETTLED');
      }
      expect(all.map((r) => r.paidMinor)).toEqual([0n, 30000n, 50000n]);
    });

    it('lists eligible receivables (OPEN, outstanding > 0, same customer + currency), oldest due first; filters and pages payments', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const { c, p, receivables } = await seed(store, a.id, [100000n, 50000n, 20000n]);
      await store.receivables.credit(a.id, receivables[2]!.id, { amountMinor: 20000n, netMinor: 20000n, vatMinor: 0n, reason: 'waived', effectiveDate: '2026-10-08', requestId: null }, at(5));
      const usd = await seed(store, a.id, [7000n], 'USD');
      expect((await store.receivables.listEligible(a.id, c.id, 'ILS')).map((r) => r.id)).toEqual([receivables[0]!.id, receivables[1]!.id]);
      expect((await store.receivables.listEligible(a.id, usd.c.id, 'USD')).map((r) => r.grossMinor)).toEqual([7000n]);
      expect(await store.receivables.listEligible(a.id, c.id, 'USD')).toEqual([]);

      const p1 = await store.payments.create(payment(a.id, c.id, 100000n, [{ receivableId: receivables[0]!.id, amountMinor: 100000n }]), at(10));
      const p2 = await store.payments.create(payment(a.id, c.id, 1000n, [], { receivedOn: '2026-09-01' }), at(11));
      await store.payments.reverse(a.id, p2.payment.id, 'x', at(12));
      const p3 = await store.payments.create(payment(a.id, usd.c.id, 7000n, [{ receivableId: usd.receivables[0]!.id, amountMinor: 7000n }], { currency: 'USD' }), at(13));
      const list = (f: Parameters<typeof store.payments.list>[1], limit = 10, cursor: Parameters<typeof store.payments.list>[2]['cursor'] = null) => store.payments.list(a.id, f, { limit, cursor });
      expect((await list({})).items.map((x) => x.id)).toEqual([p1.payment.id, p2.payment.id, p3.payment.id]);
      expect((await list({ customerId: c.id })).items).toHaveLength(2);
      expect((await list({ status: 'REVERSED' })).items.map((x) => x.id)).toEqual([p2.payment.id]);
      expect((await list({ projectId: p.id })).items.map((x) => x.id)).toEqual([p1.payment.id]);
      expect((await list({ receivedBefore: '2026-09-30' })).items.map((x) => x.id)).toEqual([p2.payment.id]);
      expect((await list({ receivedAfter: '2026-10-01' })).items).toHaveLength(2);
      const page1 = await list({}, 2);
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await list({}, 2, page1.nextCursor);
      expect(page2.items.map((x) => x.id)).toEqual([p3.payment.id]);
      const other = await org(store, 'B');
      expect((await store.payments.list(other.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
    });

    it('round-trips BigInt amounts beyond 2^53 on payments, allocations and credits', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const big = 2n ** 60n;
      const { c, receivables } = await seed(store, a.id, [big]);
      const { payment: paid, allocations } = await store.payments.create(payment(a.id, c.id, big, [{ receivableId: receivables[0]!.id, amountMinor: big - 1n }]), at(10));
      expect(paid.amountMinor).toBe(big);
      expect(allocations[0]!.amountMinor).toBe(big - 1n);
      const credited = await store.receivables.credit(a.id, receivables[0]!.id, { amountMinor: 1n, netMinor: 1n, vatMinor: 0n, reason: 'r', effectiveDate: '2026-10-08', requestId: null }, at(11));
      expect(credited!.receivable).toMatchObject({ paidMinor: big - 1n, creditedMinor: 1n, status: 'SETTLED' });
    });

    it('idempotency.get returns the stored claim and nothing after fail', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      expect(await store.idempotency.get(a.id, 'never-claimed-key')).toBeNull();
      await store.idempotency.claim({ organizationId: a.id, key: 'k-pending-1', operation: 'payments.create', fingerprint: 'fp', at: at(1) });
      expect(await store.idempotency.get(a.id, 'k-pending-1')).toMatchObject({ status: 'PENDING', operation: 'payments.create', responseBody: null });
      await store.idempotency.complete({ organizationId: a.id, key: 'k-pending-1', responseStatus: 201, responseBody: { id: 'x' }, at: at(2) });
      expect(await store.idempotency.get(a.id, 'k-pending-1')).toMatchObject({ status: 'COMPLETED', responseStatus: 201, responseBody: { id: 'x' } });
      await store.idempotency.claim({ organizationId: a.id, key: 'k-failed-1', operation: 'payments.create', fingerprint: 'fp', at: at(3) });
      await store.idempotency.fail({ organizationId: a.id, key: 'k-failed-1', at: at(4) });
      expect(await store.idempotency.get(a.id, 'k-failed-1')).toBeNull();
      const other = await org(store, 'B');
      expect(await store.idempotency.get(other.id, 'k-pending-1')).toBeNull();
    });
  });
}
