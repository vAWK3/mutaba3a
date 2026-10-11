import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../../auth/users.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { runUsersCommand } from '../users.js';

const TOKEN = 'cli-admin-token-with-at-least-32-characters';
const URL_BASE = 'http://mutaba3a.test';

function harness() {
  const store = new MemoryLedgerStore();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    passwordHasher: createArgon2Hasher(ARGON2_MINIMUMS),
  });
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => app.request(input as string, init)) as typeof fetch;
  const out: string[] = [];
  const err: string[] = [];
  // null = no token at all (undefined would fall back to the default).
  const run = (argv: string[], token: string | null = TOKEN) =>
    runUsersCommand(argv, { fetch: fetchFn, url: URL_BASE, token: token ?? undefined, out: (l: string) => out.push(l), err: (l: string) => err.push(l) });
  return { store, run, out, err };
}

async function org(store: MemoryLedgerStore, name: string) {
  return store.organizations.create({ name, slug: name.toLowerCase().replace(/\s+/g, '-'), defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
}

describe('users CLI (npm run provision:user and friends)', () => {
  it('create prints the user id and the one-time password exactly once', async () => {
    const h = harness();
    const o = await org(h.store, 'Sader Law');
    const code = await h.run(['create', '--email', 'Nour@Firm.ps', '--name', 'Nour Haddad', '--organization-id', o.id, '--locale', 'ar']);
    expect(code).toBe(0);
    const user = await h.store.users.findByEmail('nour@firm.ps');
    expect(user?.locale).toBe('ar');
    const text = h.out.join('\n');
    expect(text).toContain(user!.id);
    expect(text).toMatch(/shown once/i);
    const passwords = h.out.filter((l) => /^[A-Za-z0-9_-]{24}$/.test(l));
    expect(passwords).toHaveLength(1);
  });

  it('grant and revoke resolve the user by email', async () => {
    const h = harness();
    const a = await org(h.store, 'Firm A');
    const b = await org(h.store, 'Firm B');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', a.id]);
    const user = (await h.store.users.findByEmail('nour@firm.ps'))!;

    expect(await h.run(['grant', '--email', 'NOUR@firm.ps', '--organization-id', b.id])).toBe(0);
    expect(await h.store.memberships.find(user.id, b.id)).not.toBeNull();

    expect(await h.run(['revoke', '--email', 'nour@firm.ps', '--organization-id', b.id])).toBe(0);
    expect(await h.store.memberships.find(user.id, b.id)).toBeNull();
  });

  it('rotate prints a new password once', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id]);
    h.out.length = 0;
    expect(await h.run(['rotate', '--email', 'nour@firm.ps'])).toBe(0);
    expect(h.out.filter((l) => /^[A-Za-z0-9_-]{24}$/.test(l))).toHaveLength(1);
  });

  it('disable and enable print the resulting status', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id]);
    expect(await h.run(['disable', '--email', 'nour@firm.ps'])).toBe(0);
    expect(h.out.join('\n')).toContain('DISABLED');
    expect((await h.store.users.findByEmail('nour@firm.ps'))?.status).toBe('DISABLED');
    expect(await h.run(['enable', '--email', 'nour@firm.ps'])).toBe(0);
    expect((await h.store.users.findByEmail('nour@firm.ps'))?.status).toBe('ACTIVE');
  });

  it('revoke-sessions prints how many sessions were ended', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id]);
    h.out.length = 0;
    expect(await h.run(['revoke-sessions', '--email', 'nour@firm.ps'])).toBe(0);
    expect(h.out.join('\n')).toMatch(/0 sessions? revoked/);
  });

  it('fails without a token, prints no secret', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    expect(await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id], null)).not.toBe(0);
    expect(h.err.join('\n')).toContain('MUTABA3A_ADMIN_TOKEN');
    expect(h.out.filter((l) => /^[A-Za-z0-9_-]{24}$/.test(l))).toHaveLength(0);
  });

  it('fails for an unknown email with a readable message', async () => {
    const h = harness();
    expect(await h.run(['rotate', '--email', 'nobody@firm.ps'])).not.toBe(0);
    expect(h.err.join('\n')).toMatch(/no user/i);
  });

  it('surfaces the server error code', async () => {
    const h = harness();
    expect(await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', '00000000-0000-4000-8000-000000000000'])).not.toBe(0);
    expect(h.err.join('\n')).toContain('NOT_FOUND');
  });

  it('rejects an unknown subcommand with usage', async () => {
    const h = harness();
    expect(await h.run(['delete', '--email', 'x@y.z'])).not.toBe(0);
    expect(h.err.join('\n')).toMatch(/usage/i);
  });
});
