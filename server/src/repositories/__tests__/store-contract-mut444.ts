import { describe, expect, it } from 'vitest';
import { composeCorrection, correctionWrite, type CorrectTermsBody } from '../../agreements/correct-terms-compose.js';
import { InsufficientCapacity, LockConflict, StateConflict } from '../memory.js';
import type { AgreementRecord, CorrectAgreementInput, CreateInstallmentInput, CreatePaymentInput, LedgerStore, Organization } from '../ports.js';

/**
 * MUT-444 storage contract (ADR-226): `agreements.correct` voids every live line, credits each old charge on its own
 * posting date, posts the new lines, releases the old allocations and places them on the new charges, in one write
 * or none; every allocation reader counts live rows only (D1, R2); the cancel is version-conditional (R11); and the
 * correction races every writer of the rows it touches without a half write or a deadlock (R10).
 *
 * The fixture: a ₪1,000 VAT-exempt fee, ₪600 "On signing" (IMMEDIATE, posted 2026-10-01) and ₪400 "On judgment"
 * (MANUAL). Payment P (₪500) has ₪300 on the signing charge. The correction raises the fee to ₪1,200: ₪800 + ₪400.
 */
export function describeLedgerStoreMut444Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 29, 9, 0, 0, ms));
  const TODAY = '2026-10-29';
  const inst = (position: number, amount: bigint, trigger: 'MANUAL' | 'IMMEDIATE', label: string): CreateInstallmentInput => ({ position, label, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: trigger, triggerDate: null, paymentTerms: null, dueDateOverride: null });

  async function firm(store: LedgerStore, opts: { agreementDate?: string; postingDate?: string; contingency?: boolean } = {}) {
    const o: Organization = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const c = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at(0));
    const p = await store.projects.create({ organizationId: o.id, customerId: c.id, name: 'Case', currency: 'ILS' }, at(1));
    const agreementDate = opts.agreementDate ?? '2026-10-01';
    const { agreement, installments } = await store.agreements.create(
      {
        organizationId: o.id, projectId: p.id, customerId: c.id, type: opts.contingency ? 'CONTINGENCY' : 'FIXED', currency: 'ILS', pricingBasis: 'VAT_INCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0,
        amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 0n, grossMinor: 100_000n, agreementDate, description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null,
        ...(opts.contingency ? { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' as const } : {}),
        installments: [inst(1, 60_000n, 'IMMEDIATE', 'On signing'), inst(2, 40_000n, 'MANUAL', 'On judgment')],
      },
      at(2),
    );
    const postingDate = opts.postingDate ?? agreementDate;
    const signing = (await store.agreements.postInstallment(o.id, installments[0]!.id, { postingDate, dueDate: '2026-10-31', at: at(3) }))!.receivable;
    const payment = (amountMinor: bigint, allocations: Array<{ receivableId: string; amountMinor: bigint }>, receivedOn = '2026-10-05'): CreatePaymentInput => ({ organizationId: o.id, customerId: c.id, projectId: null, currency: 'ILS', amountMinor, receivedOn, method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations });
    const P = (await store.payments.create(payment(50_000n, [{ receivableId: signing.id, amountMinor: 30_000n }]), at(4))).payment;
    const agreementNow = async () => (await store.agreements.getById(o.id, agreement.id))!;
    return { o, c, p, agreement, installments, signing, P, payment, agreementNow };
  }
  type Firm = Awaited<ReturnType<typeof firm>>;

  const raise: CorrectTermsBody = { amount: '1200.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'On signing', amount: '800.00', trigger: { type: 'IMMEDIATE' } }, { label: 'On judgment', amount: '400.00', trigger: { type: 'MANUAL' } }] };

  /** Compose the correction against the ledger as it stands, the way the route does. */
  async function compose(store: LedgerStore, f: Firm, body: CorrectTermsBody = raise, agreement?: AgreementRecord): Promise<CorrectAgreementInput> {
    const a = agreement ?? (await f.agreementNow());
    const c = await composeCorrection(store, f.o, a, body, TODAY);
    return correctionWrite(c, a, { reasonCode: 'ENTERED_BY_MISTAKE', note: null }, TODAY, 'req-444');
  }

  /** Everything a stale correction must leave exactly as it was. */
  async function ledger(store: LedgerStore, f: Firm) {
    const agreement = await f.agreementNow();
    const installments = (await store.agreements.listInstallments(f.o.id, f.agreement.id)).map((i) => [i.id, i.version, i.receivableId, i.voidedAt?.getTime() ?? null]);
    const receivables = (await store.receivables.list(f.o.id, { customerId: f.c.id }, { limit: 100, cursor: null })).items.map((r) => [r.id, r.number, r.paidMinor, r.creditedMinor, r.status, r.version]);
    const payments = (await store.payments.list(f.o.id, { customerId: f.c.id }, { limit: 100, cursor: null })).items.map((p) => [p.id, p.status, p.allocatedMinor, p.version]);
    const allocations = (await store.payments.listAllocationsFor(f.o.id, payments.map((p) => p[0] as string))).map((a) => [a.id, a.receivableId, a.amountMinor]);
    const credits = (await store.receivables.statementSources(f.o.id, f.c.id, 'ILS')).credits.map((x) => x.id).sort();
    return { agreement: [agreement.version, agreement.amountMinor, agreement.grossMinor], installments, receivables, payments, allocations, credits, supplements: (await store.agreements.listSupplements(f.o.id, f.agreement.id)).length };
  }

  /** Σ live allocations of POSTED payments = each receivable's paid, and = each payment's allocated. */
  async function sumsEqualRows(store: LedgerStore, f: Firm): Promise<void> {
    const sources = await store.receivables.statementSources(f.o.id, f.c.id, 'ILS');
    const posted = new Set(sources.payments.filter((p) => p.status === 'POSTED').map((p) => p.id));
    for (const r of sources.receivables) expect(sources.allocations.filter((a) => a.receivableId === r.id && posted.has(a.paymentId)).reduce((s, a) => s + a.amountMinor, 0n)).toBe(r.paidMinor);
    for (const p of sources.payments.filter((x) => x.status === 'POSTED')) expect(sources.allocations.filter((a) => a.paymentId === p.id).reduce((s, a) => s + a.amountMinor, 0n)).toBe(p.allocatedMinor);
    for (const r of sources.receivables) expect(r.paidMinor + r.creditedMinor <= r.grossMinor).toBe(true);
  }

  describe(`${name} LedgerStore MUT-444 contract`, () => {
    it('correct voids every line, credits the old charge on its own date, reposts and moves the payment, in one write', async () => {
      const store = await makeStore();
      const f = await firm(store);
      const input = await compose(store, f);
      const result = await store.agreements.correct(f.o.id, f.agreement.id, input, at(10));
      if (result.kind !== 'updated') throw new Error(`expected updated, got ${result.kind}`);
      const { record } = result;

      expect(record.agreement).toMatchObject({ version: f.agreement.version + 1, amountMinor: 120_000n, grossMinor: 120_000n, status: 'ACTIVE' });
      const lines = record.installments;
      expect(lines.map((i) => [i.position, i.label, i.grossMinor, i.voidedAt !== null, i.receivableId !== null])).toEqual([
        [1, 'On signing', 60_000n, true, true],
        [2, 'On judgment', 40_000n, true, false],
        [3, 'On signing', 80_000n, false, true],
        [4, 'On judgment', 40_000n, false, false],
      ]);
      expect(lines[0]!.voidedAt!.getTime()).toBe(at(10).getTime());

      // D5 B: the credit is dated the old charge's posting date and created at the correction instant.
      expect(record.credits).toEqual([expect.objectContaining({ receivableId: f.signing.id, amountMinor: 60_000n, netMinor: 60_000n, vatMinor: 0n, effectiveDate: '2026-10-01', reason: 'ENTERED_BY_MISTAKE', reasonCode: 'ENTERED_BY_MISTAKE' })]);
      expect(record.credits[0]!.createdAt.getTime()).toBe(at(10).getTime());
      expect(await store.receivables.getById(f.o.id, f.signing.id)).toMatchObject({ paidMinor: 0n, creditedMinor: 60_000n, status: 'SETTLED' });

      // The repost: the original date, the next CHG number, created a millisecond after the credit.
      expect(record.receivables).toEqual([expect.objectContaining({ id: lines[2]!.receivableId, grossMinor: 80_000n, paidMinor: 30_000n, postingDate: '2026-10-01', dueDate: '2026-10-31', number: 'CHG-2026-0002', status: 'OPEN' })]);
      expect(record.receivables[0]!.createdAt.getTime()).toBe(at(10).getTime() + 1);

      // D1: the payment's live rows name the new charge; its total and version moved once.
      expect(record.allocations.map((a) => [a.paymentId, a.receivableId, a.amountMinor])).toEqual([[f.P.id, lines[2]!.receivableId, 30_000n]]);
      expect((await store.payments.listAllocations(f.o.id, f.P.id)).map((a) => [a.receivableId, a.amountMinor])).toEqual([[lines[2]!.receivableId, 30_000n]]);
      expect(record.payments).toEqual([expect.objectContaining({ id: f.P.id, allocatedMinor: 30_000n, version: f.P.version + 1 })]);
      expect(record.settled).toEqual([f.signing.id]);

      expect(record.supplement).toMatchObject({ distribution: 'CORRECTION', amountMinor: 20_000n, resultingAmountMinor: 120_000n, reasonCode: 'ENTERED_BY_MISTAKE', appliedGrossMinor: -20_000n, creditedMinor: 60_000n });
      await sumsEqualRows(store, f);
    });

    it('a new charge paid in full is reported settled', async () => {
      const store = await makeStore();
      const f = await firm(store);
      const lower: CorrectTermsBody = { amount: '500.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'On signing', amount: '200.00', trigger: { type: 'IMMEDIATE' } }, { label: 'On judgment', amount: '300.00', trigger: { type: 'MANUAL' } }] };
      const result = await store.agreements.correct(f.o.id, f.agreement.id, await compose(store, f, lower), at(10));
      if (result.kind !== 'updated') throw new Error(result.kind);
      const repost = result.record.receivables[0]!;
      expect(repost).toMatchObject({ grossMinor: 20_000n, paidMinor: 20_000n, status: 'SETTLED' });
      expect([...result.record.settled].sort()).toEqual([f.signing.id, repost.id].sort());
      // ₪100 of P's ₪300 found no charge: it is unallocated again.
      expect(await store.payments.getById(f.o.id, f.P.id)).toMatchObject({ allocatedMinor: 20_000n });
      await sumsEqualRows(store, f);
    });

    describe('all or nothing: each stale cause leaves every table as it was', () => {
      async function expectStale(store: LedgerStore, f: Firm, input: CorrectAgreementInput) {
        const before = await ledger(store, f);
        expect(await store.agreements.correct(f.o.id, f.agreement.id, input, at(20))).toEqual({ kind: 'stale' });
        expect(await ledger(store, f)).toEqual(before);
      }

      it('the agreement version', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        await expectStale(store, f, { ...input, expectedVersion: input.expectedVersion + 1 });
      });

      it('an installment version', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        await expectStale(store, f, { ...input, voids: input.voids.map((v, k) => (k === 1 ? { ...v, expectedVersion: v.expectedVersion + 1 } : v)) });
      });

      it("an old receivable's version (a credit landed since)", async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        await store.receivables.credit(f.o.id, f.signing.id, { amountMinor: 100n, netMinor: 100n, vatMinor: 0n, reason: 'x', effectiveDate: TODAY, requestId: null }, at(15));
        await expectStale(store, f, input);
      });

      it('a payment reversed since (its receivables re-read)', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        await store.payments.reverse(f.o.id, f.P.id, 'bounced', at(15));
        const fresh = (await store.receivables.getByIds(f.o.id, input.receivables.map((r) => r.id))).map((r) => ({ id: r.id, version: r.version }));
        await expectStale(store, f, { ...input, receivables: fresh });
      });

      it("a payment whose allocatedMinor changed (allocated to another agreement's charge)", async () => {
        const store = await makeStore();
        const f = await firm(store);
        const other = await store.agreements.create({ organizationId: f.o.id, projectId: f.p.id, customerId: f.c.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_INCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 10_000n, netMinor: 10_000n, vatMinor: 0n, grossMinor: 10_000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments: [inst(1, 10_000n, 'IMMEDIATE', 'Other')] }, at(5));
        const charge = (await store.agreements.postInstallment(f.o.id, other.installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-31', at: at(6) }))!.receivable;
        const input = await compose(store, f);
        await store.payments.allocate(f.o.id, f.P.id, [{ receivableId: charge.id, amountMinor: 5_000n }], at(15));
        await expectStale(store, f, input);
      });

      it('a row already released', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const first = await compose(store, f);
        expect((await store.agreements.correct(f.o.id, f.agreement.id, first, at(10))).kind).toBe('updated');
        const again = await compose(store, f, { ...raise, amount: '1300.00', installments: [{ label: 'On signing', amount: '900.00', trigger: { type: 'IMMEDIATE' } }, { label: 'On judgment', amount: '400.00', trigger: { type: 'MANUAL' } }] });
        // The second correction also names the first one's released row: nothing else is stale.
        await expectStale(store, f, { ...again, releases: [...again.releases, first.releases[0]!] });
      });

      it('P3 (review): a placement for a payment the write does not lock and re-check', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const Q = (await store.payments.create(f.payment(5_000n, []), at(5))).payment;
        const input = await compose(store, f);
        const repost = input.newInstallments.find((i) => i.post)!;
        await expectStale(store, f, { ...input, placements: [...input.placements, { paymentId: Q.id, installmentId: repost.id, amountMinor: 1_000n }] });
        expect(await store.payments.getById(f.o.id, Q.id)).toMatchObject({ allocatedMinor: 0n, version: Q.version });
      });

      it('is not_found for another organization', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const other = await store.organizations.create({ name: 'Other', slug: `other-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
        expect(await store.agreements.correct(other.id, f.agreement.id, await compose(store, f), at(20))).toEqual({ kind: 'not_found' });
      });
    });

    it('sums equal rows after correction → reversal → a new allocation', async () => {
      const store = await makeStore();
      const f = await firm(store);
      const done = await store.agreements.correct(f.o.id, f.agreement.id, await compose(store, f), at(10));
      if (done.kind !== 'updated') throw new Error(done.kind);
      const repost = done.record.receivables[0]!;
      // A reversal releases only the live rows: the new charge reopens, the old one stays credited.
      await store.payments.reverse(f.o.id, f.P.id, 'bounced', at(20));
      expect(await store.receivables.getById(f.o.id, repost.id)).toMatchObject({ paidMinor: 0n, status: 'OPEN' });
      expect(await store.receivables.getById(f.o.id, f.signing.id)).toMatchObject({ paidMinor: 0n, creditedMinor: 60_000n, status: 'SETTLED' });
      await store.payments.create(f.payment(80_000n, [{ receivableId: repost.id, amountMinor: 80_000n }]), at(30));
      expect(await store.receivables.getById(f.o.id, repost.id)).toMatchObject({ paidMinor: 80_000n, status: 'SETTLED' });
      await sumsEqualRows(store, f);
    });

    describe('every allocation reader counts live rows only (R2)', () => {
      it('listAllocations, listAllocationsFor and statementSources', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const done = await store.agreements.correct(f.o.id, f.agreement.id, await compose(store, f), at(10));
        if (done.kind !== 'updated') throw new Error(done.kind);
        const live = [[f.P.id, done.record.receivables[0]!.id, 30_000n]];
        expect((await store.payments.listAllocations(f.o.id, f.P.id)).map((a) => [a.paymentId, a.receivableId, a.amountMinor])).toEqual(live);
        expect((await store.payments.listAllocationsFor(f.o.id, [f.P.id])).map((a) => [a.paymentId, a.receivableId, a.amountMinor])).toEqual(live);
        expect((await store.receivables.statementSources(f.o.id, f.c.id, 'ILS')).allocations.map((a) => [a.paymentId, a.receivableId, a.amountMinor])).toEqual(live);
        expect(await store.payments.listLiveAllocationsOn(f.o.id, [f.signing.id])).toEqual([]);
        expect((await store.payments.listLiveAllocationsOn(f.o.id, [done.record.receivables[0]!.id])).map((x) => [x.allocation.amountMinor, x.payment.number, x.payment.allocatedMinor])).toEqual([[30_000n, f.P.number, 30_000n]]);
      });

      it('payments.list by project leaves out a payment whose only rows were released', async () => {
        const store = await makeStore();
        const f = await firm(store);
        // R pays ₪100 more on the signing charge a day after P. Lowering that line to ₪1 leaves room for P's first agora only.
        const R = (await store.payments.create(f.payment(10_000n, [{ receivableId: f.signing.id, amountMinor: 10_000n }], '2026-10-06'), at(5))).payment;
        const tiny: CorrectTermsBody = { amount: '401.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'On signing', amount: '1.00', trigger: { type: 'IMMEDIATE' } }, { label: 'On judgment', amount: '400.00', trigger: { type: 'MANUAL' } }] };
        const done = await store.agreements.correct(f.o.id, f.agreement.id, await compose(store, f, tiny), at(10));
        if (done.kind !== 'updated') throw new Error(done.kind);
        expect(await store.payments.getById(f.o.id, R.id)).toMatchObject({ allocatedMinor: 0n });
        expect(await store.payments.listAllocations(f.o.id, R.id)).toEqual([]);
        expect((await store.payments.list(f.o.id, { projectId: f.p.id }, { limit: 50, cursor: null })).items.map((p) => p.id)).toEqual([f.P.id]);
        await sumsEqualRows(store, f);
      });

      it("a MUT-443 correction of a moved payment releases only its live rows", async () => {
        const store = await makeStore();
        const f = await firm(store);
        const done = await store.agreements.correct(f.o.id, f.agreement.id, await compose(store, f), at(10));
        if (done.kind !== 'updated') throw new Error(done.kind);
        const repost = done.record.receivables[0]!;
        const moved = (await store.payments.getById(f.o.id, f.P.id))!;
        const { replacesPaymentId: _r, ...replacement } = f.payment(50_000n, [{ receivableId: repost.id, amountMinor: 50_000n }]);
        void _r;
        const corrected = await store.payments.correct(f.o.id, f.P.id, { expectedVersion: moved.version, reason: 'x', reasonCode: 'ENTERED_BY_MISTAKE', replacement }, at(20));
        expect(corrected!.payment.allocatedMinor).toBe(50_000n);
        expect(await store.receivables.getById(f.o.id, repost.id)).toMatchObject({ paidMinor: 50_000n });
        expect(await store.receivables.getById(f.o.id, f.signing.id)).toMatchObject({ paidMinor: 0n, creditedMinor: 60_000n });
        await sumsEqualRows(store, f);
      });
    });

    it('numbering: a repost takes the next number of its posting year, with no gap', async () => {
      const store = await makeStore();
      const f = await firm(store, { agreementDate: '2025-12-01', postingDate: '2025-12-20' });
      expect(f.signing.number).toBe('CHG-2025-0001');
      const done = await store.agreements.correct(f.o.id, f.agreement.id, await compose(store, f), at(10));
      if (done.kind !== 'updated') throw new Error(done.kind);
      expect(done.record.receivables[0]).toMatchObject({ postingDate: '2025-12-20', number: 'CHG-2025-0002' });
      const later = (await store.agreements.postInstallment(f.o.id, done.record.installments.find((i) => i.position === 4)!.id, { postingDate: TODAY, dueDate: '2026-10-31', at: at(20) }))!.receivable;
      expect(later.number).toBe('CHG-2026-0001');
    });

    it('cancel is conditional on the version read (R11): an older version cancels nothing', async () => {
      const store = await makeStore();
      const o = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const c = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null }, at(0));
      const p = await store.projects.create({ organizationId: o.id, customerId: c.id, name: 'Case', currency: 'ILS' }, at(1));
      const { agreement } = await store.agreements.create({ organizationId: o.id, projectId: p.id, customerId: c.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_INCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, grossMinor: 1_000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments: [inst(1, 1_000n, 'MANUAL', 'Later')] }, at(2));
      const stale = await store.agreements.cancel(o.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null, expectedVersion: agreement.version + 1 }, at(3));
      expect(stale).toMatchObject({ status: 'ACTIVE', version: agreement.version });
      expect((await store.agreements.listInstallments(o.id, agreement.id))[0]!.voidedAt).toBeNull();
      expect(await store.agreements.cancel(o.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null, expectedVersion: agreement.version }, at(4))).toMatchObject({ status: 'CANCELLED' });
    });

    it('the records export leaves out a released row and has no releasedAt (R14, TD-287)', async () => {
      const store = await makeStore();
      const f = await firm(store);
      const done = await store.agreements.correct(f.o.id, f.agreement.id, await compose(store, f), at(10));
      if (done.kind !== 'updated') throw new Error(done.kind);
      const page = await store.recordsExport.profilePage(f.o.id, 'allocs', null, 100);
      expect(page.entries.map(([, a]) => [a.receivableId, a.amountMinor])).toEqual([[done.record.receivables[0]!.id, 30_000n]]);
      for (const [, a] of page.entries) expect(Object.keys(a)).not.toContain('releasedAt');
    });

    describe('races (R10): exactly one side wins, the loser is stale or refused, never a half write', () => {
      /** Only these may lose: anything else (a 500) fails the test. */
      const expectedLoss = (r: PromiseSettledResult<unknown>) => r.status === 'fulfilled' || r.reason instanceof InsufficientCapacity || r.reason instanceof StateConflict || r.reason instanceof LockConflict;
      const corrected = (r: PromiseSettledResult<unknown>) => r.status === 'fulfilled' && (r.value as { kind: string }).kind === 'updated';

      it('postInstallment on an old unposted line', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        const line = f.installments[1]!;
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), store.agreements.postInstallment(f.o.id, line.id, { postingDate: TODAY, dueDate: '2026-10-31', at: at(11), expectedVersion: line.version })]);
        expect(results.every(expectedLoss)).toBe(true);
        const posted = results[1].status === 'fulfilled' && results[1].value !== null && results[1].value.created;
        expect(corrected(results[0]) && posted).toBe(false);
        expect(corrected(results[0]) || posted).toBe(true);
        await sumsEqualRows(store, f);
      });

      it('payments.allocate onto an old charge', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), store.payments.allocate(f.o.id, f.P.id, [{ receivableId: f.signing.id, amountMinor: 10_000n }], at(11))]);
        expect(results.every(expectedLoss)).toBe(true);
        expect(corrected(results[0]) && results[1].status === 'fulfilled').toBe(false);
        await sumsEqualRows(store, f);
      });

      it('payments.correct of a moved payment', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        const { replacesPaymentId: _r, ...replacement } = f.payment(50_000n, [{ receivableId: f.signing.id, amountMinor: 50_000n }]);
        void _r;
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), store.payments.correct(f.o.id, f.P.id, { expectedVersion: f.P.version, reason: 'x', reasonCode: 'ENTERED_BY_MISTAKE', replacement }, at(11))]);
        expect(results.every(expectedLoss)).toBe(true);
        expect(corrected(results[0]) && results[1].status === 'fulfilled').toBe(false);
        await sumsEqualRows(store, f);
      });

      it('payments.reverse of a moved payment', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), store.payments.reverse(f.o.id, f.P.id, 'bounced', at(11))]);
        expect(results.every(expectedLoss)).toBe(true);
        // Both may land (a reversal after the correction releases the new rows); the ledger adds up either way.
        expect(await store.payments.getById(f.o.id, f.P.id)).toMatchObject({ status: 'REVERSED', allocatedMinor: 0n });
        await sumsEqualRows(store, f);
      });

      it('receivables.credit on an old charge', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), store.receivables.credit(f.o.id, f.signing.id, { amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, reason: 'x', effectiveDate: TODAY, requestId: null }, at(11))]);
        expect(results.every(expectedLoss)).toBe(true);
        expect(corrected(results[0]) && results[1].status === 'fulfilled').toBe(false);
        const old = (await store.receivables.getById(f.o.id, f.signing.id))!;
        expect(old.paidMinor + old.creditedMinor <= old.grossMinor).toBe(true);
        await sumsEqualRows(store, f);
      });

      it('agreements.reduce', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        const judgment = (await store.agreements.listInstallments(f.o.id, f.agreement.id))[1]!;
        const reduce = store.agreements.reduce(f.o.id, f.agreement.id, { expectedVersion: f.agreement.version, installmentUpdates: [], voids: [{ id: judgment.id, expectedVersion: judgment.version }], receivables: [{ id: f.signing.id, version: (await store.receivables.getById(f.o.id, f.signing.id))!.version }], credits: [], credit: { reason: 'x', reasonCode: 'DISCOUNT', effectiveDate: TODAY, requestId: null }, supplement: { amountMinor: -40_000n, description: null, effectiveDate: TODAY, distribution: 'REDUCTION', requestId: null, reasonCode: 'DISCOUNT', appliedGrossMinor: 40_000n, creditedMinor: 0n }, totals: { amountMinor: 60_000n, netMinor: 60_000n, vatMinor: 0n, grossMinor: 60_000n } }, at(11));
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), reduce]);
        expect(results.every(expectedLoss)).toBe(true);
        expect(corrected(results[0]) && corrected(results[1])).toBe(false);
        expect(await store.agreements.listSupplements(f.o.id, f.agreement.id)).toHaveLength(1);
      });

      it('recordOutcome on a contingency agreement', async () => {
        const store = await makeStore();
        const f = await firm(store, { contingency: true });
        const input = await compose(store, f);
        const outcome = store.agreements.recordOutcome(f.o.id, f.agreement.id, { outcome: 'NO_RECOVERY', outcomeDate: TODAY, awardedAmountMinor: null, outcomeNote: null, commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', commissionInstallment: null, totals: { amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 0n, grossMinor: 100_000n }, upfrontReceivables: [{ id: f.signing.id, version: (await store.receivables.getById(f.o.id, f.signing.id))!.version }], expectedVersion: f.agreement.version }, at(11));
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), outcome]);
        expect(results.every(expectedLoss)).toBe(true);
        expect(corrected(results[0]) && corrected(results[1])).toBe(false);
        expect(corrected(results[0]) || corrected(results[1])).toBe(true);
      });

      it('cancel, version-conditional', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const input = await compose(store, f);
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), store.agreements.cancel(f.o.id, f.agreement.id, { cancelEffectiveMonth: null, finalMonth: null, expectedVersion: f.agreement.version }, at(11))]);
        expect(results.every(expectedLoss)).toBe(true);
        const cancelled = results[1].status === 'fulfilled' && results[1].value?.status === 'CANCELLED';
        expect(corrected(results[0]) && cancelled).toBe(false);
        expect(corrected(results[0]) || cancelled).toBe(true);
      });

      it('a lazy post on another agreement in the same organization (one CHG counter, no deadlock)', async () => {
        const store = await makeStore();
        const f = await firm(store);
        const other = await store.agreements.create({ organizationId: f.o.id, projectId: f.p.id, customerId: f.c.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_INCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 10_000n, netMinor: 10_000n, vatMinor: 0n, grossMinor: 10_000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments: [inst(1, 10_000n, 'IMMEDIATE', 'Other')] }, at(5));
        const input = await compose(store, f);
        const results = await Promise.allSettled([store.agreements.correct(f.o.id, f.agreement.id, input, at(10)), store.agreements.postInstallment(f.o.id, other.installments[0]!.id, { postingDate: TODAY, dueDate: '2026-10-31', at: at(11) })]);
        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(corrected(results[0])).toBe(true);
        const numbers = (await store.receivables.list(f.o.id, { customerId: f.c.id }, { limit: 50, cursor: null })).items.map((r) => r.number).sort();
        expect(numbers).toEqual(['CHG-2026-0001', 'CHG-2026-0002', 'CHG-2026-0003']);
      });
    });
  });
}
