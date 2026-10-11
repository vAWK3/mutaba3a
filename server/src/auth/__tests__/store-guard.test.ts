import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { ApiError } from '../../errors.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { AppEnv } from '../middleware.js';
import { STORE_ACCESS, principalStoreGuard, requestScopedStore, storeRefusal, unguarded, type MethodAccess } from '../store-guard.js';
import { WRITABILITY_MATRIX, type Access } from '../writability.js';

type Entry = [repo: string, method: string, access: MethodAccess];
const entries: Entry[] = Object.entries(STORE_ACCESS).flatMap(([repo, methods]) =>
  Object.entries(methods as Record<string, MethodAccess>).map(([method, access]) => [repo, method, access] as Entry),
);

const row = (domain: string) => WRITABILITY_MATRIX.find((r) => r.domain === domain)!;

function outcome(guard: ReturnType<typeof principalStoreGuard>, repo: string, method: string): string {
  try {
    guard.assertCanCall(repo, method);
    return 'allowed';
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return `${err.code}:${JSON.stringify(err.details ?? null)}`;
  }
}

function expected(access: MethodAccess, principal: 'apiKey' | 'session', writer: 'MALAFAT' | null): string {
  if (access === 'read' || access === 'control') return 'allowed';
  if (access === 'operator') return 'PRINCIPAL_NOT_ACCEPTED:null';
  if ('read' in access) return row(access.read)[principal] === 'none' ? 'PRINCIPAL_NOT_ACCEPTED:null' : 'allowed';
  const r = row(access.write);
  const column: Access = r[principal];
  if (column === 'read-write') return 'allowed';
  return r.writerOfRecord === 'MALAFAT'
    ? `READ_ONLY_PROFILE:${JSON.stringify({ domain: access.write, writerOfRecord: writer })}`
    : 'PRINCIPAL_NOT_ACCEPTED:null';
}

describe('STORE_ACCESS', () => {
  it('classifies exactly the repository methods the store has', () => {
    const store = new MemoryLedgerStore() as unknown as Record<string, unknown>;
    for (const [repo, methods] of Object.entries(STORE_ACCESS)) {
      const live = Object.entries(store[repo] as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'function')
        .map(([k]) => k)
        .sort();
      expect(Object.keys(methods).sort(), repo).toEqual(live);
    }
  });

  it('names a matrix domain for every domain-scoped method', () => {
    for (const [, , access] of entries) {
      if (typeof access === 'object') {
        const domain = 'read' in access ? access.read : access.write;
        expect(row(domain), domain).toBeDefined();
      }
    }
  });

  it('puts every expense repository method in the expenses domain, reads included (MUT-42)', () => {
    const expenseRepos = ['expenses', 'expenseCategories', 'expenseReceipts'];
    const methods = entries.filter(([repo]) => expenseRepos.includes(repo));
    expect(new Set(methods.map(([repo]) => repo))).toEqual(new Set(expenseRepos));
    for (const [repo, method, access] of methods) {
      expect(typeof access === 'object' && ('read' in access ? access.read : access.write), `${repo}.${method}`).toBe('expenses');
      expect(outcome(principalStoreGuard('apiKey', null), repo, method), `${repo}.${method}`).toBe('PRINCIPAL_NOT_ACCEPTED:null');
      expect(outcome(principalStoreGuard('session', 'MALAFAT'), repo, method), `${repo}.${method}`).toBe('allowed');
    }
  });

  it('keeps provisioning to the operator (ADR-037 decision 1)', () => {
    const operator = entries.filter(([, , a]) => a === 'operator').map(([r, m]) => `${r}.${m}`).sort();
    expect(operator).toEqual([
      'apiKeys.create',
      'memberships.grant',
      'memberships.revoke',
      'organizations.create',
      'sessions.revokeAllForUser',
      'users.create',
      'users.setPassword',
      'users.setStatus',
    ]);
  });
});

