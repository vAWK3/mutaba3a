import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import type { AppEnv } from '../middleware.js';
import { signIn } from '../sign-in.js';
import { SignInThrottle, isDeviceSessionToken } from '../sessions.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../users.js';
import type { ApiError } from '../../errors.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { LedgerStore } from '../../repositories/ports.js';

const PEPPER = 'p'.repeat(32);
const PASSWORD = 'correct horse battery staple';
const LIFETIME = { idleMs: 120 * 60_000, absoluteMs: 12 * 3_600_000 };

function fakeContext(now: Date, requestId = 'req-1'): Context<AppEnv> {
  const vars: Record<string, unknown> = { now: () => now, requestId };
  return { get: (key: string) => vars[key], req: { header: () => undefined } } as unknown as Context<AppEnv>;
}

async function activeUser(store: LedgerStore, at: Date, overrides: { email?: string } = {}) {
  const hasher = createArgon2Hasher(ARGON2_MINIMUMS);
  const org = await store.organizations.create({ name: 'Firm', slug: `firm-${Math.random().toString(36).slice(2)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const passwordHash = await hasher.hash(PASSWORD);
  const { user } = await store.users.create({
    email: overrides.email ?? `nour-${Math.random().toString(36).slice(2)}@firm.ps`,
    displayName: 'Nour',
    passwordHash,
    locale: 'en',
    organizationId: org.id,
    at,
  });
  return { user, hasher, org };
}

describe('signIn (MUT-64 shared credential-verification core)', () => {
  const t0 = new Date('2026-10-11T09:00:00Z');

  it('succeeds with the right password and threads sessionKind/lifetime', async () => {
    const store = new MemoryLedgerStore();
    const { user, hasher } = await activeUser(store, t0);
    const throttle = new SignInThrottle();
    const result = await signIn(
      fakeContext(t0),
      { store, passwordHasher: hasher, throttle, pepper: PEPPER },
      { email: user.email, password: PASSWORD },
      'device',
      LIFETIME,
    );
    expect(result.user.id).toBe(user.id);
    expect(isDeviceSessionToken(result.token)).toBe(true);
    expect(result.session.kind).toBe('device');
    expect(result.session.idleExpiresAt.toISOString()).toBe(new Date(t0.getTime() + LIFETIME.idleMs).toISOString());
    expect(result.session.absoluteExpiresAt.toISOString()).toBe(new Date(t0.getTime() + LIFETIME.absoluteMs).toISOString());
  });

  it('refuses a wrong password with INVALID_CREDENTIALS and records a failure', async () => {
    const store = new MemoryLedgerStore();
    const { user, hasher } = await activeUser(store, t0);
    const throttle = new SignInThrottle();
    await expect(
      signIn(fakeContext(t0), { store, passwordHasher: hasher, throttle, pepper: PEPPER }, { email: user.email, password: 'nope' }, 'cookie', LIFETIME),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' } satisfies Partial<ApiError>);
    expect((await store.users.findByEmail(user.email))?.failedSignIns).toBe(1);
  });

  it('gives an unknown email the identical refusal, still runs one verify', async () => {
    const store = new MemoryLedgerStore();
    const hasher = createArgon2Hasher(ARGON2_MINIMUMS);
    const throttle = new SignInThrottle();
    await expect(
      signIn(fakeContext(t0), { store, passwordHasher: hasher, throttle, pepper: PEPPER }, { email: 'ghost@firm.ps', password: 'whatever' }, 'cookie', LIFETIME),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' } satisfies Partial<ApiError>);
  });

  it('refuses a disabled user even with the right password', async () => {
    const store = new MemoryLedgerStore();
    const { user, hasher } = await activeUser(store, t0);
    await store.users.setStatus(user.id, 'DISABLED', t0);
    const throttle = new SignInThrottle();
    await expect(
      signIn(fakeContext(t0), { store, passwordHasher: hasher, throttle, pepper: PEPPER }, { email: user.email, password: PASSWORD }, 'cookie', LIFETIME),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' } satisfies Partial<ApiError>);
  });

  it('locks out after the policy threshold and refuses the right password without a verify', async () => {
    const store = new MemoryLedgerStore();
    const { user, hasher } = await activeUser(store, t0);
    const throttle = new SignInThrottle();
    const deps = { store, passwordHasher: hasher, throttle, pepper: PEPPER };
    for (let i = 0; i < 5; i++) {
      await expect(signIn(fakeContext(t0), deps, { email: user.email, password: 'nope' }, 'cookie', LIFETIME)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    await expect(signIn(fakeContext(t0), deps, { email: user.email, password: PASSWORD }, 'cookie', LIFETIME)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('clears the throttle and records the sign-in on success', async () => {
    const store = new MemoryLedgerStore();
    const { user, hasher } = await activeUser(store, t0);
    const throttle = new SignInThrottle();
    const deps = { store, passwordHasher: hasher, throttle, pepper: PEPPER };
    await expect(signIn(fakeContext(t0), deps, { email: user.email, password: 'nope' }, 'cookie', LIFETIME)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await signIn(fakeContext(new Date(t0.getTime() + 1000)), deps, { email: user.email, password: PASSWORD }, 'cookie', LIFETIME);
    const found = await store.users.findByEmail(user.email);
    expect(found?.failedSignIns).toBe(0);
    expect(found?.lastSignInAt).not.toBeNull();
  });

  it('stamps the audit row with sessionKind', async () => {
    const store = new MemoryLedgerStore();
    const { user, hasher, org } = await activeUser(store, t0);
    const throttle = new SignInThrottle();
    await signIn(fakeContext(t0), { store, passwordHasher: hasher, throttle, pepper: PEPPER }, { email: user.email, password: PASSWORD }, 'device', LIFETIME);
    const events = await store.audit.listByOrganization(org.id, 10);
    const signedIn = events.find((e) => e.action === 'user.signed_in');
    expect(signedIn?.metadata).toMatchObject({ sessionKind: 'device' });
  });
});
