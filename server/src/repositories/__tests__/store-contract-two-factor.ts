import { describe, expect, it } from 'vitest';
import type { CreateTwoFactorChallengeInput, LedgerStore, UserRecord } from '../ports.js';

/**
 * MUT-710 storage contract (ADR-275): two-step sign-in, its recovery codes and challenges. Run against the memory store
 * and Postgres (`test:db`), so both agree that every counter is conditional: a TOTP step is used once, a recovery code
 * once, a challenge once, and tries and resends stop at their caps (review 2).
 */
export function describeLedgerStoreTwoFactorContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 9, minute, 0));
  const digest = () => unique().padEnd(64, '0').slice(0, 64);
  const POLICY = { lockAfter: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };

  async function person(store: LedgerStore): Promise<UserRecord> {
    const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await store.users.create({
      email: `tf-${unique()}@firm.ps`,
      displayName: 'Rana',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      locale: 'en',
      organizationId: org.id,
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: at(0),
    });
    return user;
  }

  const session = (store: LedgerStore, userId: string) =>
    store.sessions.create({ userId, tokenDigest: digest(), kind: 'cookie', at: at(1), idleExpiresAt: at(50), absoluteExpiresAt: at(59), userAgent: null });

  const enable = (store: LedgerStore, userId: string, extra: { keepSessionId?: string | null; codes?: string[]; method?: 'totp' | 'email' } = {}) =>
    store.twoFactor.enable({
      userId,
      method: extra.method ?? 'totp',
      totpSecretSealed: extra.method === 'email' ? null : 'v1.sealed.secret',
      lastUsedStep: 100,
      recoveryDigests: extra.codes ?? [digest(), digest()],
      at: at(2),
      keepSessionId: extra.keepSessionId ?? null,
      audit: [],
    });

  const challenge = (userId: string, overrides: Partial<CreateTwoFactorChallengeInput> = {}): CreateTwoFactorChallengeInput => ({
    userId,
    tokenDigest: digest(),
    purpose: 'sign_in',
    method: 'totp',
    sessionKind: 'device',
    firstStep: { method: 'passkey', passkeyId: '00000000-0000-4000-8000-000000000001' },
    passwordChangedAt: at(0),
    at: at(3),
    expiresAt: at(13),
    ...overrides,
  });

  describe(`${name} LedgerStore two-step sign-in contract (MUT-710)`, () => {
    it('is off until enabled; enabling keeps this session, stamps it, and signs out the others', async () => {
      const store = await makeStore();
      const user = await person(store);
      expect(await store.twoFactor.get(user.id)).toBeNull();
      const kept = await session(store, user.id);
      const other = await session(store, user.id);
      expect(kept.twoFactorAt).toBeNull();

      expect(await enable(store, user.id, { keepSessionId: kept.id })).toEqual({ revokedSessions: 1 });

      expect(await store.twoFactor.get(user.id)).toMatchObject({ userId: user.id, method: 'totp', totpSecretSealed: 'v1.sealed.secret', lastUsedStep: 100, failures: 0, lockedUntil: null, enabledAt: at(2) });
      expect((await store.sessions.getById(kept.id))?.twoFactorAt).toEqual(at(2));
      expect(await store.sessions.getById(other.id)).toMatchObject({ revokedReason: 'two_factor_enabled', revokedAt: at(2) });
      expect(await store.twoFactor.recoveryCodesLeft(user.id)).toBe(2);
    });

    it('a session can be created already past the second step', async () => {
      const store = await makeStore();
      const user = await person(store);
      const s = await store.sessions.create({ userId: user.id, tokenDigest: digest(), kind: 'device', at: at(4), idleExpiresAt: at(50), absoluteExpiresAt: at(59), userAgent: null, twoFactorAt: at(4) });
      expect(s.twoFactorAt).toEqual(at(4));
    });

    it('a TOTP step is accepted only after the last one used, once', async () => {
      const store = await makeStore();
      const user = await person(store);
      await enable(store, user.id);
      expect(await store.twoFactor.recordStep(user.id, 100, at(5))).toBe(false);
      expect(await store.twoFactor.recordStep(user.id, 99, at(5))).toBe(false);
      const results = await Promise.all([store.twoFactor.recordStep(user.id, 101, at(5)), store.twoFactor.recordStep(user.id, 101, at(5))]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.twoFactor.get(user.id))?.lastUsedStep).toBe(101);
    });

    it('a recovery code works once; new codes replace the old', async () => {
      const store = await makeStore();
      const user = await person(store);
      const [first, second] = [digest(), digest()];
      await enable(store, user.id, { codes: [first!, second!] });
      const both = await Promise.all([store.twoFactor.useRecoveryCode(user.id, first!, at(5)), store.twoFactor.useRecoveryCode(user.id, first!, at(5))]);
      expect(both.filter((r) => r.used)).toHaveLength(1);
      expect(await store.twoFactor.useRecoveryCode(user.id, first!, at(6))).toEqual({ used: false, left: 1 });

      const fresh = digest();
      await store.twoFactor.replaceRecoveryCodes(user.id, [fresh], at(7), []);
      expect(await store.twoFactor.useRecoveryCode(user.id, second!, at(8))).toEqual({ used: false, left: 1 });
      expect(await store.twoFactor.useRecoveryCode(user.id, fresh, at(8))).toEqual({ used: true, left: 0 });
    });

    it('five wrong second steps in the window lock it; a try outside the window starts over', async () => {
      const store = await makeStore();
      const user = await person(store);
      await enable(store, user.id);
      for (let i = 0; i < 4; i += 1) expect(await store.twoFactor.recordFailure(user.id, at(5), POLICY)).toEqual({ lockedUntil: null });
      expect(await store.twoFactor.recordFailure(user.id, at(6), POLICY)).toEqual({ lockedUntil: at(21) });
      expect(await store.twoFactor.get(user.id)).toMatchObject({ lockedUntil: at(21), failures: 0 });

      await store.twoFactor.clearFailures(user.id);
      expect(await store.twoFactor.get(user.id)).toMatchObject({ lockedUntil: null, failures: 0 });
      for (let i = 0; i < 4; i += 1) await store.twoFactor.recordFailure(user.id, at(22), POLICY);
      expect(await store.twoFactor.recordFailure(user.id, at(40), POLICY)).toEqual({ lockedUntil: null });
      expect((await store.twoFactor.get(user.id))?.failures).toBe(1);
    });

    it('a challenge is found by its digest while live, and consumed once', async () => {
      const store = await makeStore();
      const user = await person(store);
      const created = await store.twoFactor.createChallenge(challenge(user.id));
      expect(created).toMatchObject({ purpose: 'sign_in', method: 'totp', sessionKind: 'device', firstStep: { method: 'passkey', passkeyId: '00000000-0000-4000-8000-000000000001' }, passwordChangedAt: at(0), attempts: 0, codesSent: 0, consumedAt: null });
      expect(await store.twoFactor.findChallenge(created.tokenDigest, at(4))).toMatchObject({ id: created.id });
      expect(await store.twoFactor.findChallenge(created.tokenDigest, at(13))).toBeNull();

      const both = await Promise.all([store.twoFactor.consumeChallenge(created.id, at(5)), store.twoFactor.consumeChallenge(created.id, at(5))]);
      expect(both.filter(Boolean)).toHaveLength(1);
      expect(await store.twoFactor.findChallenge(created.tokenDigest, at(6))).toBeNull();
    });

    it('tries stop at the cap, even in parallel', async () => {
      const store = await makeStore();
      const user = await person(store);
      const c = await store.twoFactor.createChallenge(challenge(user.id));
      const spent = await Promise.all(Array.from({ length: 8 }, () => store.twoFactor.spendAttempt(c.id, at(4), 5)));
      expect(spent.filter((r) => r.spent)).toHaveLength(5);
      expect(await store.twoFactor.spendAttempt(c.id, at(4), 5)).toEqual({ spent: false, triesLeft: 0 });
    });

    it('an emailed code is re-sent only after the gap and up to the cap', async () => {
      const store = await makeStore();
      const user = await person(store);
      const c = await store.twoFactor.createChallenge(challenge(user.id, { method: 'email', expiresAt: at(59) }));
      const limits = { minGapMs: 30_000, maxCodes: 2 };
      expect(await store.twoFactor.recordCodeSent(c.id, digest(), at(4), limits)).toBe(true);
      expect(await store.twoFactor.recordCodeSent(c.id, digest(), new Date(at(4).getTime() + 10_000), limits)).toBe(false);
      const last = digest();
      expect(await store.twoFactor.recordCodeSent(c.id, last, at(5), limits)).toBe(true);
      expect(await store.twoFactor.recordCodeSent(c.id, digest(), at(6), limits)).toBe(false);
      expect(await store.twoFactor.findChallenge(c.tokenDigest, at(6))).toMatchObject({ codeDigest: last, codeSentAt: at(5), codesSent: 2 });
    });

    it('disabling removes it, its codes and challenges, and every session stamp', async () => {
      const store = await makeStore();
      const user = await person(store);
      const kept = await session(store, user.id);
      await enable(store, user.id, { keepSessionId: kept.id });
      const c = await store.twoFactor.createChallenge(challenge(user.id));
      expect(await store.twoFactor.disable(user.id, at(8), [])).toBe(true);
      expect(await store.twoFactor.get(user.id)).toBeNull();
      expect(await store.twoFactor.recoveryCodesLeft(user.id)).toBe(0);
      expect(await store.twoFactor.findChallenge(c.tokenDigest, at(8))).toBeNull();
      expect((await store.sessions.getById(kept.id))?.twoFactorAt).toBeNull();
      expect(await store.twoFactor.disable(user.id, at(9), [])).toBe(false);
    });

    it('switching method keeps one row and replaces the codes', async () => {
      const store = await makeStore();
      const user = await person(store);
      await enable(store, user.id);
      await enable(store, user.id, { method: 'email', codes: [digest()] });
      expect(await store.twoFactor.get(user.id)).toMatchObject({ method: 'email', totpSecretSealed: null });
      expect(await store.twoFactor.recoveryCodesLeft(user.id)).toBe(1);
    });

    it('prunes challenges that expired before the cut-off', async () => {
      const store = await makeStore();
      const user = await person(store);
      const old = await store.twoFactor.createChallenge(challenge(user.id, { expiresAt: at(10) }));
      const live = await store.twoFactor.createChallenge(challenge(user.id, { expiresAt: at(40) }));
      expect(await store.twoFactor.pruneChallenges(at(20))).toBeGreaterThanOrEqual(1);
      expect(await store.twoFactor.findChallenge(old.tokenDigest, at(5))).toBeNull();
      expect(await store.twoFactor.findChallenge(live.tokenDigest, at(5))).not.toBeNull();
    });
  });
}
