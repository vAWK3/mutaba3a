import { describe, expect, it } from 'vitest';
import type { LedgerStore } from '../ports.js';
import { UniqueViolation } from '../memory.js';

/**
 * Contract every LedgerStore implementation must satisfy. Run against the
 * memory store always, and against Postgres when a test database is present
 * (store-prisma.test.ts). The point is that a route test passing on the memory
 * store proves the same thing about production storage.
 */
export function describeLedgerStoreContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);

  describe(`${name} LedgerStore contract`, () => {
    it('creates organizations with unique slugs', async () => {
      const store = await makeStore();
      const slug = `firm-${unique()}`;
      const org = await store.organizations.create({ name: 'Firm', slug, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      expect(org.id).toMatch(/[0-9a-f-]{36}/);
      expect(await store.organizations.getBySlug(slug)).toMatchObject({ id: org.id });
      await expect(
        store.organizations.create({ name: 'Other', slug, defaultCurrency: 'USD', timezone: 'UTC' }),
      ).rejects.toBeInstanceOf(UniqueViolation);
    });

    it('stores API keys by unique prefix and hash, touches lastUsed, revokes once', async () => {
      const store = await makeStore();
      const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'UTC' });
      const prefix = unique();
      const key = await store.apiKeys.create({
        organizationId: org.id,
        name: 'Malafat',
        environment: 'test',
        prefix,
        keyHash: 'h'.repeat(60) + unique().slice(0, 4),
        scopes: ['integration:read'],
        expiresAt: null,
      });
      expect(await store.apiKeys.findByPrefix(prefix)).toMatchObject({ id: key.id, scopes: ['integration:read'], lastUsedAt: null });

      await store.apiKeys.touchLastUsed(key.id, new Date('2026-10-08T10:00:00Z'));
      expect((await store.apiKeys.getById(key.id))?.lastUsedAt?.toISOString()).toBe('2026-10-08T10:00:00.000Z');

      const t1 = new Date('2026-10-08T11:00:00Z');
      const revoked = await store.apiKeys.revoke(key.id, 'first', t1);
      expect(revoked?.revokedAt?.toISOString()).toBe(t1.toISOString());
      const again = await store.apiKeys.revoke(key.id, 'second', new Date('2026-10-08T12:00:00Z'));
      expect(again?.revokedReason).toBe('first');
      expect(again?.revokedAt?.toISOString()).toBe(t1.toISOString());

      await expect(
        store.apiKeys.create({ organizationId: org.id, name: 'dup', environment: 'test', prefix, keyHash: 'x'.repeat(64), scopes: [], expiresAt: null }),
      ).rejects.toBeInstanceOf(UniqueViolation);
      expect(await store.apiKeys.revoke('00000000-0000-4000-8000-000000000000', 'none', t1)).toBeNull();
    });

    it('connects, forbids a tenant bound to another organization, disconnects and reconnects keeping the id', async () => {
      const store = await makeStore();
      const a = await store.organizations.create({ name: 'A', slug: `a-${unique()}`, defaultCurrency: 'ILS', timezone: 'UTC' });
      const b = await store.organizations.create({ name: 'B', slug: `b-${unique()}`, defaultCurrency: 'ILS', timezone: 'UTC' });
      const tenant = `tenant-${unique()}`;
      const at = new Date('2026-10-08T10:00:00Z');

      const first = await store.integrations.connect({ organizationId: a.id, provider: 'MALAFAT', externalTenantId: tenant, displayName: 'Firm A', connectedByApiKeyId: null as unknown as string, at });
      expect(first.status).toBe('CONNECTED');
      expect(await store.integrations.findByProviderAndTenant('MALAFAT', tenant)).toMatchObject({ organizationId: a.id });

      await expect(
        store.integrations.connect({ organizationId: b.id, provider: 'MALAFAT', externalTenantId: tenant, displayName: 'Firm B', connectedByApiKeyId: null as unknown as string, at }),
      ).rejects.toBeInstanceOf(UniqueViolation);

      const off = await store.integrations.disconnect(first.id, new Date('2026-10-08T11:00:00Z'));
      expect(off?.status).toBe('DISCONNECTED');
      expect(off?.disconnectedAt).not.toBeNull();

      const again = await store.integrations.connect({ organizationId: a.id, provider: 'MALAFAT', externalTenantId: tenant, displayName: 'Firm A again', connectedByApiKeyId: null as unknown as string, at: new Date('2026-10-08T12:00:00Z') });
      expect(again.id).toBe(first.id);
      expect(again.status).toBe('CONNECTED');
      expect(again.disconnectedAt).toBeNull();
      expect(again.displayName).toBe('Firm A again');
    });

    it('appends audit events and lists newest first', async () => {
      const store = await makeStore();
      const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'UTC' });
      await store.audit.append({ organizationId: org.id, actorType: 'ADMIN', actorId: null, action: 'one', entityType: 'x', entityId: null, requestId: 'r1' });
      await store.audit.append({ organizationId: org.id, actorType: 'API_KEY', actorId: 'k', action: 'two', entityType: 'x', entityId: '1', metadata: { a: 1 }, requestId: null });
      const events = await store.audit.listByOrganization(org.id, 10);
      expect(events.map((e) => e.action)).toEqual(['two', 'one']);
      expect(events[0]?.metadata).toEqual({ a: 1 });
      expect(events[1]?.metadata).toBeUndefined();
    });

    it('idempotency: new → in_progress → replay; mismatch on a different fingerprint; fail releases', async () => {
      const store = await makeStore();
      const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'UTC' });
      const key = `idem-${unique()}`;
      const at = new Date();
      expect(await store.idempotency.claim({ organizationId: org.id, key, operation: 'op', fingerprint: 'f1', at })).toEqual({ kind: 'new' });
      expect(await store.idempotency.claim({ organizationId: org.id, key, operation: 'op', fingerprint: 'f1', at })).toEqual({ kind: 'in_progress' });
      expect(await store.idempotency.claim({ organizationId: org.id, key, operation: 'op', fingerprint: 'f2', at })).toEqual({ kind: 'mismatch' });
      expect(await store.idempotency.claim({ organizationId: org.id, key, operation: 'other', fingerprint: 'f1', at })).toEqual({ kind: 'mismatch' });

      await store.idempotency.complete({ organizationId: org.id, key, responseStatus: 201, responseBody: { ok: true }, at });
      const replay = await store.idempotency.claim({ organizationId: org.id, key, operation: 'op', fingerprint: 'f1', at });
      expect(replay.kind).toBe('replay');
      if (replay.kind === 'replay') {
        expect(replay.record.responseStatus).toBe(201);
        expect(replay.record.responseBody).toEqual({ ok: true });
      }

      // Another organization may use the same key string.
      const other = await store.organizations.create({ name: 'Other', slug: `other-${unique()}`, defaultCurrency: 'ILS', timezone: 'UTC' });
      expect(await store.idempotency.claim({ organizationId: other.id, key, operation: 'op', fingerprint: 'zzz', at })).toEqual({ kind: 'new' });

      await store.idempotency.fail({ organizationId: other.id, key, at });
      expect(await store.idempotency.claim({ organizationId: other.id, key, operation: 'op', fingerprint: 'zzz', at })).toEqual({ kind: 'new' });
    });
  });
}
