import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../../app.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../../../auth/users.js';
import { SlidingWindowRateLimiter } from '../../../rate-limit.js';
import { MemoryLedgerStore } from '../../../repositories/memory.js';
import { adminClient } from '../../users.js';
import { signIn, type ApiClientDeps } from '../apiClient.js';
import { ensureSeedAccount } from '../adminAccount.js';

const ADMIN_TOKEN = 'admin-token-with-at-least-32-characters-long';
const URL_BASE = 'http://mutaba3a.test';
const OPTIONS = { email: 'qa@mutaba3a.test', displayName: 'Seed QA', currency: 'ILS', timezone: 'Asia/Jerusalem' };

function harness() {
  const store = new MemoryLedgerStore();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    passwordHasher: createArgon2Hasher(ARGON2_MINIMUMS),
  });
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => app.request(input as string, init)) as typeof fetch;
  const deps: ApiClientDeps = { fetch: fetchFn, baseUrl: URL_BASE };
  return { store, deps, admin: adminClient(fetchFn, URL_BASE, ADMIN_TOKEN) };
}

describe('ensureSeedAccount (MUT-136)', () => {
  it('creates the account on a first run, with a personal profile only (no organization-id)', async () => {
    const { store, admin } = harness();
    const creds = await ensureSeedAccount(admin, OPTIONS);
    const user = await store.users.findByEmail(OPTIONS.email);
    expect(user?.id).toBe(creds.userId);
    const memberships = await store.memberships.listByUser(creds.userId);
    expect(memberships).toHaveLength(1);
  });

  it('reuses the same account on a second run instead of creating a duplicate', async () => {
    const { store, admin } = harness();
    const first = await ensureSeedAccount(admin, OPTIONS);
    const second = await ensureSeedAccount(admin, OPTIONS);
    expect(second.userId).toBe(first.userId);
    const page = await store.organizations.list();
    const personalOrgs = page.filter((o) => o.personalOwnerUserId === first.userId);
    expect(personalOrgs).toHaveLength(1);
  });

  it('rotates the password every run, so only the freshest returned password still signs in', async () => {
    const { deps, admin } = harness();
    const first = await ensureSeedAccount(admin, OPTIONS);
    const second = await ensureSeedAccount(admin, OPTIONS);
    expect(second.password).not.toBe(first.password);

    await expect(signIn(deps, OPTIONS.email, second.password)).resolves.toMatchObject({});
    await expect(signIn(deps, OPTIONS.email, first.password)).rejects.toThrow();
  });

  it('fails visibly on a bad admin token, rather than silently creating a duplicate account', async () => {
    const { store, deps } = harness();
    const wrongAdmin = adminClient(deps.fetch, deps.baseUrl, 'not-the-real-admin-token');
    await expect(ensureSeedAccount(wrongAdmin, OPTIONS)).rejects.toThrow();
    expect(await store.users.findByEmail(OPTIONS.email)).toBeNull();
  });
});
