import { describe, expect, it } from 'vitest';
import type { LedgerStore, Organization, PageCursor } from '../ports.js';
import { UniqueViolation } from '../memory.js';

/**
 * Milestone 2 contract: customers, projects, external references, cursor
 * pagination and optimistic updates. Run by the same two runners as the M1
 * contract (memory always, Postgres with MUTABA3A_TEST_DATABASE_URL).
 */
export function describeLedgerStoreM2Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'UTC' });

  describe(`${name} LedgerStore M2 contract`, () => {
    it('creates and reads customers and projects inside one organization only', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      const c = await store.customers.create({ organizationId: a.id, name: 'Acme', email: null, phone: null, notes: null }, at(0));
      expect(c).toMatchObject({ organizationId: a.id, name: 'Acme', status: 'ACTIVE', version: 1, archivedAt: null });
      expect(await store.customers.getById(a.id, c.id)).toMatchObject({ id: c.id });
      expect(await store.customers.getById(b.id, c.id)).toBeNull();

      const p = await store.projects.create({ organizationId: a.id, customerId: c.id, name: 'Case', currency: 'ILS' }, at(1));
      expect(p).toMatchObject({ customerId: c.id, currency: 'ILS', status: 'ACTIVE', version: 1 });
      expect(await store.projects.getById(b.id, p.id)).toBeNull();
      expect(await store.projects.countActiveByCustomer(a.id, c.id)).toBe(1);
      expect(await store.projects.hasPostedActivity(a.id, p.id)).toBe(false);
    });

    it('links external references uniquely per (organization, provider, entityType, externalId) and once per entity', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      const c1 = await store.customers.create({ organizationId: a.id, name: 'One', email: null, phone: null, notes: null }, at(0));
      const c2 = await store.customers.create({ organizationId: a.id, name: 'Two', email: null, phone: null, notes: null }, at(1));
      const p1 = await store.projects.create({ organizationId: a.id, customerId: c1.id, name: 'P', currency: 'ILS' }, at(2));
      const cb = await store.customers.create({ organizationId: b.id, name: 'B-One', email: null, phone: null, notes: null }, at(3));

      await store.externalReferences.link({ organizationId: a.id, provider: 'MALAFAT', entityType: 'CUSTOMER', entityId: c1.id, externalId: 'ext-1' }, at(4));
      // same external id, other entity type: allowed (decision 1)
      await store.externalReferences.link({ organizationId: a.id, provider: 'MALAFAT', entityType: 'PROJECT', entityId: p1.id, externalId: 'ext-1' }, at(5));
      // same external id, other organization: allowed (isolation)
      await store.externalReferences.link({ organizationId: b.id, provider: 'MALAFAT', entityType: 'CUSTOMER', entityId: cb.id, externalId: 'ext-1' }, at(6));
      // same (org, provider, type, externalId) again → unique violation
      await expect(
        store.externalReferences.link({ organizationId: a.id, provider: 'MALAFAT', entityType: 'CUSTOMER', entityId: c2.id, externalId: 'ext-1' }, at(7)),
      ).rejects.toBeInstanceOf(UniqueViolation);
      // a second MALAFAT reference for an already-referenced entity → unique violation
      await expect(
        store.externalReferences.link({ organizationId: a.id, provider: 'MALAFAT', entityType: 'CUSTOMER', entityId: c1.id, externalId: 'ext-other' }, at(8)),
      ).rejects.toBeInstanceOf(UniqueViolation);

      expect(await store.externalReferences.findByExternalId(a.id, 'MALAFAT', 'CUSTOMER', 'ext-1')).toMatchObject({ entityId: c1.id });
      expect(await store.externalReferences.findByExternalId(a.id, 'MALAFAT', 'PROJECT', 'ext-1')).toMatchObject({ entityId: p1.id });
      expect(await store.externalReferences.findByExternalId(b.id, 'MALAFAT', 'PROJECT', 'ext-1')).toBeNull();
      const many = await store.externalReferences.findByExternalIds(a.id, 'MALAFAT', 'CUSTOMER', ['ext-1', 'ext-missing']);
      expect(many.map((r) => r.externalId)).toEqual(['ext-1']);
      const byEntity = await store.externalReferences.findByEntities(a.id, 'CUSTOMER', [c1.id, c2.id]);
      expect(byEntity.map((r) => [r.entityId, r.externalId])).toEqual([[c1.id, 'ext-1']]);
    });

    it('creates an entity and its reference atomically', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const c = await store.customers.create({ organizationId: a.id, name: 'Acme', email: null, phone: null, notes: null }, at(0), {
        provider: 'MALAFAT',
        externalId: 'ext-a',
      });
      expect(await store.externalReferences.findByExternalId(a.id, 'MALAFAT', 'CUSTOMER', 'ext-a')).toMatchObject({ entityId: c.id });
      await expect(
        store.customers.create({ organizationId: a.id, name: 'Dup', email: null, phone: null, notes: null }, at(1), { provider: 'MALAFAT', externalId: 'ext-a' }),
      ).rejects.toBeInstanceOf(UniqueViolation);
      // the failed create left no orphan customer behind
      const page = await store.customers.list(a.id, {}, { limit: 10, cursor: null });
      expect(page.items.map((x) => x.name)).toEqual(['Acme']);
    });

    it('updates optimistically: version increments, stale writes are refused without side effects', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const c = await store.customers.create({ organizationId: a.id, name: 'Acme', email: null, phone: null, notes: null }, at(0));
      const ok = await store.customers.update(a.id, c.id, 1, { name: 'Acme Ltd', email: 'a@x.io' }, at(1));
      expect(ok).toMatchObject({ kind: 'updated', record: { name: 'Acme Ltd', email: 'a@x.io', version: 2 } });
      const stale = await store.customers.update(a.id, c.id, 1, { name: 'Nope' }, at(2));
      expect(stale).toMatchObject({ kind: 'stale', record: { name: 'Acme Ltd', version: 2 } });
      expect(await store.customers.update(a.id, '00000000-0000-4000-8000-000000000000', 1, { name: 'x' }, at(3))).toEqual({ kind: 'not_found' });

      const p = await store.projects.create({ organizationId: a.id, customerId: c.id, name: 'P', currency: 'ILS' }, at(4));
      const pu = await store.projects.update(a.id, p.id, 1, { currency: 'USD' }, at(5));
      expect(pu).toMatchObject({ kind: 'updated', record: { currency: 'USD', version: 2 } });
    });

    it('archives idempotently and counts active projects per customer', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const c = await store.customers.create({ organizationId: a.id, name: 'Acme', email: null, phone: null, notes: null }, at(0));
      const p = await store.projects.create({ organizationId: a.id, customerId: c.id, name: 'P', currency: 'ILS' }, at(1));
      expect(await store.projects.countActiveByCustomer(a.id, c.id)).toBe(1);
      const archived = await store.projects.archive(a.id, p.id, at(2));
      expect(archived).toMatchObject({ status: 'ARCHIVED', version: 2 });
      expect(archived?.archivedAt?.getTime()).toBe(at(2).getTime());
      const again = await store.projects.archive(a.id, p.id, at(3));
      expect(again?.archivedAt?.getTime()).toBe(at(2).getTime());
      expect(again?.version).toBe(2);
      expect(await store.projects.countActiveByCustomer(a.id, c.id)).toBe(0);
      expect(await store.customers.archive(a.id, c.id, at(4))).toMatchObject({ status: 'ARCHIVED' });
      expect(await store.customers.archive(a.id, '00000000-0000-4000-8000-000000000000', at(4))).toBeNull();
    });

    it('filters lists by status, customer, currency and external id', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const c1 = await store.customers.create({ organizationId: a.id, name: 'One', email: null, phone: null, notes: null }, at(0), { provider: 'MALAFAT', externalId: 'x1' });
      const c2 = await store.customers.create({ organizationId: a.id, name: 'Two', email: null, phone: null, notes: null }, at(1));
      await store.customers.archive(a.id, c2.id, at(2));
      const p1 = await store.projects.create({ organizationId: a.id, customerId: c1.id, name: 'P1', currency: 'ILS' }, at(3), { provider: 'MALAFAT', externalId: 'y1' });
      await store.projects.create({ organizationId: a.id, customerId: c1.id, name: 'P2', currency: 'USD' }, at(4));
      await store.projects.create({ organizationId: a.id, customerId: c2.id, name: 'P3', currency: 'ILS' }, at(5));

      const ids = (items: { id: string }[]) => items.map((i) => i.id);
      expect(ids((await store.customers.list(a.id, { status: 'ARCHIVED' }, { limit: 10, cursor: null })).items)).toEqual([c2.id]);
      expect(ids((await store.customers.list(a.id, { provider: 'MALAFAT', externalId: 'x1' }, { limit: 10, cursor: null })).items)).toEqual([c1.id]);
      expect(ids((await store.customers.list(a.id, { provider: 'MALAFAT', externalId: 'nope' }, { limit: 10, cursor: null })).items)).toEqual([]);
      expect((await store.projects.list(a.id, { customerId: c1.id }, { limit: 10, cursor: null })).items).toHaveLength(2);
      expect((await store.projects.list(a.id, { currency: 'ILS' }, { limit: 10, cursor: null })).items).toHaveLength(2);
      expect(ids((await store.projects.list(a.id, { provider: 'MALAFAT', externalId: 'y1' }, { limit: 10, cursor: null })).items)).toEqual([p1.id]);
    });

    it('paginates by (createdAt, id) with no gaps or repeats, including equal timestamps', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      await store.customers.create({ organizationId: b.id, name: 'other org', email: null, phone: null, notes: null }, at(0));
      const created: string[] = [];
      for (let i = 0; i < 23; i += 1) {
        // five share one millisecond on purpose
        const c = await store.customers.create({ organizationId: a.id, name: `C${i}`, email: null, phone: null, notes: null }, at(Math.floor(i / 5)));
        created.push(c.id);
      }
      const seen: string[] = [];
      let cursor: PageCursor | null = null;
      let pages = 0;
      do {
        const page = await store.customers.list(a.id, {}, { limit: 10, cursor });
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(23);
      expect(seen.sort()).toEqual([...created].sort());
      // ordering is stable: createdAt asc, then id asc
      const first = await store.customers.list(a.id, {}, { limit: 23, cursor: null });
      const keys = first.items.map((i) => `${i.createdAt.toISOString()}|${i.id}`);
      expect(keys).toEqual([...keys].sort());
    });
  });
}
