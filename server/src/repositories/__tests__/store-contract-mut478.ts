import { describe, expect, it } from 'vitest';
import type { CreateInstallmentInput, LedgerStore, Organization } from '../ports.js';

/** MUT-478 storage contract: receivable numbers at every posting site, and the rows a customer statement reads. */
export function describeLedgerStoreMut478Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 27, 10, 0, 0, ms));
  const org = (store: LedgerStore): Promise<Organization> => store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const inst = (position: number, amount: bigint): CreateInstallmentInput => ({ position, label: `I${position}`, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null });

  async function firm(store: LedgerStore, currency = 'ILS') {
    const o = await org(store);
    const c = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null }, at(0));
    const p = await store.projects.create({ organizationId: o.id, customerId: c.id, name: 'Sale', currency }, at(1));
    const agreement = (type: 'FIXED' | 'RECURRING', installments: CreateInstallmentInput[]) => {
      const amount = installments.reduce((a, i) => a + i.amountMinor, 0n) || 1000n;
      return store.agreements.create({ organizationId: o.id, projectId: p.id, customerId: c.id, type, currency, pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, agreementDate: '2026-01-01', description: null, paymentTerms: 'EOM', startMonth: type === 'RECURRING' ? '2026-01' : null, billingDay: type === 'RECURRING' ? 1 : null, endMonth: null, installments }, at(2));
    };
    return { o, c, p, agreement };
  }

  describe(`${name} LedgerStore MUT-478 contract`, () => {
    it('numbers receivables CHG-YYYY-NNNN at every posting site, gap-free per organization and posting year', async () => {
      const store = await makeStore();
      const { o, c, p, agreement } = await firm(store);
      const { installments } = await agreement('FIXED', [inst(1, 100n), inst(2, 200n)]);
      const first = await store.agreements.postInstallment(o.id, installments[0]!.id, { postingDate: '2026-02-01', dueDate: '2026-02-28', at: at(3) });
      const retainer = await agreement('RECURRING', []);
      const charge = await store.agreements.createPostedCharge({ organizationId: o.id, agreementId: retainer.agreement.id, customerId: c.id, projectId: p.id, currency: 'ILS', serviceMonth: '2026-03', chargeDate: '2026-03-01', amountMinor: 50n, netMinor: 50n, vatMinor: 0n, grossMinor: 50n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, dueDate: '2026-03-31' }, at(4));
      const owed = await store.receivables.createAdjustment({ organizationId: o.id, customerId: c.id, projectId: null, currency: 'ILS', netMinor: 10n, vatMinor: 0n, grossMinor: 10n, vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, title: 'Work', dueDate: '2026-04-01', postingDate: '2026-04-01', postedAt: at(5), createdByUserId: (await store.users.create({ email: `n-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: `p-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(5) })).user.id, requestId: null }, at(5));
      const nextYear = await store.agreements.postInstallment(o.id, installments[1]!.id, { postingDate: '2027-01-05', dueDate: '2027-01-31', at: at(6) });
      expect([first!.receivable.number, charge.receivable.number, owed.number, nextYear!.receivable.number]).toEqual(['CHG-2026-0001', 'CHG-2026-0002', 'CHG-2026-0003', 'CHG-2027-0001']);
      // A repeated post returns the existing receivable, so the counter does not move.
      const again = await store.agreements.postInstallment(o.id, installments[0]!.id, { postingDate: '2026-02-01', dueDate: '2026-02-28', at: at(7) });
      expect(again!.receivable.number).toBe('CHG-2026-0001');
      // Another organization counts from 1.
      const other = await firm(store);
      const { installments: theirs } = await other.agreement('FIXED', [inst(1, 100n)]);
      expect((await store.agreements.postInstallment(other.o.id, theirs[0]!.id, { postingDate: '2026-02-01', dueDate: '2026-02-28', at: at(8) }))!.receivable.number).toBe('CHG-2026-0001');
      expect((await store.receivables.getById(o.id, owed.id))!.number).toBe('CHG-2026-0003');
    });

    it('statementSources returns the customer\'s rows in one currency, payments of any status with their allocations', async () => {
      const store = await makeStore();
      const { o, c, agreement } = await firm(store);
      const { agreement: fixed, installments } = await agreement('FIXED', [inst(1, 100n), inst(2, 200n)]);
      const r1 = (await store.agreements.postInstallment(o.id, installments[0]!.id, { postingDate: '2026-02-01', dueDate: '2026-02-28', at: at(3) }))!.receivable;
      await store.receivables.credit(o.id, r1.id, { amountMinor: 10n, netMinor: 10n, vatMinor: 0n, reason: 'Goodwill', effectiveDate: '2026-02-10', requestId: null }, at(4));
      const pay = (amount: bigint, allocations: Array<{ receivableId: string; amountMinor: bigint }>, currency = 'ILS', customerId: string | null = c.id) =>
        store.payments.create({ organizationId: o.id, customerId, projectId: null, currency, amountMinor: amount, receivedOn: '2026-02-15', method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations }, at(5));
      const kept = await pay(50n, [{ receivableId: r1.id, amountMinor: 50n }]);
      const reversed = await pay(20n, [{ receivableId: r1.id, amountMinor: 20n }]);
      await store.payments.reverse(o.id, reversed.payment.id, 'Bounced', at(6));
      // Noise the statement must not read: another currency, and another customer.
      await pay(5n, [], 'USD');
      const stranger = await firm(store);
      await stranger.agreement('FIXED', [inst(1, 100n)]);

      const sources = await store.receivables.statementSources(o.id, c.id, 'ILS');
      expect(sources.receivables.map((r) => r.id)).toEqual([r1.id]);
      expect(sources.credits.map((x) => [x.receivableId, x.amountMinor])).toEqual([[r1.id, 10n]]);
      expect(sources.payments.map((p) => [p.id, p.status]).sort()).toEqual([[kept.payment.id, 'POSTED'], [reversed.payment.id, 'REVERSED']].sort());
      expect(sources.allocations.map((a) => [a.paymentId, a.amountMinor]).sort()).toEqual([[kept.payment.id, 50n], [reversed.payment.id, 20n]].sort());
      expect(sources.installments.map((i) => i.id).sort()).toEqual(installments.map((i) => i.id).sort());
      expect(sources.installments.every((i) => i.agreementId === fixed.id)).toBe(true);
      expect(sources.charges).toEqual([]);
    });
  });
}
