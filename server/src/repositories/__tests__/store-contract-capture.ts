import { describe, expect, it } from 'vitest';
import type { CaptureReceivedInput, CreateAgreementInput, LedgerStore, Organization, ReceivableRecord } from '../ports.js';

/**
 * MUT-61 storage contract: a person's own "Received" capture (payments.capture),
 * its atomic undo (payments.undoCapture), and the list filters Malafat uses to
 * find phone payments it still has to allocate.
 */
export function describeLedgerStoreCaptureContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function person(store: LedgerStore, organizationId: string, label = 'Nour') {
    const { user } = await store.users.create({ email: `${label.toLowerCase()}-${unique()}@firm.ps`, displayName: label, passwordHash: 'x', locale: 'en', organizationId, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    return user;
  }

  function agreementInput(organizationId: string, projectId: string, customerId: string, amount: bigint): CreateAgreementInput {
    return {
      organizationId, projectId, customerId, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0,
      amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, agreementDate: '2026-10-08', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null,
      installments: [{ position: 1, label: 'I1', amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
    };
  }

  /** A client with two matters; matter Y carries one posted receivable of `owed`. */
  async function seed(store: LedgerStore, organizationId: string, owed = 10000n) {
    const c = await store.customers.create({ organizationId, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at(1));
    const x = await store.projects.create({ organizationId, customerId: c.id, name: 'Matter X', currency: 'ILS' }, at(2));
    const y = await store.projects.create({ organizationId, customerId: c.id, name: 'Matter Y', currency: 'ILS' }, at(3));
    const { installments } = await store.agreements.create(agreementInput(organizationId, y.id, c.id, owed), at(4));
    const posted = await store.agreements.postInstallment(organizationId, installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-31', at: at(5) });
    return { c, x, y, receivable: posted!.receivable as ReceivableRecord };
  }

  const capture = (organizationId: string, userId: string, amountMinor: bigint, over: Partial<CaptureReceivedInput> = {}): CaptureReceivedInput => ({
    organizationId,
    customerId: null,
    projectId: null,
    currency: 'ILS',
    amountMinor,
    receivedOn: '2026-10-08',
    method: 'CASH',
    notes: null,
    requestId: 'req-1',
    createdByUserId: userId,
    captureSource: 'app',
    ...over,
  });

  const page = { limit: 50, cursor: null };
  const ids = (p: { items: Array<{ id: string }> }) => p.items.map((x) => x.id);

  describe(`${name} LedgerStore capture contract (MUT-61)`, () => {
    it('capture writes a POSTED payment with no allocations, origin CAPTURE, its source and its person', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c, x } = await seed(store, a.id);

      const p = (await store.payments.capture(capture(a.id, u.id, 5000n, { customerId: c.id, projectId: x.id, captureSource: 'siri' }), at(10))).payment;
      expect(p).toMatchObject({ status: 'POSTED', origin: 'CAPTURE', captureSource: 'siri', createdByUserId: u.id, allocatedMinor: 0n, customerId: c.id, projectId: x.id, reference: null, replacesPaymentId: null });
      expect(p.number).toMatch(/^PAY-2026-\d{4}$/);
      expect(await store.payments.listAllocations(a.id, p.id)).toEqual([]);
      expect(await store.payments.getById(a.id, p.id)).toMatchObject({ origin: 'CAPTURE', captureSource: 'siri' });
    });

    it('a payment Malafat records through create is origin INTEGRATION with no capture source', async () => {
      const store = await makeStore();
      const a = await org(store);
      const { c, receivable } = await seed(store, a.id);
      const { payment } = await store.payments.create({ organizationId: a.id, customerId: c.id, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-08', method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: receivable.id, amountMinor: 1000n }] }, at(10));
      expect(payment).toMatchObject({ origin: 'INTEGRATION', captureSource: null });
    });

    it('undoCapture reverses an unallocated capture once, then answers already-reversed', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const p = (await store.payments.capture(capture(a.id, u.id, 5000n), at(10))).payment;

      const first = await store.payments.undoCapture(a.id, p.id, u.id, at(11));
      expect(first.result).toBe('reversed');
      expect(first.payment).toMatchObject({ status: 'REVERSED', reversalReason: 'capture_undo', allocatedMinor: 0n });
      expect((await store.payments.undoCapture(a.id, p.id, u.id, at(12))).result).toBe('already-reversed');
    });

    it('undoCapture refuses once any allocation exists — full or partial — and changes nothing', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c, receivable } = await seed(store, a.id);
      const p = (await store.payments.capture(capture(a.id, u.id, 5000n, { customerId: c.id }), at(10))).payment;
      await store.payments.allocate(a.id, p.id, [{ receivableId: receivable.id, amountMinor: 2000n }], at(11));

      const res = await store.payments.undoCapture(a.id, p.id, u.id, at(12));
      expect(res.result).toBe('allocated');
      expect(await store.payments.getById(a.id, p.id)).toMatchObject({ status: 'POSTED', allocatedMinor: 2000n });
      expect(await store.receivables.getById(a.id, receivable.id)).toMatchObject({ paidMinor: 2000n });
    });

    it('undoCapture is not-found for another person’s capture, a Malafat payment, another organization, or an unknown id', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      const u = await person(store, a.id, 'Nour');
      const other = await person(store, a.id, 'Sami');
      const { c } = await seed(store, a.id);
      const mine = (await store.payments.capture(capture(a.id, u.id, 5000n), at(10))).payment;
      const { payment: malafat } = await store.payments.create({ organizationId: a.id, customerId: c.id, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-08', method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [] }, at(11));

      expect((await store.payments.undoCapture(a.id, mine.id, other.id, at(12))).result).toBe('not-found');
      expect((await store.payments.undoCapture(b.id, mine.id, u.id, at(12))).result).toBe('not-found');
      expect((await store.payments.undoCapture(a.id, malafat.id, u.id, at(12))).result).toBe('not-found');
      expect((await store.payments.undoCapture(a.id, '00000000-0000-4000-8000-000000000000', u.id, at(12))).result).toBe('not-found');
      expect(await store.payments.getById(a.id, mine.id)).toMatchObject({ status: 'POSTED' });
    });

    it('undoCapture tells a reversal by someone else (Malafat) from the person’s own earlier undo (MUT-61 review D2)', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const theirs = (await store.payments.capture(capture(a.id, u.id, 5000n), at(10))).payment;
      await store.payments.reverse(a.id, theirs.id, 'duplicate', at(11));
      expect((await store.payments.undoCapture(a.id, theirs.id, u.id, at(12))).result).toBe('reversed-elsewhere');
      const mine = (await store.payments.capture(capture(a.id, u.id, 5000n), at(13))).payment;
      await store.payments.undoCapture(a.id, mine.id, u.id, at(14));
      expect((await store.payments.undoCapture(a.id, mine.id, u.id, at(15))).result).toBe('already-reversed');
    });

    it('allocate and undoCapture racing: exactly one wins, never a REVERSED payment with money still applied (MUT-61 review D4)', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c, receivable } = await seed(store, a.id, 100_000n);
      let allocatedWon = 0;
      for (let i = 0; i < 20; i += 1) {
        const p = (await store.payments.capture(capture(a.id, u.id, 100n, { customerId: c.id }), at(20 + i))).payment;
        const [alloc, undo] = await Promise.allSettled([
          store.payments.allocate(a.id, p.id, [{ receivableId: receivable.id, amountMinor: 100n }], at(20 + i)),
          store.payments.undoCapture(a.id, p.id, u.id, at(20 + i)),
        ]);
        const after = (await store.payments.getById(a.id, p.id))!;
        const rows = await store.payments.listAllocations(a.id, p.id);
        if (after.status === 'REVERSED') {
          expect([after.allocatedMinor, rows.length, alloc.status, undo.status === 'fulfilled' && undo.value.result]).toEqual([0n, 0, 'rejected', 'reversed']);
        } else {
          expect([after.allocatedMinor, rows.length, alloc.status, undo.status === 'fulfilled' && undo.value.result]).toEqual([100n, 1, 'fulfilled', 'allocated']);
          allocatedWon += 1;
        }
      }
      expect((await store.receivables.getById(a.id, receivable.id))!.paidMinor).toBe(BigInt(allocatedWon) * 100n);
    });

    it('filters by origin and by allocation state (POSTED only)', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c, receivable } = await seed(store, a.id, 10000n);
      const open = (await store.payments.capture(capture(a.id, u.id, 3000n, { customerId: c.id }), at(10))).payment;
      const partial = (await store.payments.capture(capture(a.id, u.id, 3000n, { customerId: c.id }), at(11))).payment;
      const full = (await store.payments.capture(capture(a.id, u.id, 3000n, { customerId: c.id }), at(12))).payment;
      const undone = (await store.payments.capture(capture(a.id, u.id, 3000n, { customerId: c.id }), at(13))).payment;
      await store.payments.allocate(a.id, partial.id, [{ receivableId: receivable.id, amountMinor: 1000n }], at(14));
      await store.payments.allocate(a.id, full.id, [{ receivableId: receivable.id, amountMinor: 3000n }], at(15));
      await store.payments.undoCapture(a.id, undone.id, u.id, at(16));
      const { payment: malafat } = await store.payments.create({ organizationId: a.id, customerId: c.id, projectId: null, currency: 'ILS', amountMinor: 500n, receivedOn: '2026-10-08', method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [] }, at(17));

      expect(ids(await store.payments.list(a.id, { customerId: c.id, origin: 'CAPTURE', allocationState: 'unallocated' }, page))).toEqual([open.id]);
      expect(ids(await store.payments.list(a.id, { origin: 'CAPTURE', allocationState: 'partial' }, page))).toEqual([partial.id]);
      expect(ids(await store.payments.list(a.id, { origin: 'CAPTURE', allocationState: 'allocated' }, page))).toEqual([full.id]);
      expect(ids(await store.payments.list(a.id, { origin: 'INTEGRATION' }, page))).toEqual([malafat.id]);
      expect(ids(await store.payments.list(a.id, { allocationState: 'unallocated' }, page))).toEqual([open.id, malafat.id]);
    });

    it('a captured matter is a hint until the payment is allocated: allocated to Y, it lists under Y, not X (D2)', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c, x, y, receivable } = await seed(store, a.id);
      const p = (await store.payments.capture(capture(a.id, u.id, 4000n, { customerId: c.id, projectId: x.id }), at(10))).payment;
      expect(ids(await store.payments.list(a.id, { projectId: x.id }, page))).toEqual([p.id]);

      await store.payments.allocate(a.id, p.id, [{ receivableId: receivable.id, amountMinor: 4000n }], at(11));
      expect(ids(await store.payments.list(a.id, { projectId: x.id }, page))).toEqual([]);
      expect(ids(await store.payments.list(a.id, { projectId: y.id }, page))).toEqual([p.id]);
      // The stored hint itself is untouched.
      expect(await store.payments.getById(a.id, p.id)).toMatchObject({ projectId: x.id });
    });

    it('the project filter still holds on the second page (it used to be dropped once a cursor was present)', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c, x } = await seed(store, a.id);
      const onX: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        onX.push((await store.payments.capture(capture(a.id, u.id, 100n, { customerId: c.id, projectId: x.id }), at(10 + i * 2))).payment.id);
        await store.payments.capture(capture(a.id, u.id, 100n, { customerId: c.id }), at(11 + i * 2));
      }
      const first = await store.payments.list(a.id, { projectId: x.id }, { limit: 2, cursor: null });
      expect(ids(first)).toEqual(onX.slice(0, 2));
      const second = await store.payments.list(a.id, { projectId: x.id }, { limit: 2, cursor: first.nextCursor });
      expect(ids(second)).toEqual(onX.slice(2));
    });
  });

  describe(`${name} LedgerStore re-date contract (MUT-223)`, () => {
    const owed = (organizationId: string, customerId: string, userId: string) =>
      ({ organizationId, customerId, projectId: null, currency: 'ILS', netMinor: 3000n, vatMinor: 0n, grossMinor: 3000n, vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: 'Consult', dueDate: '2026-11-15', postingDate: '2026-10-08', postedAt: at(20), createdByUserId: userId, requestId: null }) as const;

    it('redateAdjustment moves the posting date, keeps the due date and bumps the version', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c } = await seed(store, a.id);
      const r = await store.receivables.createAdjustment(owed(a.id, c.id, u.id), at(20));

      const result = await store.receivables.redateAdjustment(a.id, r.id, u.id, r.version, '2026-09-28');
      expect(result).toMatchObject({ kind: 'updated', record: { postingDate: '2026-09-28', dueDate: '2026-11-15', version: r.version + 1 } });
      expect(await store.receivables.getById(a.id, r.id)).toMatchObject({ postingDate: '2026-09-28', version: r.version + 1 });
    });

    it('redateAdjustment with a dueDate moves both in the same write (MUT-392 D3)', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c } = await seed(store, a.id);
      const r = await store.receivables.createAdjustment(owed(a.id, c.id, u.id), at(20));

      const result = await store.receivables.redateAdjustment(a.id, r.id, u.id, r.version, '2026-12-01', '2027-01-15');
      expect(result).toMatchObject({ kind: 'updated', record: { postingDate: '2026-12-01', dueDate: '2027-01-15', version: r.version + 1 } });
      expect(await store.receivables.getById(a.id, r.id)).toMatchObject({ postingDate: '2026-12-01', dueDate: '2027-01-15', version: r.version + 1 });
    });

    it('redateAdjustment with a stale version returns the current row and changes nothing', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c } = await seed(store, a.id);
      const r = await store.receivables.createAdjustment(owed(a.id, c.id, u.id), at(20));
      await store.receivables.redateAdjustment(a.id, r.id, u.id, r.version, '2026-10-01');

      const result = await store.receivables.redateAdjustment(a.id, r.id, u.id, r.version, '2026-09-01');
      expect(result).toMatchObject({ kind: 'stale', record: { postingDate: '2026-10-01', version: r.version + 1 } });
    });

    it('redateAdjustment answers not_found for another person, a Malafat receivable or a voided entry', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const other = await person(store, a.id, 'Rami');
      const { c, receivable: installment } = await seed(store, a.id);
      const mine = await store.receivables.createAdjustment(owed(a.id, c.id, u.id), at(20));
      const voided = await store.receivables.createAdjustment(owed(a.id, c.id, u.id), at(21));
      await store.receivables.softDeleteAdjustment(a.id, voided.id, at(22));

      expect(await store.receivables.redateAdjustment(a.id, mine.id, other.id, mine.version, '2026-10-01')).toEqual({ kind: 'not_found' });
      expect(await store.receivables.redateAdjustment(a.id, installment.id, u.id, installment.version, '2026-10-01')).toEqual({ kind: 'not_found' });
      expect(await store.receivables.redateAdjustment(a.id, voided.id, u.id, voided.version, '2026-10-01')).toEqual({ kind: 'not_found' });
      expect(await store.receivables.getById(a.id, mine.id)).toMatchObject({ postingDate: '2026-10-08', version: mine.version });
    });

    it('redateCapture moves receivedOn, bumps the version and stamps updatedAt', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const p = (await store.payments.capture(capture(a.id, u.id, 500n), at(10))).payment;

      const result = await store.payments.redateCapture(a.id, p.id, u.id, p.version, '2026-10-02', at(40));
      expect(result).toMatchObject({ kind: 'updated', record: { receivedOn: '2026-10-02', version: p.version + 1, number: p.number, amountMinor: 500n } });
      if (result.kind !== 'updated') throw new Error('expected updated');
      expect(result.record.updatedAt.getTime()).toBe(at(40).getTime());
    });

    it('redateCapture with a stale version returns the current row and changes nothing', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const p = (await store.payments.capture(capture(a.id, u.id, 500n), at(10))).payment;
      await store.payments.redateCapture(a.id, p.id, u.id, p.version, '2026-10-02', at(40));

      expect(await store.payments.redateCapture(a.id, p.id, u.id, p.version, '2026-10-01', at(41))).toMatchObject({ kind: 'stale', record: { receivedOn: '2026-10-02' } });
    });

    it('redateCapture answers not_found for a Malafat payment, an undone capture or another person', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const other = await person(store, a.id, 'Rami');
      const { c, receivable } = await seed(store, a.id);
      const { payment: integration } = await store.payments.create({ organizationId: a.id, customerId: c.id, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-08', method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: receivable.id, amountMinor: 1000n }] }, at(10));
      const undone = (await store.payments.capture(capture(a.id, u.id, 500n), at(11))).payment;
      await store.payments.undoCapture(a.id, undone.id, u.id, at(12));
      const mine = (await store.payments.capture(capture(a.id, u.id, 500n), at(13))).payment;

      expect(await store.payments.redateCapture(a.id, integration.id, u.id, integration.version, '2026-10-01', at(40))).toEqual({ kind: 'not_found' });
      expect(await store.payments.redateCapture(a.id, undone.id, u.id, undone.version + 1, '2026-10-01', at(40))).toEqual({ kind: 'not_found' });
      expect(await store.payments.redateCapture(a.id, mine.id, other.id, mine.version, '2026-10-01', at(40))).toEqual({ kind: 'not_found' });
      expect(await store.payments.getById(a.id, mine.id)).toMatchObject({ receivedOn: '2026-10-08', version: mine.version });
    });

    it('redateCapture moves a settle payment and leaves its allocations and the receivable untouched', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const { c } = await seed(store, a.id);
      const r = await store.receivables.createAdjustment(owed(a.id, c.id, u.id), at(20));
      const { payment, allocations } = await store.payments.create({ organizationId: a.id, customerId: c.id, projectId: null, currency: 'ILS', amountMinor: 3000n, receivedOn: '2026-10-10', method: 'CASH', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: u.id, origin: 'CAPTURE', captureSource: null, allocations: [{ receivableId: r.id, amountMinor: 3000n }] }, at(21));
      const settled = await store.receivables.getById(a.id, r.id);

      const result = await store.payments.redateCapture(a.id, payment.id, u.id, payment.version, '2026-10-09', at(40));
      expect(result).toMatchObject({ kind: 'updated', record: { receivedOn: '2026-10-09', allocatedMinor: 3000n } });
      expect(await store.payments.listAllocations(a.id, payment.id)).toEqual(allocations);
      expect(await store.receivables.getById(a.id, r.id)).toEqual(settled);
    });

    it('MUT-340: capture answers the profile’s POSTED count after it; undone ones drop out', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      const first = await store.payments.capture(capture(a.id, u.id, 500n), at(10));
      const second = await store.payments.capture(capture(a.id, u.id, 500n), at(11));
      expect([first.postedCount, second.postedCount]).toEqual([1, 2]);
      await store.payments.undoCapture(a.id, second.payment.id, u.id, at(12));
      expect((await store.payments.capture(capture(a.id, u.id, 500n), at(13))).postedCount).toBe(2);
      const other = await org(store, 'Other');
      expect((await store.payments.capture(capture(other.id, u.id, 500n), at(14))).postedCount).toBe(1);
    });

    it('MUT-340: two captures at once never read the same count', async () => {
      const store = await makeStore();
      const a = await org(store);
      const u = await person(store, a.id);
      await store.payments.capture(capture(a.id, u.id, 500n), at(10));
      const counts = (await Promise.all([1, 2, 3, 4].map((i) => store.payments.capture(capture(a.id, u.id, 500n), at(10 + i))))).map((r) => r.postedCount);
      expect([...counts].sort()).toEqual([2, 3, 4, 5]);
    });
  });
}
