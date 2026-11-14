import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LedgerStore } from '../ports.js';

/**
 * MUT-618 storage contract (ADR-256 D3): emailed sign-in codes. A new code cancels the live one for the address; a try
 * uses a matching code once, spends a try on a miss, and the last allowed miss kills the code. Run against the memory
 * store and Postgres.
 */
export function describeLedgerStoreSignInCodesContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 9, minute, 0));
  const email = () => `code-${randomUUID().slice(0, 8)}@studio.ps`;
  const digest = () => randomUUID().replace(/-/g, '').padEnd(64, '0');
  const MAX = 5;

  describe(`${name} LedgerStore sign-in codes contract (MUT-618)`, () => {
    it('a matching code signs in once, and only while it is live', async () => {
      const store = await makeStore();
      const address = email();
      const code = digest();
      await store.signInCodes.issue({ email: address, userId: null, codeDigest: code, at: at(0), expiresAt: at(10) });
      expect(await store.signInCodes.attempt({ email: address, codeDigest: code, at: at(1), maxAttempts: MAX })).toEqual({ kind: 'matched', userId: null });
      expect(await store.signInCodes.attempt({ email: address, codeDigest: code, at: at(2), maxAttempts: MAX })).toEqual({ kind: 'none' });
    });

    it('an expired code is gone', async () => {
      const store = await makeStore();
      const address = email();
      const code = digest();
      await store.signInCodes.issue({ email: address, userId: null, codeDigest: code, at: at(0), expiresAt: at(10) });
      expect(await store.signInCodes.attempt({ email: address, codeDigest: code, at: at(10), maxAttempts: MAX })).toEqual({ kind: 'none' });
    });

    it('a new code cancels the older one', async () => {
      const store = await makeStore();
      const address = email();
      const older = digest();
      const newer = digest();
      await store.signInCodes.issue({ email: address, userId: null, codeDigest: older, at: at(0), expiresAt: at(10) });
      await store.signInCodes.issue({ email: address, userId: null, codeDigest: newer, at: at(1), expiresAt: at(11) });
      expect((await store.signInCodes.attempt({ email: address, codeDigest: older, at: at(2), maxAttempts: MAX })).kind).toBe('wrong');
      expect((await store.signInCodes.attempt({ email: address, codeDigest: newer, at: at(3), maxAttempts: MAX })).kind).toBe('matched');
    });

    it('counts misses down, and the last allowed miss kills the code', async () => {
      const store = await makeStore();
      const address = email();
      const code = digest();
      await store.signInCodes.issue({ email: address, userId: null, codeDigest: code, at: at(0), expiresAt: at(10) });
      const left: number[] = [];
      for (let i = 0; i < MAX - 1; i += 1) {
        const miss = await store.signInCodes.attempt({ email: address, codeDigest: digest(), at: at(1), maxAttempts: MAX });
        if (miss.kind === 'wrong') left.push(miss.triesLeft);
      }
      expect(left).toEqual([4, 3, 2, 1]);
      expect(await store.signInCodes.attempt({ email: address, codeDigest: digest(), at: at(2), maxAttempts: MAX })).toEqual({ kind: 'exhausted' });
      expect(await store.signInCodes.attempt({ email: address, codeDigest: code, at: at(3), maxAttempts: MAX })).toEqual({ kind: 'none' });
    });

    it('keeps each address apart and returns the account the code was issued for', async () => {
      const store = await makeStore();
      const { user } = await store.users.create({
        email: email(),
        displayName: 'Rana Saleh',
        passwordHash: 'hash',
        locale: 'en',
        personal: { name: 'Personal', slug: `personal-${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
        at: at(0),
      });
      const other = email();
      const code = digest();
      await store.signInCodes.issue({ email: user.email, userId: user.id, codeDigest: code, at: at(0), expiresAt: at(10) });
      expect(await store.signInCodes.attempt({ email: other, codeDigest: code, at: at(1), maxAttempts: MAX })).toEqual({ kind: 'none' });
      expect(await store.signInCodes.attempt({ email: user.email, codeDigest: code, at: at(1), maxAttempts: MAX })).toEqual({ kind: 'matched', userId: user.id });
    });

    it('prunes codes that expired before the cut-off', async () => {
      const store = await makeStore();
      const address = email();
      const code = digest();
      await store.signInCodes.issue({ email: address, userId: null, codeDigest: code, at: at(0), expiresAt: at(10) });
      expect(await store.signInCodes.prune(at(11))).toBeGreaterThanOrEqual(1);
      expect(await store.signInCodes.attempt({ email: address, codeDigest: code, at: at(5), maxAttempts: MAX })).toEqual({ kind: 'none' });
    });
  });
}
