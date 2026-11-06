import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { AppEnv } from '../middleware.js';
import { PROFILE_FEED_READS, STORE_ACCESS, accountantStoreGuard, requestScopedStore, shareLinkStoreGuard, unguarded, type MethodAccess } from '../store-guard.js';
import { accountantMayRead, accountantScopes } from '../writability.js';

/**
 * MUT-559 (ADR-245, D2): the third refusal layer for an accountant. Whatever a route does, an accountant's request
 * reaches the store through a guard that lets only reads through; the hourly "last viewed" stamp and SYSTEM catch-up
 * posting run on the store beneath it, as they do for every session.
 */
const isRead = (access: MethodAccess) => access === 'read' || (typeof access === 'object' && 'read' in access);

describe('accountantScopes (MUT-559)', () => {
  it('holds only the read scopes of the shared domains: never a write, agreements, audit or integration', () => {
    expect([...accountantScopes()].sort()).toEqual(['attachments:read', 'conversions:read', 'customers:read', 'expenses:read', 'payments:read', 'projects:read', 'summaries:read']);
  });

  it('allows a GET only when it names at least one scope and every one is the accountant’s (D1)', () => {
    const get = 'GET /v1/expenses';
    expect(accountantMayRead(get, ['expenses:read'])).toBe(true);
    expect(accountantMayRead(get, ['payments:read', 'customers:read'])).toBe(true);
    expect(accountantMayRead(get, [])).toBe(false);
    expect(accountantMayRead(get, ['agreements:read'])).toBe(false);
    expect(accountantMayRead(get, ['payments:read', 'agreements:read'])).toBe(false);
    expect(accountantMayRead(get, ['expenses:write'])).toBe(false);
    // An explicit exclusion wins over scopes the accountant holds (the retainer charges carry agreement terms).
    expect(accountantMayRead('GET /v1/retainers/:agreementId/charges', ['payments:read'])).toBe(false);
  });
});

describe('accountantStoreGuard (MUT-559 D2)', () => {
  it('passes every read and the named feed reads (MUT-575), and refuses every other classified method with READ_ONLY_PROFILE, ACCOUNTANT_READ_ONLY', () => {
    const guard = accountantStoreGuard();
    for (const [repo, methods] of Object.entries(STORE_ACCESS)) {
      for (const [method, access] of Object.entries(methods as Record<string, MethodAccess>)) {
        if (isRead(access) || PROFILE_FEED_READS.has(`${repo}.${method}`)) {
          expect(() => guard.assertCanCall(repo, method), `${repo}.${method}`).not.toThrow();
        } else {
          let thrown: unknown;
          try {
            guard.assertCanCall(repo, method);
          } catch (err) {
            thrown = err;
          }
          expect(thrown, `${repo}.${method}`).toBeInstanceOf(ApiError);
          expect((thrown as ApiError).code).toBe('READ_ONLY_PROFILE');
          expect((thrown as ApiError).details).toMatchObject({ reason: 'ACCOUNTANT_READ_ONLY' });
        }
      }
    }
  });

  it('MUT-575 (E8): the profile feed reads pass under both read-only guards, from one named list, and a write still throws', () => {
    expect([...PROFILE_FEED_READS].sort()).toEqual(['entries.list', 'entries.settledOwedIds']);
    for (const guard of [accountantStoreGuard(), shareLinkStoreGuard()]) {
      for (const name of PROFILE_FEED_READS) {
        const [repo, method] = name.split('.') as [string, string];
        expect(() => guard.assertCanCall(repo, method), name).not.toThrow();
      }
      expect(() => guard.assertCanCall('entries', 'loggedDays')).toThrow(ApiError);
      expect(() => guard.assertCanCall('expenses', 'create')).toThrow(ApiError);
    }
    // The accountant's own client-book reads run on the base store, never under a profile guard.
    for (const method of ['listForAccountant', 'dismiss']) expect(() => accountantStoreGuard().assertCanCall('accountantGrants', method)).toThrow(ApiError);
    expect(() => accountantStoreGuard().assertCanCall('entries', 'clientActivity')).toThrow(ApiError);
  });

  it('throws on an unclassified method rather than guess', () => {
    expect(() => accountantStoreGuard().assertCanCall('customers', 'dropEverything')).toThrow(/Unclassified/);
  });

  it('under an accountant request a repository write is refused, while the store beneath the guard still writes', async () => {
    const store = new MemoryLedgerStore();
    const org = await store.organizations.create({ name: 'Studio', slug: `studio-${Math.random().toString(36).slice(2)}`, defaultCurrency: 'ILS', timezone: 'UTC' });
    const scoped = requestScopedStore(store);
    const app = new Hono<AppEnv>();
    app.use(contextStorage());
    app.use(async (c, next) => {
      c.set('storeGuard', accountantStoreGuard());
      await next();
    });
    app.onError((err, c) => c.json({ code: err instanceof ApiError ? err.code : 'OTHER', details: err instanceof ApiError ? err.details : null }, 403));
    app.post('/write', async (c) => {
      await scoped.customers.create({ organizationId: org.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: null }, new Date());
      return c.json({ ok: true });
    });
    app.post('/system', async (c) => {
      // SYSTEM catch-up posting (lazyPostingOf) and the last-viewed stamp both run on the store beneath the guard.
      await unguarded(scoped).customers.create({ organizationId: org.id, name: 'System', email: null, phone: null, notes: null, vatTreatment: null }, new Date());
      return c.json({ ok: true });
    });
    app.get('/read', async (c) => c.json({ count: (await scoped.customers.list(org.id, {}, { limit: 10, cursor: null })).items.length }));

    const refused = await app.request('/write', { method: 'POST' });
    expect(await refused.json()).toEqual({ code: 'READ_ONLY_PROFILE', details: { reason: 'ACCOUNTANT_READ_ONLY' } });
    expect((await app.request('/system', { method: 'POST' })).status).toBe(200);
    expect(await (await app.request('/read')).json()).toEqual({ count: 1 });
  });
});