describe('storeRefusal on the expenses row', () => {
  it('lets a session write expenses on a Malafat-fed profile', () => {
    expect(storeRefusal('session', 'MALAFAT', { write: 'expenses' })).toBeNull();
  });

  it('refuses Malafat’s key any expense write, as not its business', () => {
    expect(storeRefusal('apiKey', null, { write: 'expenses' })?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });

  it('refuses Malafat’s key even an expense read, and lets a session read (MUT-42)', () => {
    expect(storeRefusal('apiKey', null, { read: 'expenses' })?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
    expect(storeRefusal('session', null, { read: 'expenses' })).toBeNull();
    expect(storeRefusal('apiKey', null, { read: 'summaries' })).toBeNull();
  });
});

describe.each([
  ['session', 'MALAFAT'],
  ['session', null],
  ['apiKey', null],
] as const)('%s guard (writer of record %s)', (principal, writer) => {
  const guard = principalStoreGuard(principal, writer);
  it.each(entries)('%s.%s', (repo, method, access) => {
    expect(outcome(guard, repo, method)).toBe(expected(access, principal, writer));
  });
});

describe('requestScopedStore', () => {
  function app(store: MemoryLedgerStore, guard: ReturnType<typeof principalStoreGuard> | null) {
    const scoped = requestScopedStore(store);
    const a = new Hono<AppEnv>();
    a.use(contextStorage());
    a.use(async (c, next) => {
      if (guard) c.set('storeGuard', guard);
      await next();
    });
    a.post('/write', async (c) => {
      try {
        await store.organizations.create({ name: 'X', slug: `x-${Math.random().toString(36).slice(2)}`, defaultCurrency: 'ILS', timezone: 'UTC' });
        const org = (await scoped.organizations.list())[0]!;
        await scoped.customers.create({ organizationId: org.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: null }, new Date());
        return c.json({ ok: true });
      } catch (err) {
        return c.json({ code: err instanceof ApiError ? err.code : 'OTHER' }, 400);
      }
    });
    a.post('/system', async (c) => {
      const org = (await scoped.organizations.list())[0]!;
      await unguarded(scoped).customers.create({ organizationId: org.id, name: 'System', email: null, phone: null, notes: null, vatTreatment: null }, new Date());
      return c.json({ ok: true });
    });
    return { a, scoped };
  }

  it('refuses a write the request’s guard does not allow, before it reaches the store', async () => {
    const store = new MemoryLedgerStore();
    const { a } = app(store, principalStoreGuard('session', 'MALAFAT'));
    const res = await a.request('/write', { method: 'POST' });
    expect(await res.json()).toEqual({ code: 'READ_ONLY_PROFILE' });
    const org = (await store.organizations.list())[0]!;
    expect((await store.customers.list(org.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
  });

  it('lets system work through unguarded()', async () => {
    const store = new MemoryLedgerStore();
    await store.organizations.create({ name: 'Y', slug: 'y-firm', defaultCurrency: 'ILS', timezone: 'UTC' });
    const { a } = app(store, principalStoreGuard('session', 'MALAFAT'));
    expect((await a.request('/system', { method: 'POST' })).status).toBe(200);
    const org = (await store.organizations.list())[0]!;
    expect((await store.customers.list(org.id, {}, { limit: 10, cursor: null })).items.map((c) => c.name)).toEqual(['System']);
  });

  it('refuses provisioning under any guard', async () => {
    const scoped = requestScopedStore(new MemoryLedgerStore());
    const a = new Hono<AppEnv>();
    a.use(contextStorage());
    a.use(async (c, next) => {
      c.set('storeGuard', principalStoreGuard('apiKey', null));
      await next();
    });
    a.post('/org', async (c) => {
      await scoped.organizations.create({ name: 'X', slug: 'x-firm', defaultCurrency: 'ILS', timezone: 'UTC' });
      return c.json({ ok: true });
    });
    a.onError((err, c) => c.json({ code: err instanceof ApiError ? err.code : 'OTHER' }, 403));
    expect(await (await a.request('/org', { method: 'POST' })).json()).toEqual({ code: 'PRINCIPAL_NOT_ACCEPTED' });
  });

  it('passes through when the request carries no guard, and outside any request', async () => {
    const store = new MemoryLedgerStore();
    const { a, scoped } = app(store, null);
    expect((await a.request('/write', { method: 'POST' })).status).toBe(200);
    await expect(scoped.ping()).resolves.toBeUndefined();
    const org = await scoped.organizations.create({ name: 'Z', slug: 'z-firm', defaultCurrency: 'ILS', timezone: 'UTC' });
    expect(org.slug).toBe('z-firm');
  });
});
