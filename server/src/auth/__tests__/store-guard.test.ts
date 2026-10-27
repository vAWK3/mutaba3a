import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { ApiError } from '../../errors.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { AppEnv } from '../middleware.js';
import { AGENT_STORE_METHODS, STORE_ACCESS, agentStoreGuard, principalStoreGuard, requestScopedStore, storeRefusal, unguarded, type MethodAccess } from '../store-guard.js';
import { PROFILE_DEPENDENT_DOMAINS, WRITABILITY_MATRIX, type Access, type Domain } from '../writability.js';

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
  // MUT-66: a signed-in person's own resource; no profile and no matrix domain apply.
  if (access === 'sessionOnly') return principal === 'session' ? 'allowed' : 'PRINCIPAL_NOT_ACCEPTED:null';
  if ('read' in access) return row(access.read)[principal] === 'none' ? 'PRINCIPAL_NOT_ACCEPTED:null' : 'allowed';
  const r = row(access.write);
  // MUT-65: the three profile-dependent domains are read-write for a session on a personal profile (writer === null), read-only on a Malafat-fed one — a wrapper over the matrix, not a matrix edit.
  if (principal === 'session' && PROFILE_DEPENDENT_DOMAINS.has(access.write as Domain)) {
    return writer === null ? 'allowed' : `READ_ONLY_PROFILE:${JSON.stringify({ domain: access.write, writerOfRecord: writer })}`;
  }
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
    // MUT-255: the operator's cross-profile edit-rate figure is the one exception, kept to /admin.
    const methods = entries.filter(([repo, method]) => expenseRepos.includes(repo) && `${repo}.${method}` !== 'expenseReceipts.editRates');
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
      // MUT-235: issued by /admin and redeemed by the two public setup routes, neither of which runs a guard.
      'accountPurge.claim',
      // MUT-333: the hard delete of closed accounts, from /jobs and /admin only.
      'accountPurge.countClosing',
      'accountPurge.finishStoragePurge',
      'accountPurge.listDue',
      'accountPurge.listStoragePurges',
      'accountPurge.planOf',
      'accountPurge.purge',
      'accountSetup.findByDigest',
      'accountSetup.issue',
      // MUT-366: the SIGNUP links the public signup route issues and the public redeem claims; pruned by the server's timer.
      'accountSetup.issueSignup',
      'accountSetup.pruneSignupLinks',
      'accountSetup.redeem',
      'accountSetup.redeemSignup',
      'apiKeys.create',
      // MUT-358: grants, links, trial starts and Stripe's mirror are the operator's (and, from MUT-360, the webhook's).
      // MUT-360: the Stripe webhook's event bookkeeping, also on the unguarded store.
      'billing.beginStripeEvent',
      'billing.createGrant',
      'billing.finishStripeEvent',
      'billing.getAccount',
      'billing.getGrant',
      'billing.getSubscription',
      'billing.linkAccount',
      'billing.listAccounts',
      'billing.listGrants',
      'billing.pruneStripeEvents',
      'billing.revokeGrant',
      'billing.saveAccount',
      'billing.saveSubscription',
      'billing.setTrialStart',
      'billing.trialMailCandidates',
      // MUT-359: the mail send log and suppression list, reached only by the mailer and the Resend webhook (unguarded store).
      'email.claimDelivery',
      'email.finishDelivery',
      'email.isSuppressed',
      'email.pruneDeliveries',
      'email.suppress',
      // MUT-255: the receipt-scanning success measure, across every profile (counts only).
      'expenseReceipts.editRates',
      // MUT-433: per-user feature flags are written and listed by the operator only; /v1/me reads them sessionOnly.
      'features.grant',
      'features.holders',
      'features.revoke',
      'memberships.grant',
      // MUT-373: co-owners are added by the operator only (the pilot path; invites are MUT-306).
      'memberships.grantOwner',
      'memberships.revoke',
      // MUT-434: the OAuth protocol endpoints and agent authentication run unguarded, like sign-in; no credential calls these.
      'oauth.cleanup',
      'oauth.createAuthorizationRequest',
      'oauth.createClient',
      'oauth.exchangeCode',
      'oauth.findCode',
      'oauth.findGrant',
      'oauth.findToken',
      'oauth.findTokenById',
      'oauth.revokeAllForUser',
      'oauth.rotateRefresh',
      'oauth.touchGrant',
      'oauth.upsertCimdClient',
      'organizations.create',
      // MUT-300: an operator turns firm features on and off, declines a request and lists the pending ones.
      'organizations.declineFirmRequest',
      'organizations.listFirmRequests',
      'organizations.setFirm',
      // MUT-115: passkey sign-in's own reads and writes run on the public routes, unguarded; no credential calls them.
      'passkeys.findByCredentialId',
      'passkeys.pruneChallenges',
      'passkeys.recordUse',
      'sessions.revokeAllForUser',
      // MUT-367: the signup review queue, the operator's alone (/admin and the CLI); the digest reads it unguarded.
      'signupReviews.approve',
      'signupReviews.decline',
      'signupReviews.digestFacts',
      'signupReviews.findByUser',
      'signupReviews.list',
      'signupReviews.markNotified',
      'users.create',
      // MUT-324 T1: the operator's terms report.
      'users.listLatestTermsVersions',
      // MUT-459: only the admin token marks an operator.
      'users.setOperator',
      'users.setPassword',
      'users.setStatus',
    ]);
  });
});

