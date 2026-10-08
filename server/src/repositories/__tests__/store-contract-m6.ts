import { describe, expect, it } from 'vitest';
import type { LedgerStore, Organization } from '../ports.js';

/** Milestone 6 storage contract: audit listing, attachments. */
export function describeLedgerStoreM6Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  describe(`${name} LedgerStore M6 contract`, () => {
    it('lists audit events by entity and action, oldest first, paginated and organization-scoped', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      for (let i = 0; i < 5; i += 1) await store.audit.append({ organizationId: a.id, actorType: 'API_KEY', actorId: 'k', action: i % 2 ? 'payment.recorded' : 'payment.reversed', entityType: 'payment', entityId: 'pay1', requestId: null });
      await store.audit.append({ organizationId: a.id, actorType: 'API_KEY', actorId: 'k', action: 'receivable.credited', entityType: 'receivable', entityId: 'r1', requestId: null });
      await store.audit.append({ organizationId: b.id, actorType: 'API_KEY', actorId: 'k', action: 'payment.recorded', entityType: 'payment', entityId: 'pay1', requestId: null });
      const first = await store.audit.list(a.id, { entityType: 'payment', entityId: 'pay1' }, { limit: 3, cursor: null });
      expect(first.items).toHaveLength(3);
      expect(first.nextCursor).not.toBeNull();
      const second = await store.audit.list(a.id, { entityType: 'payment', entityId: 'pay1' }, { limit: 3, cursor: first.nextCursor });
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      const all = [...first.items, ...second.items];
      for (let i = 1; i < all.length; i += 1) expect(all[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(all[i - 1]!.createdAt.getTime());
      expect((await store.audit.list(a.id, { action: 'payment.reversed' }, { limit: 10, cursor: null })).items).toHaveLength(3);
      expect((await store.audit.list(a.id, {}, { limit: 10, cursor: null })).items).toHaveLength(6);
      expect((await store.audit.list(b.id, { entityType: 'payment' }, { limit: 10, cursor: null })).items).toHaveLength(1);
    });

    it('creates attachments pending, keys them, completes them, lists READY ones per entity, soft-deletes', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const input = { organizationId: a.id, kind: 'RECEIPT' as const, filename: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 1234, customerId: null, projectId: null, paymentId: '00000000-0000-4000-8000-000000000001', invoiceNumber: null, invoiceDate: null, uploadedByKeyId: 'k1', requestId: 'req' };
      const created = await store.attachments.create(input, at(0));
      expect(created).toMatchObject({ status: 'PENDING_UPLOAD', storageKey: '', completedAt: null, deletedAt: null });
      const keyed = await store.attachments.setKey(a.id, created.id, `org/${a.id}/${created.id}`);
      expect(keyed!.storageKey).toBe(`org/${a.id}/${created.id}`);
      // pending ones are not listed
      expect((await store.attachments.list(a.id, { paymentId: input.paymentId! }, { limit: 10, cursor: null })).items).toEqual([]);
      const ready = await store.attachments.complete(a.id, created.id, at(1));
      expect(ready).toMatchObject({ status: 'READY', completedAt: at(1) });
      const listed = await store.attachments.list(a.id, { paymentId: input.paymentId! }, { limit: 10, cursor: null });
      expect(listed.items.map((x) => x.id)).toEqual([created.id]);
      expect((await store.attachments.list(a.id, { customerId: '00000000-0000-4000-8000-000000000002' }, { limit: 10, cursor: null })).items).toEqual([]);
      expect((await store.attachments.list(a.id, { paymentId: input.paymentId!, kind: 'INVOICE' }, { limit: 10, cursor: null })).items).toEqual([]);
      const other = await org(store, 'B');
      expect(await store.attachments.getById(other.id, created.id)).toBeNull();
      expect(await store.attachments.setKey(other.id, created.id, 'x')).toBeNull();
      const deleted = await store.attachments.softDelete(a.id, created.id, at(2));
      expect(deleted!.deletedAt).toEqual(at(2));
      expect(await store.attachments.getById(a.id, created.id)).toBeNull();
      expect((await store.attachments.list(a.id, { paymentId: input.paymentId! }, { limit: 10, cursor: null })).items).toEqual([]);
      expect(await store.attachments.softDelete(a.id, '00000000-0000-4000-8000-00000000dead', at(3))).toBeNull();
    });
  });
}
