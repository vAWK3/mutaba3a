import { describe, expect, it } from 'vitest';
import type { CreatePaymentInput, LedgerStore, Organization } from '../ports.js';

/** MUT-481 storage contract: a payment's receipt number is stored, filtered on exactly, and set later on its version. */
export function describeLedgerStoreMut481Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 28, 12, 0, 0, ms));
  const org = (store: LedgerStore): Promise<Organization> => store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function firm(store: LedgerStore) {
    const o = await org(store);
    const c = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null }, at(0));
    const pay = (receiptNumber: string | null, ms: number): Promise<{ payment: { id: string; version: number; receiptNumber: string | null } }> => {
      const input: CreatePaymentInput = { organizationId: o.id, customerId: c.id, projectId: null, currency: 'ILS', amountMinor: 100n, receivedOn: '2026-10-28', method: 'BANK', reference: null, receiptNumber, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [] };
      return store.payments.create(input, at(ms));
    };
    return { o, pay };
  }

  describe(`${name} LedgerStore MUT-481 contract`, () => {
    it('stores the receipt number, and lists by it exactly, never across organizations', async () => {
      const store = await makeStore();
      const { o, pay } = await firm(store);
      const a = await pay('2041', 1);
      await pay('20410', 2);
      await pay(null, 3);
      expect((await store.payments.getById(o.id, a.payment.id))!.receiptNumber).toBe('2041');
      const page = await store.payments.list(o.id, { receiptNumber: '2041' }, { limit: 50 });
      expect(page.items.map((p) => p.id)).toEqual([a.payment.id]);
      const other = await firm(store);
      await other.pay('2041', 4);
      expect((await store.payments.list(o.id, { receiptNumber: '2041' }, { limit: 50 })).items).toHaveLength(1);
    });

    it('setReceiptNumber writes on the version read and bumps it; another version is stale with the record', async () => {
      const store = await makeStore();
      const { o, pay } = await firm(store);
      const { payment } = await pay(null, 1);
      const set = await store.payments.setReceiptNumber(o.id, payment.id, payment.version, '2041', at(2));
      expect(set).toMatchObject({ kind: 'updated', record: { receiptNumber: '2041', version: payment.version + 1 } });
      const stale = await store.payments.setReceiptNumber(o.id, payment.id, payment.version, '2042', at(3));
      expect(stale).toMatchObject({ kind: 'stale', record: { receiptNumber: '2041', status: 'POSTED' } });
      const cleared = await store.payments.setReceiptNumber(o.id, payment.id, payment.version + 1, null, at(4));
      expect(cleared).toMatchObject({ kind: 'updated', record: { receiptNumber: null } });
    });

    it('setReceiptNumber on a reversed payment is stale with the REVERSED record, and not_found for another organization', async () => {
      const store = await makeStore();
      const { o, pay } = await firm(store);
      const { payment } = await pay('2041', 1);
      const reversed = await store.payments.reverse(o.id, payment.id, 'Bounced', at(2));
      const result = await store.payments.setReceiptNumber(o.id, payment.id, reversed!.payment.version, '2042', at(3));
      expect(result).toMatchObject({ kind: 'stale', record: { status: 'REVERSED', receiptNumber: '2041' } });
      expect(await store.payments.setReceiptNumber((await org(store)).id, payment.id, 1, '2042', at(4))).toEqual({ kind: 'not_found' });
    });
  });
}