describe('storeRefusal on the three profile-dependent rows (MUT-65)', () => {
  it('lets a session write payments/customers/projects on a personal profile', () => {
    for (const domain of ['payments', 'customers', 'projects'] as const) {
      expect(storeRefusal('session', null, { write: domain })).toBeNull();
    }
  });

  it('refuses a session the same write on a Malafat-fed profile, READ_ONLY_PROFILE', () => {
    expect(storeRefusal('session', 'MALAFAT', { write: 'payments' })?.code).toBe('READ_ONLY_PROFILE');
    expect(storeRefusal('session', 'MALAFAT', { write: 'payments' })?.details).toEqual({ domain: 'payments', writerOfRecord: 'MALAFAT' });
  });

  it('agreements stays out of session reach even on a personal profile (not one of the three named rows)', () => {
    expect(storeRefusal('session', null, { write: 'agreements' })?.code).toBe('READ_ONLY_PROFILE');
  });

  it('the new receivables.createAdjustment/softDeleteAdjustment are classified payments:write', () => {
    expect(STORE_ACCESS.receivables.createAdjustment).toEqual({ write: 'payments' });
    expect(STORE_ACCESS.receivables.softDeleteAdjustment).toEqual({ write: 'payments' });
  });
});

describe('owned profiles (MUT-182)', () => {
  it('gives a person their own standalone profiles through sessionOnly methods, and an API key none of them (G1)', () => {
    const owned = ['createOwned', 'countOwnedBy', 'updateOwned', 'typeChangeImpact'] as const;
    for (const method of owned) {
      const access = STORE_ACCESS.organizations[method];
      expect(access, method).toBe('sessionOnly');
      expect(storeRefusal('session', null, access), method).toBeNull();
      expect(storeRefusal('apiKey', null, access)?.code, method).toBe('PRINCIPAL_NOT_ACCEPTED');
    }
    // Firms and Malafat tenants still come only from the operator (ADR-037 decision 1, MUT-182 amendment).
    expect(storeRefusal('session', null, STORE_ACCESS.organizations.create)?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});

describe('per-user feature flags (MUT-433)', () => {
  it("lets a session read its own flags for /v1/me and refuses an API key; MUT-434's MCP principal must be added here", () => {
    const access = STORE_ACCESS.features.activeFor;
    expect(access).toBe('sessionOnly');
    expect(storeRefusal('session', null, access)).toBeNull();
    expect(storeRefusal('apiKey', null, access)?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});

describe('the MCP agent guard (MUT-435)', () => {
  const guard = agentStoreGuard();

  it('opens exactly the methods the read, write and receipt tools call, nothing else (MUT-435/436/437)', () => {
    expect([...AGENT_STORE_METHODS].sort()).toEqual([
      'agentWriteLock.run',
      'audit.append',
      'customers.getById',
      'customers.list',
      'expenseCategories.getById',
      'expenseCategories.list',
      'expenseReceipts.complete',
      'expenseReceipts.completeOnExpense',
      'expenseReceipts.countPendingSince',
      'expenseReceipts.countReadyByExpenseIds',
      'expenseReceipts.create',
      'expenseReceipts.getById',
      'expenseReceipts.listByExpense',
      'expenseReceipts.setKey',
      'expenses.create',
      'expenses.getById',
      'expenses.list',
      'idempotency.claim',
      'idempotency.complete',
      'idempotency.fail',
      'inboxEntries.create',
      'inboxEntries.fileAsExpense',
      'inboxEntries.getById',
      'inboxEntries.list',
      'inboxEntries.listMatchCandidates',
      'memberships.find',
      'memberships.listByUser',
      'organizations.getById',
      'projects.getById',
      'userIdempotency.claim',
      'userIdempotency.complete',
      'userIdempotency.fail',
      'vendors.resolve',
      'vendors.search',
      'vendors.touch',
    ]);
  });

  it('allows every listed method and refuses every other classified one, read class included', () => {
    for (const [repo, method] of entries) {
      expect(outcome(guard, repo, method), `${repo}.${method}`).toBe(AGENT_STORE_METHODS.has(`${repo}.${method}`) ? 'allowed' : 'PRINCIPAL_NOT_ACCEPTED:null');
    }
  });

  it('lists only classified methods, none of them operator-only', () => {
    for (const name of AGENT_STORE_METHODS) {
      const [repo, method] = name.split('.') as [string, string];
      const access = (STORE_ACCESS as Record<string, Record<string, MethodAccess>>)[repo]?.[method];
      expect(access, name).toBeDefined();
      expect(access, name).not.toBe('operator');
    }
  });

  it('still throws on a method nobody classified', () => {
    expect(() => guard.assertCanCall('expenses', 'notAMethod')).toThrow('Unclassified store method expenses.notAMethod');
  });
});

describe('the entries feed (MUT-270)', () => {
  it('lets a session read the feed across its own profiles, on any profile writer, and refuses an API key', () => {
    const access = STORE_ACCESS.entries.list;
    expect(access).toBe('sessionOnly');
    expect(storeRefusal('session', null, access)).toBeNull();
    expect(storeRefusal('session', 'MALAFAT', access)).toBeNull();
    expect(storeRefusal('apiKey', null, access)?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});

describe('the inbox (MUT-66)', () => {
  it('accepts a session and no other principal for the six session-only methods', () => {
    expect(storeRefusal('session', null, 'sessionOnly')).toBeNull();
    expect(storeRefusal('session', 'MALAFAT', 'sessionOnly')).toBeNull();
    expect(storeRefusal('apiKey', null, 'sessionOnly')?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });

  // MUT-240: countByUser moved from operator to sessionOnly so the Capture hub's own
  // GET /v1/inbox/count route can call it; /admin's per-user lookup runs with no guard
  // at all, so this reclassification does not change what it can reach.
  it('classifies the inbox’s own methods: sessionOnly to capture and to count, the ledger’s own domains to file', () => {
    expect(STORE_ACCESS.inboxEntries).toEqual({
      create: 'sessionOnly',
      getById: 'sessionOnly',
      list: 'sessionOnly',
      update: 'sessionOnly',
      delete: 'sessionOnly',
      countByUser: 'sessionOnly',
      listMatchCandidates: 'sessionOnly',
      fileAsExpense: { write: 'expenses' },
      fileAsIncome: { write: 'payments' },
    });
  });

  it('refuses an API key a filing exactly where it already refuses the direct create', () => {
    // expenses' apiKey column is `none`, so this is PRINCIPAL_NOT_ACCEPTED, not a read-only-profile case.
    expect(storeRefusal('apiKey', null, STORE_ACCESS.inboxEntries.fileAsExpense)?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
    expect(storeRefusal('apiKey', null, STORE_ACCESS.expenses.create)?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });

  /**
   * The load-bearing assertion behind the design's claim that filing needed no
   * inbox-specific writability logic: filing-as-income is refused on a
   * Malafat-fed profile purely because its classification is the same
   * `{ write: 'payments' }` the direct create carries.
   */
  it('refuses filing as income on a Malafat-fed profile, and allows it on a personal one — straight off the matrix', () => {
    const refusal = storeRefusal('session', 'MALAFAT', STORE_ACCESS.inboxEntries.fileAsIncome);
    expect(refusal?.code).toBe('READ_ONLY_PROFILE');
    expect(refusal?.details).toEqual({ domain: 'payments', writerOfRecord: 'MALAFAT' });
    expect(storeRefusal('session', null, STORE_ACCESS.inboxEntries.fileAsIncome)).toBeNull();
  });

  it('lets filing as an expense land on any profile the person belongs to, Malafat-fed included', () => {
    expect(storeRefusal('session', 'MALAFAT', STORE_ACCESS.inboxEntries.fileAsExpense)).toBeNull();
    expect(storeRefusal('session', null, STORE_ACCESS.inboxEntries.fileAsExpense)).toBeNull();
  });

  it('mints no new matrix domain for the inbox', () => {
    expect(WRITABILITY_MATRIX.map((r) => r.domain)).not.toContain('inbox');
    // MUT-61 minted `capture` on purpose; anything else appearing here is a new row nobody decided on.
    expect(WRITABILITY_MATRIX.map((r) => r.domain)).toEqual(['integration', 'customers', 'projects', 'agreements', 'payments', 'attachments', 'summaries', 'audit', 'expenses', 'capture', 'identity', 'conversions']);
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

  it('MUT-65: lets a session on a personal profile (writer null) write where a Malafat-fed one is refused', async () => {
    const store = new MemoryLedgerStore();
    const { a } = app(store, principalStoreGuard('session', null));
    const res = await a.request('/write', { method: 'POST' });
    expect(await res.json()).toEqual({ ok: true });
    const org = (await store.organizations.list())[0]!;
    expect((await store.customers.list(org.id, {}, { limit: 10, cursor: null })).items.map((c) => c.name)).toEqual(['Haddad']);
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
