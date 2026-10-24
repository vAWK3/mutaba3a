import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import type { AppEnv } from '../middleware.js';
import { verifyCurrentPassword } from '../current-password.js';
import { signIn } from '../sign-in.js';
import { SignInThrottle } from '../sessions.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../users.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';

/**
 * MUT-115 regression contract (plan §11.8, R1/D8): the sign-in core was reshaped for passkeys, and the two lockout
 * audits must keep the actors they had (sign-in SYSTEM, change-password and the other current-password checks USER).
 * The one intended change is `metadata.method` on the sign-in audits.
 */
const PEPPER = 'p'.repeat(32);
const PASSWORD = 'correct horse battery staple';
const LIFETIME = { idleMs: 120 * 60_000, absoluteMs: 12 * 3_600_000 };
const t0 = new Date('2026-10-24T09:00:00Z');

function fakeContext(now: Date): Context<AppEnv> {
  const vars: Record<string, unknown> = { now: () => now, requestId: 'req-1' };
  return { get: (key: string) => vars[key], req: { header: () => undefined } } as unknown as Context<AppEnv>;
}

async function setup() {
  const store = new MemoryLedgerStore();
  const hasher = createArgon2Hasher(ARGON2_MINIMUMS);
  const org = await store.organizations.create({ name: 'Firm', slug: `firm-${Math.random().toString(36).slice(2)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const { user } = await store.users.create({
    email: `nour-${Math.random().toString(36).slice(2)}@firm.ps`,
    displayName: 'Nour',
    passwordHash: await hasher.hash(PASSWORD),
    locale: 'en',
    organizationId: org.id,
    personal: { name: 'Personal', slug: `personal-${Math.random().toString(36).slice(2)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: t0,
  });
  return { store, hasher, org, user, deps: { store, passwordHasher: hasher, throttle: new SignInThrottle(), pepper: PEPPER } };
}

describe('sign-in audit contract (MUT-115 R1)', () => {
  it('a password sign-in is audited by the USER with method password', async () => {
    const { org, user, deps } = await setup();
    await signIn(fakeContext(t0), deps, { email: user.email, password: PASSWORD }, 'cookie', LIFETIME);
    const signedIn = (await deps.store.audit.listByOrganization(org.id, 10)).find((e) => e.action === 'user.signed_in');
    expect(signedIn).toMatchObject({ actorType: 'USER', actorId: user.id, metadata: { sessionKind: 'cookie', method: 'password' } });
  });

  it('a sign-in lockout is audited by the SYSTEM with method password', async () => {
    const { org, user, deps } = await setup();
    for (let i = 0; i < 5; i++) {
      await expect(signIn(fakeContext(t0), deps, { email: user.email, password: 'nope' }, 'cookie', LIFETIME)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    const locked = (await deps.store.audit.listByOrganization(org.id, 10)).find((e) => e.action === 'user.locked_out');
    expect(locked).toMatchObject({ actorType: 'SYSTEM', actorId: null, metadata: { sessionKind: 'cookie', method: 'password' } });
  });

  it('a current-password lockout stays audited by the USER', async () => {
    const { org, user, deps } = await setup();
    for (let i = 0; i < 5; i++) {
      const fresh = (await deps.store.users.getById(user.id))!;
      await expect(verifyCurrentPassword(deps, fresh, 'nope', t0, 'req-1')).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_WRONG' });
    }
    const locked = (await deps.store.audit.listByOrganization(org.id, 10)).find((e) => e.action === 'user.locked_out');
    expect(locked).toMatchObject({ actorType: 'USER', actorId: user.id });
  });
});
